from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime, timedelta
from typing import Any

from app.core.clock import ensure_utc, utc_now
from app.core.config import (
    REGISTER_PROBE_EXECUTION_MODE,
    REGISTER_PROBE_PROXY_TARGETS,
    REGISTER_PROBE_ROUNDS,
    Settings,
)
from app.persistence.account_repository import AccountRepository
from app.persistence.probe_repository import QueueFullError, RunStateError
from app.persistence.register_event_repository import RegisterEventRepository
from app.services.account_service import AccountService
from app.services.probe_manager import ProbeManager
from app.services.wechat_notification import WeChatAccountNotificationService

logger = logging.getLogger(__name__)
MAX_EVENT_ATTEMPTS = 20
RETRY_DELAYS = (2, 5, 10, 20, 30, 60, 120, 300)
REGISTER_PROBE_STABILIZATION_SECONDS = 15


class RegisteredAccountPending(RuntimeError):
    def __init__(self, message: str, *, retry_after_seconds: float = 0) -> None:
        super().__init__(message)
        self.retry_after_seconds = max(0.0, float(retry_after_seconds or 0))


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
            if self.settings.initial_probe_on_register:
                self._ensure_initial_probe_ready(event, account)
            if bool(event.get("bot_risk")):
                previous_assessment = self.accounts.get_assessment(account_id)
                assessment = self.accounts.mark_registration_risk(
                    account_id=account_id,
                    bfs=event.get("bfs"),
                    registration_id=str(event.get("registration_id") or ""),
                    risk_score_cap=self.settings.risk_score_cap,
                    risk_high_floor=self.settings.risk_high_floor,
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
                if int(account.get("egressNodeId") or 0) <= 0:
                    account = await self.account_service.ensure_account_egress(account)
                result = await self.probes.enqueue_register_event(
                    source_event_id=event_id,
                    account=account,
                    profile_ids=self.settings.register_probe_profile_ids,
                    execution_mode=REGISTER_PROBE_EXECUTION_MODE,
                    rounds=REGISTER_PROBE_ROUNDS,
                    proxy_targets=[
                        dict(target) for target in REGISTER_PROBE_PROXY_TARGETS
                    ],
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

    @staticmethod
    def _timestamp(value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return ensure_utc(value)
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError, OverflowError):
            return None
        return ensure_utc(parsed)

    def _ensure_initial_probe_ready(
        self,
        event: dict[str, Any],
        account: dict[str, Any],
    ) -> None:
        """Defer a new account probe until import-side permissions settle.

        grok2api finishes credential and model-catalog persistence before its
        import request returns, while the upstream chat permission can take a
        few more seconds to propagate.  Calling immediately can produce one
        temporary permission denial, which grok2api correctly isolates as a
        five-minute model cooldown.  Keep the durable webhook pending during a
        short stabilization window so the first real probe starts after that
        propagation period instead of creating a false error sample.
        """

        now = utc_now()
        received_at = self._timestamp(event.get("created_at"))
        if received_at is not None:
            ready_at = received_at + timedelta(
                seconds=REGISTER_PROBE_STABILIZATION_SECONDS
            )
            remaining = (ready_at - now).total_seconds()
            if remaining > 0:
                raise RegisteredAccountPending(
                    "新导入账号正在等待 grok2api 模型权限传播",
                    retry_after_seconds=math.ceil(remaining),
                )

        cooldown_until = self._timestamp(account.get("cooldownUntil"))
        if cooldown_until is not None:
            remaining = (cooldown_until - now).total_seconds()
            if remaining > 0:
                raise RegisteredAccountPending(
                    "新导入账号仍在 grok2api 冷却中",
                    retry_after_seconds=math.ceil(remaining),
                )

    def _retry_or_fail(self, event_id: str, attempts: int, exc: Exception) -> None:
        if attempts >= MAX_EVENT_ATTEMPTS:
            self.repository.fail(event_id, str(exc))
            return
        requested_delay = float(getattr(exc, "retry_after_seconds", 0) or 0)
        delay = requested_delay or RETRY_DELAYS[
            min(max(attempts - 1, 0), len(RETRY_DELAYS) - 1)
        ]
        self.repository.retry(event_id, str(exc), delay)
        logger.info(
            "register webhook deferred event_id=%s attempts=%s retry_in=%.1fs reason=%s",
            event_id,
            attempts,
            delay,
            exc,
        )
