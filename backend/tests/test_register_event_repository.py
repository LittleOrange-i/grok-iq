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

    filtered = repository.list_events(
        page=1,
        page_size=20,
        status="pending",
        search="29",
    )
    assert filtered["total"] == 1
    assert filtered["items"][0]["email"] == "beta@example.test"
    database.dispose()
