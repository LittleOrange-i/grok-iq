from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest

from app.core.clock import utc_now
from app.core.config import Settings
from app.integrations.grok2api.client import AccountBatchUpdateResult
from app.persistence.account_repository import AccountRepository
from app.persistence.database import Database
from app.persistence.probe_repository import ProbeRepository
from app.services.account_service import QUARANTINE_RECOVERY_PRIORITY, AccountService


class AccountListClient:
    async def list_accounts(self, **_: Any) -> dict[str, Any]:
        return {
            "items": [
                {
                    "id": "1",
                    "name": "Alpha",
                    "email": "alpha@example.test",
                    "enabled": True,
                    "authStatus": "active",
                    "egressNodeId": "12",
                    "egressAssignmentMode": "manual",
                },
                {
                    "id": "2",
                    "name": "Bravo",
                    "email": "bravo@example.test",
                    "enabled": True,
                    "authStatus": "active",
                    "egressNodeId": None,
                },
            ],
            "total": 2,
            "page": 1,
            "pageSize": 50,
        }

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


class EgressClient:
    def __init__(self) -> None:
        self.nodes = [
            {
                "id": "1",
                "name": "unhealthy",
                "enabled": True,
                "proxyConfigured": True,
                "probeStatus": "unhealthy",
                "assignedAccountCount": 0,
                "accountCapacity": 0,
            },
            {
                "id": "2",
                "name": "full",
                "enabled": True,
                "proxyConfigured": True,
                "probeStatus": "healthy",
                "assignedAccountCount": 10,
                "accountCapacity": 10,
            },
            {
                "id": "3",
                "name": "busier",
                "enabled": True,
                "proxyConfigured": True,
                "probeStatus": "healthy",
                "assignedAccountCount": 5,
                "accountCapacity": 0,
            },
            {
                "id": "4",
                "name": "least-loaded",
                "enabled": True,
                "proxyConfigured": True,
                "probeStatus": "healthy",
                "assignedAccountCount": 2,
                "accountCapacity": 0,
            },
        ]
        self.bindings: list[tuple[list[int], int | None, str]] = []

    async def list_egress_nodes(self, **_: Any) -> dict[str, Any]:
        return {"items": self.nodes}

    async def set_accounts_egress(
        self,
        account_ids: list[int],
        node_id: int | None,
        *,
        mode: str,
    ) -> AccountBatchUpdateResult:
        self.bindings.append((account_ids, node_id, mode))
        return AccountBatchUpdateResult(updated=len(account_ids))

    async def get_account(self, account_id: int) -> dict[str, Any]:
        node_id = self.bindings[-1][1] if self.bindings else None
        return {
            "id": str(account_id),
            "enabled": True,
            "authStatus": "active",
            "egressNodeId": str(node_id) if node_id is not None else None,
            "egressAssignmentMode": self.bindings[-1][2] if node_id is not None else "",
        }


class LockedProbeSettings:
    def account_settings_locked_ids(self, account_ids: set[int]) -> set[int]:
        return account_ids & {2}


@pytest.mark.asyncio
async def test_select_account_ids_applies_filters_and_excludes_auth_failures(tmp_path: Path):
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    accounts = AccountRepository(database)
    probes = ProbeRepository(database)
    accounts.set_manual_status(account_id=1, status="suspect", note="")
    accounts.set_manual_status(account_id=3, status="suspect", note="")
    service = AccountService(
        settings=Settings(database_path=tmp_path / "grokiq.db"),
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
async def test_account_options_include_egress_binding(tmp_path: Path):
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    service = AccountService(
        settings=Settings(database_path=tmp_path / "grokiq.db"),
        client=AccountListClient(),  # type: ignore[arg-type]
        accounts=AccountRepository(database),
        probes=ProbeRepository(database),
    )

    result = await service.list_account_options(page=1, page_size=50)

    assert result["items"][0]["egressNodeId"] == "12"
    assert result["items"][0]["egressAssignmentMode"] == "manual"
    assert result["items"][1]["egressNodeId"] is None


@pytest.mark.asyncio
async def test_webhook_account_auto_binding_uses_least_loaded_healthy_node(tmp_path: Path):
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    client = EgressClient()
    service = AccountService(
        settings=Settings(database_path=tmp_path / "grokiq.db"),
        client=client,  # type: ignore[arg-type]
        accounts=AccountRepository(database),
        probes=ProbeRepository(database),
    )

    result = await service.ensure_account_egress({"id": "41", "egressNodeId": None})

    assert client.bindings == [([41], 4, "manual")]
    assert result["egressNodeId"] == "4"
    assert result["egressAssignmentMode"] == "manual"

    same = await service.ensure_account_egress(result)
    assert same is result
    assert client.bindings == [([41], 4, "manual")]


@pytest.mark.asyncio
async def test_batch_egress_binding_skips_probe_locked_accounts(tmp_path: Path):
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    client = EgressClient()
    service = AccountService(
        settings=Settings(database_path=tmp_path / "grokiq.db"),
        client=client,  # type: ignore[arg-type]
        accounts=AccountRepository(database),
        probes=LockedProbeSettings(),  # type: ignore[arg-type]
    )

    result = await service.set_accounts_egress(
        account_ids=[1, 2, 3, 2],
        egress_node_id=9,
    )

    assert client.bindings == [([1, 3], 9, "manual")]
    assert result == {
        "requested": 3,
        "eligible": 2,
        "updated": 2,
        "egressNodeId": 9,
        "assignmentMode": "manual",
        "skippedAccountIds": [2],
        "failedAccountIds": [],
        "failures": [],
    }


@pytest.mark.asyncio
async def test_quarantine_recovery_uses_lowest_priority_and_exposes_guard_filter(tmp_path: Path):
    database = Database(tmp_path / "grokiq.db")
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
        settings=Settings(database_path=tmp_path / "grokiq.db"),
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
