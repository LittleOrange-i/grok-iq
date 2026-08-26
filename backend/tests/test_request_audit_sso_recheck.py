from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from app.core.clock import utc_now
from app.core.config import Settings
from app.services.request_audit_service import RequestAuditService


def build_service(**overrides: object) -> tuple[
    RequestAuditService,
    MagicMock,
    AsyncMock,
    AsyncMock,
]:
    settings = Settings(_env_file=None)
    for key, value in overrides.items():
        setattr(settings, key, value)
    repository = MagicMock()
    repository.update_verification.side_effect = (
        lambda audit_id, values: {"audit_upstream_id": audit_id, **values}
    )
    account_service = AsyncMock()
    sso_reports = AsyncMock()
    service = RequestAuditService(
        settings=settings,
        client=MagicMock(),
        repository=repository,
        sso_reports=sso_reports,
        account_service=account_service,
    )
    return service, repository, account_service, sso_reports


def quarantine_record() -> dict[str, object]:
    return {
        "account_id": 11,
        "upstream_id": "audit-1",
        "tps": 12.5,
        "reasoning_tokens": 0,
        "_action_mode": "quarantine",
        "_risk_rule_id": "reasoning_zero",
        "_risk_rule_count": 2,
        "_risk_reasons": ["成功请求思考输出为 0"],
        "created_at": utc_now(),
    }


def tps_record() -> dict[str, object]:
    return {
        "account_id": 11,
        "upstream_id": "audit-2",
        "tps": 800,
        "_action_mode": "tps_only",
        "_risk_rule_id": "fast_risk",
        "_risk_rule_count": 2,
        "_tps_anomaly_count": 2,
        "_tps_min_count": 2,
        "_tps_max": 800,
        "_tps_egress_node_ids": [3],
        "_risk_reasons": ["TPS 过高"],
        "created_at": utc_now(),
    }


async def test_disabled_sso_recheck_quarantines_without_calling_sso():
    service, repository, account_service, sso_reports = build_service(
        request_audit_sso_recheck_enabled=False,
    )
    repository.create_verification.return_value = {
        "status": "pending",
        "action_status": "pending",
    }
    account_service.apply_auto_quarantine.return_value = {"actionStatus": "disabled"}

    result = await service._process_pre_disable_candidate(quarantine_record())

    sso_reports.check_account_once.assert_not_called()
    account_service.apply_auto_quarantine.assert_awaited()
    note = account_service.apply_auto_quarantine.await_args.kwargs["note"]
    assert "跳过 SSO" in note
    assert result["status"] == "sso_skipped"
    assert result["action_status"] == "disabled"
    assert result["sso_verdict"] == "skipped"


async def test_disabled_sso_recheck_retries_missing_sso_records():
    service, repository, account_service, sso_reports = build_service(
        request_audit_sso_recheck_enabled=False,
    )
    repository.create_verification.return_value = {
        "status": "missing_sso",
        "action_status": "not_required",
        "sso_verdict": "",
        "bot_flag": {},
        "proxy_used": False,
        "check_error": "账号未保存 SSO",
    }
    account_service.apply_auto_quarantine.return_value = {"actionStatus": "disabled"}

    result = await service._process_pre_disable_candidate(quarantine_record())

    sso_reports.check_account_once.assert_not_called()
    account_service.apply_auto_quarantine.assert_awaited()
    assert result["status"] == "sso_skipped"
    assert result["action_status"] == "disabled"


async def test_enabled_sso_recheck_keeps_missing_sso_pending_action():
    service, _repository, account_service, sso_reports = build_service()
    service.repository.create_verification.return_value = {
        "status": "missing_sso",
        "action_status": "not_required",
    }

    result = await service._process_pre_disable_candidate(quarantine_record())

    sso_reports.check_account_once.assert_not_called()
    account_service.apply_auto_quarantine.assert_not_called()
    assert result["status"] == "missing_sso"
    assert result["action_status"] == "not_required"


async def test_disabled_sso_recheck_deprioritizes_tps_only_without_sso():
    service, repository, account_service, sso_reports = build_service(
        request_audit_sso_recheck_enabled=False,
    )
    repository.create_verification.return_value = {
        "status": "pending",
        "action_status": "pending",
    }
    account_service.apply_tps_only_deprioritization.return_value = {
        "actionStatus": "deprioritized",
        "priority": -1_000_000,
        "previousPriority": 0,
    }

    result = await service._process_pre_disable_candidate(tps_record())

    sso_reports.check_account_once.assert_not_called()
    account_service.apply_auto_quarantine.assert_not_called()
    account_service.apply_tps_only_deprioritization.assert_awaited()
    assert result["status"] == "sso_skipped"
    assert result["action_status"] == "deprioritized"
