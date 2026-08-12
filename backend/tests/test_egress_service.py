from __future__ import annotations

from typing import Any

import pytest

from app.services.egress_service import EgressService


class RecordingEgressClient:
    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []
        self.enabled: list[tuple[list[int], bool]] = []
        self.deleted: list[list[int]] = []
        self.accounts: list[dict[str, Any]] = []

    async def create_egress_node(self, **values: Any) -> dict[str, Any]:
        self.created.append(values)
        return {"id": "9", **values}

    async def set_egress_nodes_enabled(
        self,
        node_ids: list[int],
        enabled: bool,
    ) -> dict[str, Any]:
        self.enabled.append((node_ids, enabled))
        return {"updated": len(node_ids)}

    async def delete_egress_nodes(self, node_ids: list[int]) -> dict[str, Any]:
        self.deleted.append(node_ids)
        return {"deleted": len(node_ids)}

    async def list_all_accounts(
        self,
        account_ids: set[int],
    ) -> list[dict[str, Any]]:
        return [
            account
            for account in self.accounts
            if int(account["id"]) in account_ids
        ]


class EgressReferences:
    def __init__(
        self,
        *,
        node_ids: set[int] | None = None,
        current_account_ids: set[int] | None = None,
    ) -> None:
        self.node_ids = node_ids or set()
        self.current_account_ids = current_account_ids or set()

    def active_egress_references(self) -> dict[str, set[int]]:
        return {
            "nodeIds": self.node_ids,
            "currentAccountIds": self.current_account_ids,
        }


@pytest.mark.asyncio
async def test_create_forwards_proxy_without_storing_a_local_copy():
    client = RecordingEgressClient()
    service = EgressService(
        client=client,  # type: ignore[arg-type]
        probes=EgressReferences(),  # type: ignore[arg-type]
    )

    result = await service.create(
        name=" Resin A ",
        proxy_url=" socks5h://pool.{account}:secret@resin:2260 ",
        proxy_pool=True,
        account_capacity=120,
        enabled=True,
    )

    assert result["id"] == "9"
    assert client.created == [
        {
            "name": "Resin A",
            "proxy_url": "socks5h://pool.{account}:secret@resin:2260",
            "proxy_pool": True,
            "account_capacity": 120,
            "enabled": True,
        }
    ]


@pytest.mark.asyncio
async def test_disable_skips_explicit_and_current_active_probe_nodes():
    client = RecordingEgressClient()
    client.accounts = [{"id": "41", "egressNodeId": "8"}]
    service = EgressService(
        client=client,  # type: ignore[arg-type]
        probes=EgressReferences(
            node_ids={7},
            current_account_ids={41},
        ),  # type: ignore[arg-type]
    )

    result = await service.set_enabled(node_ids=[7, 8, 9, 9], enabled=False)

    assert client.enabled == [([9], False)]
    assert result == {
        "requested": 3,
        "eligible": 1,
        "updated": 1,
        "enabled": False,
        "skippedNodeIds": [7, 8],
    }


@pytest.mark.asyncio
async def test_delete_skips_nodes_referenced_by_active_probes():
    client = RecordingEgressClient()
    service = EgressService(
        client=client,  # type: ignore[arg-type]
        probes=EgressReferences(node_ids={2}),  # type: ignore[arg-type]
    )

    result = await service.delete(node_ids=[1, 2, 3])

    assert client.deleted == [[1, 3]]
    assert result["deleted"] == 2
    assert result["skippedNodeIds"] == [2]


@pytest.mark.asyncio
async def test_enable_does_not_wait_for_active_probe_references():
    client = RecordingEgressClient()
    service = EgressService(
        client=client,  # type: ignore[arg-type]
        probes=EgressReferences(node_ids={2}),  # type: ignore[arg-type]
    )

    result = await service.set_enabled(node_ids=[2], enabled=True)

    assert client.enabled == [([2], True)]
    assert result["skippedNodeIds"] == []
