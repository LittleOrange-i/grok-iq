from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock

from sqlalchemy import select

from app.core.clock import app_day_key, app_isoformat, utc_now
from app.core.config import Settings
from app.persistence.account_repository import AccountRepository
from app.persistence.database import Database
from app.persistence.models import AccountAssessment, ProbeSample
from app.persistence.probe_repository import ProbeRepository
from app.persistence.request_audit_repository import RequestAuditRepository
from app.services.account_service import AccountService
from app.services.account_timeline import build_account_timeline


def _database(tmp_path: Path) -> Database:
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    return database


def _add_probe_sample(
    probes: ProbeRepository,
    *,
    account_id: int,
    classification: str = "normal",
    tps: float = 50,
) -> str:
    probes.seed_defaults()
    run_id = probes.create_run(
        account_id=account_id,
        account_name="Alpha",
        account_email="alpha@example.test",
        profile_id="quality-marker",
        rounds=1,
        proxy_targets=[{"kind": "current", "id": None}],
        trigger="manual",
        priority=100,
        queue_limit=20,
    )
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
            "reasoning_tokens": 0,
            "visible_tokens": 10,
            "chunk_count": 1,
            "first_token_ms": 100,
            "duration_ms": 200,
            "generation_ms": 100,
            "first_token_share": 0.5,
            "tps": tps,
            "expected_matched": True,
            "classification": classification,
            "severity": 0,
            "error": "",
        },
    )
    probes.finish_run(run_id)
    return run_id


def _set_sample_created_at(database: Database, run_id: str, created_at) -> str:
    with database.transaction() as session:
        sample = session.scalar(select(ProbeSample).where(ProbeSample.run_id == run_id))
        assert sample is not None
        sample.created_at = created_at
        return sample.id


def _add_audit(
    repository: RequestAuditRepository,
    *,
    account_id: int,
    upstream_id: str,
    created_at,
    tps: float = 12.5,
    status_code: int = 200,
    risk_level: str = "high",
) -> None:
    repository.upsert_records(
        [
            {
                "upstream_id": upstream_id,
                "request_id": f"req-{upstream_id}",
                "day_key": app_day_key(created_at) or created_at.date().isoformat(),
                "provider": "grok_build",
                "operation": "chat",
                "model_public_id": "grok-4.6",
                "model_upstream_model": "Build/grok-4.6",
                "account_id": account_id,
                "account_name": "Alpha",
                "client_key_id": "",
                "client_key_name": "",
                "egress_node_name": "",
                "egress_ip": "",
                "egress_mode": "",
                "egress_scope": "",
                "status_code": status_code,
                "streaming": False,
                "input_tokens": 0,
                "media_input_images": 0,
                "output_tokens": 0,
                "reasoning_tokens": 0,
                "reasoning_tokens_reported": False,
                "total_tokens": 0,
                "duration_ms": 1000,
                "tps": tps,
                "risk_level": risk_level,
                "risk_reasons": ["fast_risk"],
                "raw": {},
                "created_at": created_at,
                "fetched_at": created_at,
            }
        ]
    )


