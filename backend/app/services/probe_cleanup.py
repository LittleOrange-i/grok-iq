from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from app.integrations.grok2api.client import Grok2APIClient
from app.persistence.account_repository import AccountRepository
from app.persistence.probe_repository import AccountSettingsSnapshot, ProbeRepository

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class UpstreamCleanupResult:
    account_errors: list[str]
    resource_errors: list[str]

    @property
    def errors(self) -> list[str]:
        return [*self.account_errors, *self.resource_errors]


class ProbeCleanupCoordinator:
    """Restores account state and removes temporary upstream resources."""

    def __init__(
        self,
        repository: ProbeRepository,
        client: Grok2APIClient,
        accounts: AccountRepository | None = None,
    ):
        self.repository = repository
        self.client = client
        self.accounts = accounts

    def _account_is_isolated(self, account_id: int) -> bool:
        if self.accounts is None or account_id <= 0:
            return False
        assessment = self.accounts.get_assessment(account_id) or {}
        if str(assessment.get("monitor_status") or "") == "quarantined":
            return True
        return bool(assessment.get("disabled_by_monitor"))

    def _enabled_for_snapshot_restore(
        self,
        account_id: int,
        snapshot_enabled: bool,
    ) -> bool:
        """Never re-enable an account GrokIQ has already isolated."""

        if not snapshot_enabled:
            return False
        if self._account_is_isolated(account_id):
            logger.info(
                "probe restore kept account %s disabled; GrokIQ isolation is active",
                account_id,
            )
            return False
        return True

    async def restore_diagnostic_activation(
        self,
        *,
        run_id: str,
        account_id: int,
        snapshot: AccountSettingsSnapshot,
    ) -> None:
        async def restore() -> None:
            await self.client.set_account_routing_settings(
                account_id,
                enabled=self._enabled_for_snapshot_restore(
                    account_id, snapshot.enabled
                ),
                priority=snapshot.priority,
                max_concurrent=snapshot.max_concurrent,
            )
            self.repository.set_diagnostic_activation(run_id, False)

        task = asyncio.create_task(restore(), name=f"probe-account-restore-{run_id}")
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

    async def cleanup(
        self,
        *,
        run_id: str,
        account_id: int,
        snapshot: AccountSettingsSnapshot | None,
        legacy_original_node_id: int | None,
        legacy_original_mode: str,
        route_id: str,
        client_key_id: str,
        restore_egress: bool,
        source: str,
        account_restore_started: bool = False,
    ) -> UpstreamCleanupResult:
        account_errors: list[str] = []
        resource_errors: list[str] = []

        async def cleanup() -> None:
            current_run = self.repository.get_run(run_id) or {}
            restore_status = str(current_run.get("account_restore_status") or "")
            restore_egress_requested = restore_egress and (
                source == "manual" or restore_status in {"pending", "restoring", "restore_failed"}
            )
            restore_requested = (
                bool(current_run.get("diagnostic_activation_active"))
                or restore_status in {"pending", "restoring", "restore_failed"}
                or restore_egress_requested
                or source == "manual"
            )
            if snapshot is not None:
                await self._restore_snapshot(
                    run_id=run_id,
                    account_id=account_id,
                    snapshot=snapshot,
                    source=source,
                    current_run=current_run,
                    restore_requested=restore_requested,
                    restore_egress_requested=restore_egress_requested,
                    account_restore_started=account_restore_started,
                    errors=account_errors,
                )
            elif restore_egress_requested:
                await self._restore_legacy_egress(
                    run_id=run_id,
                    account_id=account_id,
                    original_node_id=legacy_original_node_id,
                    original_mode=legacy_original_mode,
                    source=source,
                    account_restore_started=account_restore_started,
                    errors=account_errors,
                )
            await self._delete_resources(
                route_id=route_id,
                client_key_id=client_key_id,
                errors=resource_errors,
            )

        task = asyncio.create_task(cleanup())
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
        return UpstreamCleanupResult(
            account_errors=account_errors,
            resource_errors=resource_errors,
        )

    async def _restore_snapshot(
        self,
        *,
        run_id: str,
        account_id: int,
        snapshot: AccountSettingsSnapshot,
        source: str,
        current_run: dict[str, object],
        restore_requested: bool,
        restore_egress_requested: bool,
        account_restore_started: bool,
        errors: list[str],
    ) -> None:
        if restore_requested and not account_restore_started:
            self.repository.begin_account_restore(run_id, source)
        restore_account_routing = bool(
            current_run.get("diagnostic_activation_active")
            or (source == "manual" and not snapshot.enabled)
        )
        if restore_account_routing:
            try:
                await self.client.set_account_routing_settings(
                    account_id,
                    enabled=self._enabled_for_snapshot_restore(
                        account_id, snapshot.enabled
                    ),
                    priority=snapshot.priority,
                    max_concurrent=snapshot.max_concurrent,
                )
                self.repository.set_diagnostic_activation(run_id, False)
            except Exception as exc:
                errors.append(f"恢复启用状态、优先级和并发数失败: {exc}")
        elif self._account_is_isolated(account_id):
            try:
                await self.client.set_account_enabled(account_id, False)
            except Exception as exc:
                errors.append(f"保持隔离账号停用失败: {exc}")
        if restore_egress_requested:
            try:
                await self.client.restore_account_egress(
                    account_id,
                    snapshot.egress_node_id,
                    snapshot.egress_assignment_mode,
                )
            except Exception as exc:
                errors.append(f"恢复账号出口失败: {exc}")
        if restore_requested:
            self.repository.finish_account_restore(run_id, source, "; ".join(errors))

    async def _restore_legacy_egress(
        self,
        *,
        run_id: str,
        account_id: int,
        original_node_id: int | None,
        original_mode: str,
        source: str,
        account_restore_started: bool,
        errors: list[str],
    ) -> None:
        if not account_restore_started:
            self.repository.begin_account_restore(run_id, source)
        try:
            await self.client.restore_account_egress(
                account_id, original_node_id, original_mode
            )
        except Exception as exc:
            errors.append(f"恢复账号出口失败: {exc}")
        self.repository.finish_account_restore(run_id, source, "; ".join(errors))

    async def _delete_resources(
        self, *, route_id: str, client_key_id: str, errors: list[str]
    ) -> None:
        client_key_error = ""
        try:
            await self.client.delete_probe_client_key(client_key_id)
        except Exception as exc:
            client_key_error = f"删除临时 Client Key 失败: {exc}"
        route_error = ""
        try:
            await self.client.delete_probe_route(route_id)
        except Exception as exc:
            route_error = f"删除临时模型路由失败: {exc}"
        if client_key_error:
            errors.append(client_key_error)
        if route_error:
            errors.append(route_error)
