from __future__ import annotations

from pathlib import Path

from app.persistence.database import Database
from app.persistence.register_event_repository import RegisterEventRepository


def test_register_event_inbox_lists_filters_and_summarizes(tmp_path: Path):
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    repository = RegisterEventRepository(database)

    repository.receive(
        {
            "event_id": "registration:alpha:grok2api-imported",
            "event_type": "grok2api.account_imported",
            "registration_id": "alpha",
            "email": "alpha@example.test",
            "sso": "RAW-ALPHA",
            "grok2api_account_id": 17,
            "bot_risk": False,
        }
    )
    repository.receive(
        {
            "event_id": "registration:beta:grok2api-imported",
            "event_type": "grok2api.account_imported",
            "registration_id": "beta",
            "email": "beta@example.test",
            "grok2api_account_id": 29,
            "bot_risk": True,
            "bfs": 3,
        }
    )
    repository.complete(
        "registration:alpha:grok2api-imported",
        17,
        ["run-1"],
    )

    result = repository.list_events(page=1, page_size=20)

    assert result["total"] == 2
    assert result["statusCounts"] == {
        "pending": 1,
        "processing": 0,
        "completed": 1,
        "failed": 0,
    }
    assert result["dueCount"] == 1
    assert result["retryingCount"] == 0
    assert "sso" not in result["items"][0]
    assert repository.sso_for_accounts([17, 29]) == {
        17: {"email": "alpha@example.test", "sso": "RAW-ALPHA"}
    }

    filtered = repository.list_events(
        page=1,
        page_size=20,
        status="pending",
        search="29",
    )
    assert filtered["total"] == 1
    assert filtered["items"][0]["email"] == "beta@example.test"
    database.dispose()


def test_duplicate_event_refreshes_sso_after_account_resolution(tmp_path: Path):
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    repository = RegisterEventRepository(database)
    values = {
        "event_id": "registration:alpha:grok2api-imported",
        "email": "alpha@example.test",
    }
    repository.receive(values)
    repository.bind_account(values["event_id"], 17)

    repository.receive({**values, "sso": "REFRESHED-SSO"})

    assert repository.sso_for_accounts([17]) == {
        17: {"email": "alpha@example.test", "sso": "REFRESHED-SSO"}
    }
    database.dispose()


def test_latest_sso_uses_receipt_time_and_unresolved_upstream_account_id(
    tmp_path: Path,
):
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    repository = RegisterEventRepository(database)
    repository.receive(
        {
            "event_id": "registration:old:grok2api-imported",
            "email": "alpha@example.test",
            "sso": "OLD-SSO",
            "grok2api_account_id": 17,
        }
    )
    repository.receive(
        {
            "event_id": "registration:new:grok2api-imported",
            "email": "alpha@example.test",
            "sso": "NEW-SSO",
            "grok2api_account_id": 17,
        }
    )

    # A later bind mutates updated_at on the older event, but not its SSO time.
    repository.bind_account("registration:old:grok2api-imported", 17)

    assert repository.sso_for_accounts([17]) == {
        17: {"email": "alpha@example.test", "sso": "NEW-SSO"}
    }
    assert repository.account_ids_with_sso([17, 29]) == {17}
    database.dispose()



def test_register_event_priority_hold_roundtrip(tmp_path: Path):
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    repository = RegisterEventRepository(database)
    repository.receive(
        {
            "event_id": "registration:hold:grok2api-imported",
            "email": "hold@example.test",
            "grok2api_account_id": 17,
        }
    )

    held = repository.mark_priority_hold(
        "registration:hold:grok2api-imported",
        original_priority=8,
        held_priority=-1000,
    )
    assert held is not None
    assert held["priority_hold_status"] == "held"
    assert held["original_priority"] == 8
    retried = repository.mark_priority_hold(
        "registration:hold:grok2api-imported",
        original_priority=-1000,
        held_priority=-1000,
    )
    assert retried is not None
    assert retried["original_priority"] == 8
    assert [item["event_id"] for item in repository.list_unresolved_priority_holds()] == [
        "registration:hold:grok2api-imported"
    ]

    repository.mark_priority_restore_failed(
        "registration:hold:grok2api-imported",
        "grok2api unavailable",
    )
    failed = repository.get_event("registration:hold:grok2api-imported")
    assert failed is not None
    assert failed["priority_hold_status"] == "restore_failed"
    assert failed["priority_hold_error"] == "grok2api unavailable"

    repository.mark_priority_restored("registration:hold:grok2api-imported")
    restored = repository.get_event("registration:hold:grok2api-imported")
    assert restored is not None
    assert restored["priority_hold_status"] == "restored"
    assert restored["priority_hold_error"] == ""
    assert repository.list_unresolved_priority_holds() == []
    database.dispose()



def test_register_callback_outbox_is_idempotent_until_delivered(tmp_path: Path):
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    repository = RegisterEventRepository(database)

    first = repository.enqueue_callback(
        "event-1",
        {"event_id": "event-1", "degraded": False, "verdict": "imported"},
    )
    second = repository.enqueue_callback(
        "event-1",
        {"event_id": "event-1", "degraded": True, "verdict": "degraded"},
    )
    assert first is not None
    assert second is not None
    assert first["status"] == "pending"
    assert second["payload"]["degraded"] is True

    claimed = repository.claim_callback_due()
    assert claimed is not None
    assert claimed["attempts"] == 1
    assert claimed["payload"]["verdict"] == "degraded"
    assert repository.claim_callback_due() is None

    repository.complete_callback("event-1")
    ignored = repository.enqueue_callback(
        "event-1",
        {"event_id": "event-1", "degraded": False, "verdict": "normal"},
    )
    assert ignored is not None
    assert ignored["status"] == "delivered"
    assert ignored["payload"]["verdict"] == "degraded"
    database.dispose()