def test_account_timeline_merges_sources_newest_first(tmp_path: Path):
    database = _database(tmp_path)
    accounts = AccountRepository(database)
    probes = ProbeRepository(database)
    audits = RequestAuditRepository(database)
    now = utc_now()
    run_id = _add_probe_sample(probes, account_id=1, classification="fast_risk", tps=8)
    sample_id = _set_sample_created_at(database, run_id, now - timedelta(hours=2))
    _add_audit(
        audits,
        account_id=1,
        upstream_id="audit-1",
        created_at=now - timedelta(minutes=30),
    )
    accounts.set_manual_status(
        account_id=1,
        status="quarantined",
        note="探针发现异常后自动隔离",
        source="probe",
        disposition_action="isolate",
    )
    with database.transaction() as session:
        stored = session.get(AccountAssessment, 1)
        assert stored is not None
        disposition = dict(stored.disposition or {})
        disposition["at"] = app_isoformat(now - timedelta(hours=1))
        stored.disposition = disposition
        stored.operator_notes = [
            {
                "id": "note-1",
                "content": "人工确认隔离",
                "created_at": app_isoformat(now - timedelta(minutes=10)),
                "updated_at": None,
            }
        ]

    result = build_account_timeline(database, account_id=1, limit=50)
    types = [item["type"] for item in result["items"]]
    assert result["accountId"] == 1
    assert types == ["note", "audit", "isolate", "sample"]

    note, audit, isolate, sample = result["items"]
    assert note["id"] == "note:note-1"
    assert note["href"] is None
    assert note["detail"] == "人工确认隔离"

    assert audit["id"] == "audit:audit-1"
    assert audit["href"] == "/request-audits/ledger"
    assert audit["search"] == {"account": "1"}
    assert audit["meta"]["requestId"] == "req-audit-1"
    assert "HTTP 200" in audit["detail"]
    assert "TPS 12.5" in audit["detail"]

    assert isolate["type"] == "isolate"
    assert isolate["href"] == "/quarantine"
    assert "隔离" in isolate["title"]

    assert sample["id"] == f"sample:{sample_id}"
    assert sample["href"] == "/runs"
    assert sample["search"] == {"account": "1"}
    assert sample["meta"]["runId"] == run_id
    assert "强降智信号" in sample["title"]
    assert "TPS 8" in sample["detail"]


def test_account_timeline_respects_limit_and_skips_other_accounts(tmp_path: Path):
    database = _database(tmp_path)
    probes = ProbeRepository(database)
    audits = RequestAuditRepository(database)
    now = utc_now()
    run_id = _add_probe_sample(probes, account_id=1)
    _set_sample_created_at(database, run_id, now - timedelta(hours=1))
    _add_audit(audits, account_id=1, upstream_id="own", created_at=now)
    _add_audit(
        audits,
        account_id=2,
        upstream_id="other",
        created_at=now + timedelta(minutes=1),
    )
    result = build_account_timeline(database, account_id=1, limit=1)
    assert len(result["items"]) == 1
    assert result["items"][0]["id"] == "audit:own"
    assert result["hasMore"] is True
    assert result["limit"] == 1


def test_account_timeline_skips_disposition_without_at_or_unsupported_action(
    tmp_path: Path,
):
    database = _database(tmp_path)
    now = utc_now()
    with database.transaction() as session:
        session.add(
            AccountAssessment(
                account_id=1,
                monitor_status="quarantined",
                disposition={
                    "source": "manual",
                    "action": "quarantine",
                    "reason": "临时停用",
                    "at": app_isoformat(now),
                },
            )
        )
        session.add(
            AccountAssessment(
                account_id=2,
                monitor_status="quarantined",
                disposition={
                    "source": "probe",
                    "action": "isolate",
                    "reason": "缺少时间",
                },
            )
        )
        session.add(
            AccountAssessment(
                account_id=3,
                monitor_status="healthy",
                disposition={
                    "source": "manual",
                    "action": "restore",
                    "reason": "人工恢复",
                    "at": app_isoformat(now),
                },
            )
        )

    skipped_quarantine = build_account_timeline(database, account_id=1)
    skipped_missing_at = build_account_timeline(database, account_id=2)
    restored = build_account_timeline(database, account_id=3)
    assert skipped_quarantine["items"] == []
    assert skipped_missing_at["items"] == []
    assert [item["type"] for item in restored["items"]] == ["restore"]
    assert restored["items"][0]["title"] == "恢复账号"
    assert restored["items"][0]["href"] is None


def test_account_timeline_empty_account(tmp_path: Path):
    database = _database(tmp_path)
    result = build_account_timeline(database, account_id=99, limit=20)
    assert result == {
        "accountId": 99,
        "items": [],
        "limit": 20,
        "hasMore": False,
    }


def test_account_service_timeline_wrapper(tmp_path: Path):
    database = _database(tmp_path)
    service = AccountService(
        settings=Settings(database_path=tmp_path / "grokiq.db"),
        client=MagicMock(),
        accounts=AccountRepository(database),
        probes=ProbeRepository(database),
    )
    result = service.timeline(7, limit=10)
    assert result == {
        "accountId": 7,
        "items": [],
        "limit": 10,
        "hasMore": False,
    }
