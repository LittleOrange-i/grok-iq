from __future__ import annotations

from datetime import timedelta
from typing import Any

from app.core.clock import to_app_timezone, utc_now
from app.core.config import Settings
from app.integrations.grok2api.client import Grok2APIClient
from app.persistence.account_repository import AccountRepository
from app.persistence.probe_repository import ProbeRepository

QUARANTINE_RECOVERY_PRIORITY = -2_000_000_000


class AccountService:
    def __init__(
        self,
        *,
        settings: Settings,
        client: Grok2APIClient,
        accounts: AccountRepository,
        probes: ProbeRepository,
    ):
        self.settings = settings
        self.client = client
        self.accounts = accounts
        self.probes = probes

    async def list_accounts(
        self,
        *,
        page: int,
        page_size: int,
        search: str = "",
        enabled: str = "",
        upstream_status: str = "",
        monitor_status: str = "",
        recovery_guarded: str = "",
    ) -> dict[str, Any]:
        upstream_filters = self._upstream_status_filter(upstream_status)
        if monitor_status or recovery_guarded in {"true", "false"} or enabled in {"true", "false"}:
            upstream = await self.client.list_all_accounts(**upstream_filters)
            account_ids = [int(item.get("id") or 0) for item in upstream]
            assessments = self.accounts.get_assessments(account_ids)
            values = [
                self._overlay(item, assessments.get(int(item.get("id") or 0)))
                for item in upstream
                if self._matches(item, search=search, enabled=enabled)
                and self._matches_assessment(
                    assessments.get(int(item.get("id") or 0)),
                    monitor_status=monitor_status,
                    recovery_guarded=recovery_guarded,
                )
            ]
            start = (page - 1) * page_size
            return {
                "items": values[start : start + page_size],
                "total": len(values),
                "page": page,
                "pageSize": page_size,
            }

        params: dict[str, Any] = {
            "page": page,
            "pageSize": page_size,
            **upstream_filters,
        }
        if search.strip():
            params["search"] = search.strip()
        payload = await self.client.list_accounts(**params)
        items = list(payload.get("items", []))
        assessments = self.accounts.get_assessments([int(item.get("id") or 0) for item in items])
        return {
            **payload,
            "items": [self._overlay(item, assessments.get(int(item.get("id") or 0))) for item in items],
        }

    async def detail(self, account_id: int, limit: int = 200) -> dict[str, Any]:
        account = await self.client.get_account(account_id)
        return {
            "account": self._overlay(account, self.accounts.get_assessment(account_id)),
            "history": self.probes.account_history(account_id, limit),
        }

    async def select_account_ids(
        self,
        *,
        search: str = "",
        enabled: str = "",
        upstream_status: str = "",
        monitor_status: str = "",
        recovery_guarded: str = "",
    ) -> dict[str, Any]:
        """Return every probe-capable account matching the current UI filters."""

        upstream_params = self._upstream_status_filter(upstream_status)
        if search.strip():
            upstream_params["search"] = search.strip()
        upstream = await self.client.list_all_accounts(**upstream_params)
        assessments = (
            self.accounts.get_assessments([int(item.get("id") or 0) for item in upstream])
            if monitor_status or recovery_guarded in {"true", "false"}
            else {}
        )
        matched = [
            item
            for item in upstream
            if self._matches(item, search=search, enabled=enabled)
            and self._matches_assessment(
                assessments.get(int(item.get("id") or 0)),
                monitor_status=monitor_status,
                recovery_guarded=recovery_guarded,
            )
        ]
        selectable = [item for item in matched if self._is_probe_selectable(item)]
        return {
            "accountIds": [int(item["id"]) for item in selectable],
            "disabledAccountIds": [int(item["id"]) for item in selectable if not bool(item.get("enabled"))],
            "matched": len(matched),
            "selectable": len(selectable),
            "excluded": len(matched) - len(selectable),
        }

    async def list_account_options(
        self,
        *,
        page: int,
        page_size: int,
        search: str = "",
        upstream_status: str = "",
    ) -> dict[str, Any]:
        """Return one compact live page for account pickers.

        Account pickers deliberately do not mirror upstream accounts locally.
        Pagination and search stay on the upstream API so thousands of accounts
        do not become one large response or one large browser render.
        """

        params: dict[str, Any] = {
            "page": page,
            "pageSize": page_size,
            **self._upstream_status_filter(upstream_status),
        }
        if search.strip():
            params["search"] = search.strip()
        payload = await self.client.list_accounts(**params)
        items = [
            {
                "id": str(item.get("id") or ""),
                "name": str(item.get("name") or ""),
                "email": str(item.get("email") or ""),
                "enabled": bool(item.get("enabled")),
                "authStatus": str(item.get("authStatus") or ""),
                "egressNodeId": (
                    str(item.get("egressNodeId")) if int(item.get("egressNodeId") or 0) > 0 else None
                ),
                "egressAssignmentMode": str(item.get("egressAssignmentMode") or ""),
            }
            for item in payload.get("items", [])
            if int(item.get("id") or 0) > 0
        ]
        return {
            "items": items,
            "total": int(payload.get("total") or 0),
            "page": int(payload.get("page") or page),
            "pageSize": int(payload.get("pageSize") or page_size),
        }

    async def dashboard(self, hours: int) -> dict[str, Any]:
        upstream = await self.client.admin_request("GET", "/api/admin/v1/accounts/summary")
        metrics = self.accounts.dashboard_metrics(hours)
        assessments = self.accounts.list_assessments(limit=8)
        labels = await self.client.list_all_accounts({int(item["account_id"]) for item in assessments})
        labels_by_id = {int(item.get("id") or 0): item for item in labels}
        return {
            "upstream": upstream.get("providers", {}).get("grok_build", {}),
            **metrics,
            "riskyAccounts": [
                self._overlay(labels_by_id.get(int(item["account_id"]), {"id": item["account_id"]}), item)
                for item in assessments
            ],
            "alerts": self.accounts.list_alerts(limit=8),
            "recentRuns": self.probes.list_runs(page=1, page_size=8)["items"],
            "queue": self.probes.queue_stats(),
        }

    async def action(
        self,
        *,
        account_id: int,
        action: str,
        note: str,
        propagate: bool,
        quarantine_minutes: int | None,
    ) -> dict[str, Any]:
        allowed = {"healthy", "watch", "suspect", "high_risk", "quarantine", "restore"}
        if action not in allowed:
            raise ValueError("账号动作无效")
        account = await self.client.get_account(account_id)
        current_enabled = bool(account.get("enabled"))
        propagated = False
        quarantine_until = None
        disabled_by_monitor: bool | None = None
        previous_enabled: bool | None = None
        status = action

        if action == "quarantine":
            status = "quarantined"
            quarantine_until = utc_now() + timedelta(
                minutes=quarantine_minutes or self.settings.quarantine_minutes
            )
            previous_enabled = current_enabled
            if propagate and current_enabled:
                await self.client.set_account_enabled(account_id, False)
                propagated = True
                disabled_by_monitor = True
            else:
                disabled_by_monitor = False
        elif action == "restore":
            status = "healthy"
            assessment = self.accounts.get_assessment(account_id) or {}
            should_enable = bool(assessment.get("previous_upstream_enabled"))
            if propagate and should_enable:
                await self.client.set_account_enabled(account_id, True)
                propagated = True
            disabled_by_monitor = False
            previous_enabled = None

        assessment = self.accounts.set_manual_status(
            account_id=account_id,
            status=status,
            note=note,
            quarantine_until=quarantine_until,
            previous_upstream_enabled=previous_enabled,
            disabled_by_monitor=disabled_by_monitor,
            recovery_guarded=False if action == "quarantine" else None,
        )
        self.accounts.create_alert(
            account_id=account_id,
            kind="manual_action",
            severity="warning" if status != "healthy" else "info",
            title=f"账号状态调整为 {status}",
            detail={"note": note, "propagated": propagated},
        )
        return {
            "accountId": account_id,
            "status": status,
            "propagated": propagated,
            "quarantineUntil": to_app_timezone(quarantine_until),
            "assessment": assessment,
        }

    async def set_accounts_enabled(
        self,
        *,
        account_ids: list[int],
        enabled: bool,
    ) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(account_id for account_id in account_ids if account_id > 0))
        if not unique_ids:
            raise ValueError("至少选择一个账号")
        locked_ids = self.probes.account_settings_locked_ids(set(unique_ids))
        eligible_ids = [account_id for account_id in unique_ids if account_id not in locked_ids]
        update_result = (
            await self.client.set_accounts_enabled(eligible_ids, enabled) if eligible_ids else None
        )
        failures = list(update_result.failures) if update_result else []
        return {
            "requested": len(unique_ids),
            "eligible": len(eligible_ids),
            "updated": update_result.updated if update_result else 0,
            "enabled": enabled,
            "skippedAccountIds": sorted(locked_ids),
            "failedAccountIds": sorted(failure.account_id for failure in failures),
            "failures": [{"id": failure.account_id, "error": failure.error} for failure in failures],
        }

    async def delete_upstream_account(self, account_id: int) -> dict[str, Any]:
        await self.client.delete_account(account_id)
        self.accounts.create_alert(
            account_id=account_id,
            kind="upstream_delete",
            severity="warning",
            title="账号已通过 grok2api API 删除",
            detail={},
        )
        return {"deleted": True, "accountId": account_id}

    async def delete_upstream_accounts(
        self,
        *,
        account_ids: list[int],
    ) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(account_id for account_id in account_ids if account_id > 0))
        if not unique_ids:
            raise ValueError("至少选择一个账号")
        locked_ids = self.probes.account_settings_locked_ids(set(unique_ids))
        eligible_ids = [account_id for account_id in unique_ids if account_id not in locked_ids]
        delete_result = await self.client.delete_accounts(eligible_ids) if eligible_ids else None
        failures = list(delete_result.failures) if delete_result else []
        failed_account_ids = {failure.account_id for failure in failures}
        for account_id in eligible_ids:
            if account_id in failed_account_ids:
                continue
            self.accounts.create_alert(
                account_id=account_id,
                kind="upstream_delete",
                severity="warning",
                title="账号已通过 grok2api API 删除",
                detail={},
            )
        return {
            "requested": len(unique_ids),
            "eligible": len(eligible_ids),
            "deleted": delete_result.deleted if delete_result else 0,
            "skippedAccountIds": sorted(locked_ids),
            "failedAccountIds": sorted(failed_account_ids),
            "failures": [{"id": failure.account_id, "error": failure.error} for failure in failures],
        }

    async def recover_due_quarantines(self) -> dict[str, Any]:
        restored = 0
        guarded = 0
        failed: list[dict[str, Any]] = []
        for assessment in self.accounts.due_quarantines():
            account_id = int(assessment["account_id"])
            try:
                should_enable = bool(assessment.get("previous_upstream_enabled"))
                if should_enable:
                    await self.client.recover_account_at_priority(
                        account_id,
                        priority=QUARANTINE_RECOVERY_PRIORITY,
                    )
                self.accounts.mark_restored(account_id, recovery_guarded=should_enable)
                if should_enable:
                    guarded += 1
                restored += 1
            except Exception as exc:
                failed.append({"accountId": account_id, "error": str(exc)})
        return {
            "restored": restored,
            "guarded": guarded,
            "priority": QUARANTINE_RECOVERY_PRIORITY,
            "failed": failed,
        }

    async def find_registered_account(self, account_id: int | None, email: str) -> dict[str, Any] | None:
        if account_id:
            try:
                return await self.client.get_account(account_id)
            except Exception:
                pass
        payload = await self.client.list_accounts(search=email, page=1, pageSize=50)
        for account in payload.get("items", []):
            if str(account.get("email") or "").lower() == email.lower():
                return account
        return None

    @staticmethod
    def _upstream_status_filter(upstream_status: str) -> dict[str, str]:
        return {"status": upstream_status} if upstream_status else {}

    @staticmethod
    def _matches(item: dict[str, Any], *, search: str, enabled: str) -> bool:
        if enabled in {"true", "false"} and bool(item.get("enabled")) != (enabled == "true"):
            return False
        if not search.strip():
            return True
        token = search.strip().lower()
        return (
            token in str(item.get("name") or "").lower()
            or token in str(item.get("email") or "").lower()
            or token == str(item.get("id") or "")
        )

    @staticmethod
    def _matches_assessment(
        assessment: dict[str, Any] | None,
        *,
        monitor_status: str,
        recovery_guarded: str,
    ) -> bool:
        value = assessment or {}
        if monitor_status and value.get("monitor_status", "healthy") != monitor_status:
            return False
        if recovery_guarded in {"true", "false"}:
            return bool(value.get("recovery_guarded")) == (recovery_guarded == "true")
        return True

    @staticmethod
    def _is_probe_selectable(item: dict[str, Any]) -> bool:
        auth_status = str(item.get("authStatus") or "")
        return not auth_status or auth_status == "active"

    @staticmethod
    def _overlay(item: dict[str, Any], assessment: dict[str, Any] | None) -> dict[str, Any]:
        return {
            **item,
            "assessment": assessment
            or {
                "account_id": int(item.get("id") or 0),
                "monitor_status": "healthy",
                "risk_score": 0,
                "sample_count": 0,
                "anomaly_count": 0,
                "risk_reasons": [],
                "recovery_guarded": False,
            },
        }
