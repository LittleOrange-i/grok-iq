from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import replace
from typing import TYPE_CHECKING, Any

from app.integrations.grok2api.client import IntegrationError
from app.persistence.probe_repository import AccountSettingsSnapshot
from app.services.probe_runtime import AccountRestoreError

if TYPE_CHECKING:
    from app.services.probe_manager import ProbeManager


class ProbeCallRunner:
    """Runs one probe sample with activation, retry, and restoration guards."""

    def __init__(self, manager: ProbeManager, logger: logging.Logger):
        self.manager = manager
        self.logger = logger

    async def run(
        self,
        *,
        run_id: str,
        account_id: int,
        snapshot: AccountSettingsSnapshot,
        factory: Callable[[], Awaitable[Any]],
    ) -> Any:
        primary_error: BaseException | None = None
        activation_required = not snapshot.enabled
        try:
            if activation_required:
                await self._activate(run_id, account_id, snapshot)
            return await self._run_with_retries(
                run_id=run_id,
                account_id=account_id,
                factory=factory,
            )
        except BaseException as exc:
            primary_error = exc
            raise
        finally:
            self.manager._active_calls.pop(run_id, None)
            if activation_required:
                await self._restore(run_id, account_id, snapshot, primary_error)

    async def _activate(
        self,
        run_id: str,
        account_id: int,
        snapshot: AccountSettingsSnapshot,
    ) -> None:
        manager = self.manager
        # Persist intent before the upstream PATCH. A crash between the two
        # operations is therefore handled conservatively by startup recovery
        # or the task detail's manual synchronization action.
        manager.repository.set_diagnostic_activation(run_id, True)
        await manager.client.set_account_routing_settings(
            account_id,
            enabled=True,
            priority=snapshot.diagnostic_priority,
            max_concurrent=snapshot.diagnostic_max_concurrent,
        )
        await asyncio.sleep(0.15)

    async def _run_with_retries(
        self,
        *,
        run_id: str,
        account_id: int,
        factory: Callable[[], Awaitable[Any]],
    ) -> Any:
        manager = self.manager
        retry_limit = max(0, int(getattr(manager.settings, "probe_transient_retry_attempts", 2)))
        for attempt in range(retry_limit + 1):
            call = asyncio.create_task(factory(), name=f"probe-call-{run_id}-{attempt + 1}")
            manager._active_calls[run_id] = call
            try:
                result = await call
                return self._with_attempt_usage(result, attempt)
            except asyncio.CancelledError:
                raise
            except IntegrationError as exc:
                exc.attempt_count = attempt + 1
                if not exc.transient or attempt >= retry_limit:
                    raise
                delay = await manager._transient_retry_delay(
                    account_id=account_id,
                    error=exc,
                    attempt=attempt,
                )
                self.logger.info(
                    "probe %s transient upstream state (%s/%s), retrying in %.1fs: %s",
                    run_id,
                    attempt + 1,
                    retry_limit + 1,
                    delay,
                    exc,
                )
                await manager._sleep_probe_delay(run_id, delay)
            finally:
                manager._active_calls.pop(run_id, None)
        raise RuntimeError("探针重试流程未返回结果")

    @staticmethod
    def _with_attempt_usage(result: Any, attempt: int) -> Any:
        if not attempt or not hasattr(result, "usage"):
            return result
        # Keep the successful sample as one logical step while exposing how
        # many upstream attempts were needed.
        usage = dict(result.usage or {})
        usage["probeAttempts"] = attempt + 1
        try:
            return replace(result, usage=usage)
        except (TypeError, ValueError):
            return result

    async def _restore(
        self,
        run_id: str,
        account_id: int,
        snapshot: AccountSettingsSnapshot,
        primary_error: BaseException | None,
    ) -> None:
        manager = self.manager
        try:
            await manager._restore_diagnostic_activation(
                run_id=run_id,
                account_id=account_id,
                snapshot=snapshot,
            )
        except Exception as exc:
            message = f"单次探针后恢复账号路由设置失败: {exc}"
            manager.repository.finish_account_restore(run_id, "automatic", message)
            if isinstance(primary_error, asyncio.CancelledError):
                self.logger.exception("%s", message)
            else:
                raise AccountRestoreError(message) from exc
