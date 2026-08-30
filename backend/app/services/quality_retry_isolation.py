from __future__ import annotations

import logging
from typing import Any

from app.core.config import Settings
from app.integrations.grok2api.client import Grok2APIClient, IntegrationError
from app.services.account_service import AccountService

logger = logging.getLogger(__name__)

MISSING_THINKING_DISABLED = "missing_thinking_disabled"
QUALITY_RETRY_NOTE = "grok2api 请求拦截二次命中降智后停用"


def account_last_error(account: dict[str, Any]) -> str:
    raw = account.get("lastError")
    if raw is None or str(raw).strip() == "":
        raw = account.get("last_error")
    return str(raw or "").strip()


def is_quality_retry_disabled(account: dict[str, Any]) -> bool:
    return account_last_error(account) == MISSING_THINKING_DISABLED


def account_id_of(account: dict[str, Any]) -> int | None:
    try:
        value = int(account.get("id") or 0)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


class QualityRetryIsolationService:
    def __init__(
        self,
        *,
        settings: Settings,
        client: Grok2APIClient,
        account_service: AccountService,
    ) -> None:
        self.settings = settings
        self.client = client
        self.account_service = account_service

    async def scan(self) -> dict[str, Any]:
        if not self.settings.quality_retry_isolation_enabled:
            return _scan_result(
                ok=True,
                skipped=True,
                reason="disabled",
                error="grok2api 降智停用同步已关闭",
            )
        try:
            accounts = await self.client.list_all_accounts(status="disabled")
        except IntegrationError as exc:
            logger.exception("quality retry isolation scan failed")
            return _scan_result(
                ok=False,
                skipped=False,
                reason="upstream_error",
                error=str(exc),
            )
        matched = [item for item in accounts if is_quality_retry_disabled(item)]
        isolated = 0
        already_isolated = 0
        failures: list[dict[str, Any]] = []
        for item in matched:
            account_id = account_id_of(item)
            if account_id is None:
                failures.append({"id": item.get("id"), "error": "账号 ID 无效"})
                continue
            try:
                result = await self.account_service.isolate_account(
                    account_id,
                    note=QUALITY_RETRY_NOTE,
                    source="quality_retry",
                    automatic=False,
                    detail={
                        "riskReasons": [MISSING_THINKING_DISABLED],
                        "lastError": account_last_error(item),
                    },
                )
            except Exception as exc:
                failures.append({"id": account_id, "error": str(exc)})
                continue
            status = str(result.get("actionStatus") or "")
            if status == "already_quarantined":
                already_isolated += 1
            elif status in {"disabled", "already_disabled"}:
                isolated += 1
            elif status == "task_protected":
                failures.append({"id": account_id, "error": "任务保护中"})
            else:
                failures.append(
                    {"id": account_id, "error": status or "隔离失败"}
                )
        return _scan_result(
            ok=True,
            skipped=False,
            scanned=len(accounts),
            matched=len(matched),
            isolated=isolated,
            already_isolated=already_isolated,
            failures=failures,
        )


def _scan_result(
    *,
    ok: bool,
    skipped: bool,
    reason: str = "",
    error: str = "",
    scanned: int = 0,
    matched: int = 0,
    isolated: int = 0,
    already_isolated: int = 0,
    failures: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    items = failures or []
    return {
        "ok": ok,
        "skipped": skipped,
        "reason": reason,
        "error": error,
        "scanned": scanned,
        "matched": matched,
        "isolated": isolated,
        "alreadyIsolated": already_isolated,
        "failed": len(items),
        "failures": items,
    }
