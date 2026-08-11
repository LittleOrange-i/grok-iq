from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest

from app.core.clock import utc_now
from app.core.config import Settings
from app.persistence.account_repository import AccountRepository
from app.persistence.database import Database
from app.persistence.probe_repository import ProbeRepository
from app.services.account_service import QUARANTINE_RECOVERY_PRIORITY, AccountService


class AccountListClient:
    async def list_all_accounts(self, **_: Any) -> list[dict[str, Any]]:
        return [
            {
                "id": "1",
                "name": "Alpha",
                "email": "alpha@example.test",
                "enabled": True,
                "authStatus": "active",
            },
            {
                "id": "2",
                "name": "Bravo",
                "email": "bravo@example.test",
                "enabled": False,
                "authStatus": "active",
            },
            {
                "id": "3",
                "name": "Blocked",
                "email": "blocked@example.test",
                "enabled": True,
                "authStatus": "error",
            },
        ]


class RecoveryClient:
    def __init__(self) -> None:
        self.accounts = [
            {
                "id": "1",
                "name": "Recovered",
                "email": "recovered@example.test",
                "enabled": False,
                "authStatus": "active",
                "priority": 100,
            },
            {
                "id": "2",
                "name": "Regular",
                "email": "regular@example.test",
                "enabled": True,
                "authStatus": "active",
                "priority": 100,
            },
        ]
        self.recovery_calls: list[tuple[int, int]] = []

    async def list_all_accounts(self, **_: Any) -> list[dict[str, Any]]:
        return self.accounts

    async def recover_account_at_priority(self, account_id: int, *, priority: int) -> None:
        self.recovery_calls.append((account_id, priority))
        account = next(item for item in self.accounts if int(item["id"]) == account_id)
        account["enabled"] = True
        account["priority"] = priority


@pytest.mark.asyncio
async def test_select_account_ids_applies_filters_and_excludes_auth_failures(tmp_path: Path):
    database = Database(tmp_path / "monitor.db")
    database.initialize()
    accounts = AccountRepository(database)
    probes = ProbeRepository(database)
    accounts.set_manual_status(account_id=1, status="suspect", note="")
    accounts.set_manual_status(account_id=3, status="suspect", note="")
    service = AccountService(
        settings=Settings(database_path=tmp_path / "monitor.db"),
        client=AccountListClient(),  # type: ignore[arg-type]
        accounts=accounts,
        probes=probes,
    )

    all_matching = await service.select_account_ids(search="example.test")
    assert all_matching == {
        "accountIds": [1, 2],
        "disabledAccountIds": [2],
        "matched": 3,
        "selectable": 2,
        "excluded": 1,
    }

    suspect = await service.select_account_ids(monitor_status="suspect")
    assert suspect["accountIds"] == [1]
    assert suspect["matched"] == 2
    assert suspect["excluded"] == 1


@pytest.mark.asyncio
async def test_quarantine_recovery_uses_lowest_priority_and_exposes_guard_filter(tmp_path: Path):
    database = Database(tmp_path / "monitor.db")
    database.initialize()
    accounts = AccountRepository(database)
    probes = ProbeRepository(database)
    client = RecoveryClient()
    accounts.set_manual_status(
        account_id=1,
        status="quarantined",
        note="auto quarantine",
        quarantine_until=utc_now() - timedelta(minutes=1),
        previous_upstream_enabled=True,
        disabled_by_monitor=True,
    )
    service = AccountService(
        settings=Settings(database_path=tmp_path / "monitor.db"),
        client=client,  # type: ignore[arg-type]
        accounts=accounts,
        probes=probes,
    )

    result = await service.recover_due_quarantines()

    assert result == {
        "restored": 1,
        "guarded": 1,
        "priority": QUARANTINE_RECOVERY_PRIORITY,
        "failed": [],
    }
    assert client.recovery_calls == [(1, QUARANTINE_RECOVERY_PRIORITY)]
    stored = accounts.get_assessment(1)
    assert stored is not None
    assert stored["monitor_status"] == "healthy"
    assert stored["disabled_by_monitor"] is False
    assert stored["previous_upstream_enabled"] is None
    assert stored["recovery_guarded"] is True

    page = await service.list_accounts(
        page=1,
        page_size=50,
        recovery_guarded="true",
    )
    assert [item["id"] for item in page["items"]] == ["1"]
    assert page["items"][0]["priority"] == QUARANTINE_RECOVERY_PRIORITY
    selection = await service.select_account_ids(recovery_guarded="true")
    assert selection["accountIds"] == [1]
