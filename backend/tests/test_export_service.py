from __future__ import annotations

from pathlib import Path

import pytest

from app.persistence.account_repository import AccountRepository
from app.persistence.database import Database
from app.persistence.probe_repository import ProbeRepository
from app.services.export_service import ACCOUNT_COLUMNS, ExportService, _csv_bytes


def _database(tmp_path: Path) -> Database:
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    return database


def _create_run(probes: ProbeRepository, account_id: int) -> str:
    probes.seed_defaults()
    return probes.create_run(
        account_id=account_id,
        account_name=f"account-{account_id}",
        account_email=f"account-{account_id}@example.test",
        profile_id="quality-marker",
        rounds=1,
        proxy_targets=[{"kind": "current", "id": None}],
        trigger="manual",
        priority=100,
        queue_limit=20,
    )


@pytest.mark.asyncio
async def test_quarantine_csv_includes_isolated_account(tmp_path: Path):
    database = _database(tmp_path)
    accounts = AccountRepository(database)
    probes = ProbeRepository(database)
    accounts.set_manual_status(
        account_id=11,
        status="quarantined",
        note="探针发现异常后自动隔离",
        quarantine_until=None,
        previous_upstream_enabled=True,
        disabled_by_monitor=True,
        recovery_guarded=False,
        source="probe",
    )
    service = ExportService(accounts=accounts, probes=probes)
    rows = await service.quarantine_rows()
    assert [item["account_id"] for item in rows] == [11]
    csv_text = _csv_bytes(ACCOUNT_COLUMNS, rows).decode("utf-8-sig")
    assert "账号 ID" in csv_text
    assert "11" in csv_text
    assert "探针发现异常后自动隔离" in csv_text
    database.dispose()


@pytest.mark.asyncio
async def test_high_risk_export_skips_normal_accounts(tmp_path: Path):
    database = _database(tmp_path)
    accounts = AccountRepository(database)
    probes = ProbeRepository(database)
    accounts.set_manual_status(
        account_id=21,
        status="high_risk",
        note="高风险",
        quarantine_until=None,
        previous_upstream_enabled=True,
        disabled_by_monitor=True,
        recovery_guarded=False,
        source="probe",
    )
    accounts.set_manual_status(
        account_id=22,
        status="healthy",
        note="",
        quarantine_until=None,
        previous_upstream_enabled=True,
        disabled_by_monitor=False,
        recovery_guarded=False,
        source="manual",
    )
    service = ExportService(accounts=accounts, probes=probes)
    rows = await service.high_risk_rows()
    assert [item["account_id"] for item in rows] == [21]
    database.dispose()


def test_probe_sample_export_and_empty_list(tmp_path: Path):
    database = _database(tmp_path)
    accounts = AccountRepository(database)
    probes = ProbeRepository(database)
    service = ExportService(accounts=accounts, probes=probes)
    assert service.probe_sample_rows() == []
    run_id = _create_run(probes, 31)
    probes.add_sample(
        run_id,
        {
            "round_number": 1,
            "target_key": "current",
            "target_kind": "current",
            "egress_node_id": None,
            "egress_name": "",
            "status": "done",
            "status_code": 200,
            "output_tokens": 10,
            "reasoning_tokens": 4,
            "visible_tokens": 6,
            "chunk_count": 1,
            "first_token_ms": 100,
            "duration_ms": 200,
            "generation_ms": 100,
            "first_token_share": 0.5,
            "tps": 50,
            "expected_matched": True,
            "classification": "fast_risk",
            "severity": 4,
            "error": "",
        },
    )
    rows = service.probe_sample_rows()
    assert len(rows) == 1
    assert rows[0]["account_id"] == 31
    assert rows[0]["classification"] == "fast_risk"
    assert rows[0]["run_id"] == run_id
    database.dispose()


@pytest.mark.asyncio
async def test_request_audit_export_requires_service(tmp_path: Path):
    database = _database(tmp_path)
    service = ExportService(
        accounts=AccountRepository(database),
        probes=ProbeRepository(database),
    )
    with pytest.raises(ValueError, match="请求审计未启用"):
        await service.request_audit_rows()
    database.dispose()

