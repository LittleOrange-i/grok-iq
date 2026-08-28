from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from app.core.clock import app_isoformat, utc_now
from app.persistence.account_repository import AccountRepository
from app.persistence.database import Database
from app.persistence.models import AccountAssessment, ProbeRun, RegisterWebhookEvent
from app.persistence.probe_repository import ProbeRepository
from app.persistence.register_event_repository import RegisterEventRepository


def _create_run(probes: ProbeRepository, account_id: int) -> str:
    return probes.create_run(
        account_id=account_id,
        account_name=f"account-{account_id}",
        account_email=f"account-{account_id}@example.test",
        profile_id="quality-marker",
        rounds=1,
        proxy_targets=[{"kind": "direct", "id": None, "name": "直连"}],
        trigger="manual",
        priority=100,
        queue_limit=20,
    )


def test_dashboard_metrics_counts_windowed_register_isolation_and_runs(tmp_path: Path):
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    accounts = AccountRepository(database)
    probes = ProbeRepository(database)
    probes.seed_defaults()
    registers = RegisterEventRepository(database)
    now = utc_now()
    stale = now - timedelta(days=2)

    accounts.set_manual_status(
        account_id=1,
        status="quarantined",
        note="风险周期达到自动隔离区阈值",
        quarantine_until=None,
        previous_upstream_enabled=True,
        disabled_by_monitor=True,
        recovery_guarded=False,
        source="probe",
    )
    accounts.set_manual_status(
        account_id=2,
        status="quarantined",
        note="请求审计发现异常后自动停用",
        quarantine_until=None,
        previous_upstream_enabled=True,
        disabled_by_monitor=True,
        recovery_guarded=False,
        source="request_audit",
    )
    accounts.set_manual_status(
        account_id=3,
        status="quarantined",
        note="临时停用",
        quarantine_until=now + timedelta(hours=1),
        previous_upstream_enabled=True,
        disabled_by_monitor=True,
        recovery_guarded=False,
        source="manual",
    )
    with database.transaction() as session:
        assessment = session.get(AccountAssessment, 2)
        assert assessment is not None
        payload = dict(assessment.disposition or {})
        payload["at"] = app_isoformat(stale)
        assessment.disposition = payload

    registers.receive(
        {
            "event_id": "reg-new",
            "email": "new@example.test",
            "grok2api_account_id": 1,
        }
    )
    registers.complete("reg-new", 1, ["run-1"])
    registers.receive(
        {
            "event_id": "reg-new-dup",
            "email": "new@example.test",
            "grok2api_account_id": 1,
        }
    )
    registers.receive(
        {
            "event_id": "reg-failed",
            "email": "failed@example.test",
        }
    )
    registers.fail("reg-failed", "import failed")
    registers.receive(
        {
            "event_id": "reg-old",
            "email": "old@example.test",
            "grok2api_account_id": 2,
        }
    )
    with database.transaction() as session:
        event = session.get(RegisterWebhookEvent, "reg-old")
        assert event is not None
        event.created_at = stale

    completed_id = _create_run(probes, 11)
    probes.finish_run(completed_id, status="completed")
    failed_id = _create_run(probes, 12)
    probes.finish_run(failed_id, status="failed", error="boom")
    errored_id = _create_run(probes, 13)
    probes.finish_run(errored_id, status="completed_with_errors", error="partial")
    _create_run(probes, 14)
    running_id = _create_run(probes, 15)
    old_id = _create_run(probes, 16)
    probes.finish_run(old_id, status="completed")
    with database.transaction() as session:
        running = session.get(ProbeRun, running_id)
        assert running is not None
        running.status = "running"
        running.started_at = now - timedelta(minutes=10)
        running.heartbeat_at = now - timedelta(minutes=10)
        old = session.get(ProbeRun, old_id)
        assert old is not None
        old.created_at = stale
        old.completed_at = stale
        old.queued_at = stale

    metrics = accounts.dashboard_metrics(24)

    assert metrics["window"]["hours"] == 24
    assert metrics["isolated"]["zoneTotal"] == 2
    assert metrics["isolated"]["inRange"] == 1
    assert metrics["registered"]["total"] == 2
    assert metrics["registered"]["completed"] == 1
    assert metrics["registered"]["failed"] == 1
    assert metrics["probeRuns"]["completed"] == 1
    assert metrics["probeRuns"]["failed"] == 1
    assert metrics["probeRuns"]["completedWithErrors"] == 1
    assert metrics["probeRuns"]["successRate"] == 0.3333
    assert metrics["workers"]["queued"] == 1
    assert metrics["workers"]["running"] == 1
    assert metrics["workers"]["stale"] == 1
    database.dispose()
