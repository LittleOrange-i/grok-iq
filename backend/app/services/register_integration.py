from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.core.config import Settings
from app.persistence.account_repository import AccountRepository
from app.persistence.probe_repository import QueueFullError, RunStateError
from app.persistence.register_event_repository import RegisterEventRepository
from app.services.account_service import AccountService
from app.services.probe_manager import ProbeManager
from app.services.wechat_notification import WeChatAccountNotificationService

logger = logging.getLogger(__name__)
MAX_EVENT_ATTEMPTS = 20
RETRY_DELAYS = (2, 5, 10, 20, 30, 60, 120, 300)


class RegisteredAccountPending(RuntimeError):
    pass


class RegisterIntegrationService:
    def __init__(
        self,
        *,
        settings: Settings,
        repository: RegisterEventRepository,
        accounts: AccountRepository,
        account_service: AccountService,
        probes: ProbeManager,
        notifications: WeChatAccountNotificationService | None = None,
    ):
        self.settings = settings
        self.repository = repository
        self.accounts = accounts
        self.account_service = account_service
        self.probes = probes
        self.notifications = notifications
        self._wake = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        recovered = self.repository.recover_processing()
        if recovered:
            logger.info("recovered register webhook events count=%s", recovered)
        self._task = asyncio.create_task(
            self._worker(), name="grok-register-integration"
        )
        self._wake.set()

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task is None:
            return
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    def accept(self, values: dict[str, Any]) -> dict[str, Any]:
        event, created = self.repository.receive(values)
        self._wake.set()
        return {
            "accepted": True,
            "duplicate": not created,
            "eventId": event["event_id"],
        }

    async def _worker(self) -> None:
        while True:
            event = self.repository.claim_due()
            if event is None:
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=2)
                except TimeoutError:
                    pass
                continue
            await self._process_claimed(event)

    async def _process_claimed(self, event: dict[str, Any]) -> None:
        event_id = str(event["event_id"])
        attempts = int(event.get("attempts") or 1)
        try:
            account = await self.account_service.find_registered_account(
                event.get("grok2api_account_id"), str(event["email"])
            )
            if account is None:
                raise RegisteredAccountPending("grok2api 中尚未发现该注册账号")
            account_id = int(account.get("id") or 0)
            if bool(event.get("bot_risk")):
                previous_assessment = self.accounts.get_assessment(account_id)
                assessment = self.accounts.mark_registration_risk(
                    account_id=account_id,
                    bfs=event.get("bfs"),
                    registration_id=str(event.get("registration_id") or ""),
                )
                if self.notifications is not None:
                    try:
                        await self.notifications.notify_account_transition(
                            account=account,
                            previous=previous_assessment,
                            current=assessment,
                            source="grok-register",
                        )
                    except Exception:
                        logger.exception(
                            "wechat notification failed event_id=%s account_id=%s",
                            event_id,
                            account_id,
                        )

            run_ids: list[str] = []
            if self.settings.initial_probe_on_register:
                result = await self.probes.enqueue_register_event(
                    source_event_id=event_id,
                    account=account,
                    profile_ids=self.settings.register_probe_profile_ids,
                    execution_mode=self.settings.register_probe_execution_mode,
                    rounds=self.settings.register_probe_rounds,
                    proxy_targets=self.settings.register_probe_proxy_targets,
                )
                run_ids = list(result.get("runIds") or [])
            self.repository.complete(event_id, account_id, run_ids)
            logger.info(
                "register webhook completed event_id=%s account_id=%s runs=%s",
                event_id,
                account_id,
                len(run_ids),
            )
        except (RegisteredAccountPending, QueueFullError, RunStateError) as exc:
            self._retry_or_fail(event_id, attempts, exc)
        except ValueError as exc:
            self._retry_or_fail(event_id, attempts, exc)
        except Exception as exc:
            logger.exception("register webhook processing failed event_id=%s", event_id)
            self._retry_or_fail(event_id, attempts, exc)

    def _retry_or_fail(self, event_id: str, attempts: int, exc: Exception) -> None:
        if attempts >= MAX_EVENT_ATTEMPTS:
            self.repository.fail(event_id, str(exc))
            return
        delay = RETRY_DELAYS[min(max(attempts - 1, 0), len(RETRY_DELAYS) - 1)]
        self.repository.retry(event_id, str(exc), delay)
