from __future__ import annotations

from typing import Any

from app.integrations.grok2api.client import Grok2APIClient
from app.persistence.probe_repository import ProbeRepository


class EgressService:
    def __init__(self, *, client: Grok2APIClient, probes: ProbeRepository):
        self.client = client
        self.probes = probes

    async def create(
        self,
        *,
        name: str,
        proxy_url: str,
        proxy_pool: bool,
        account_capacity: int,
        enabled: bool,
    ) -> dict[str, Any]:
        normalized_name = name.strip()
        normalized_proxy_url = proxy_url.strip()
        if not normalized_name:
            raise ValueError("节点名称不能为空")
        if not normalized_proxy_url:
            raise ValueError("代理地址不能为空")
        return await self.client.create_egress_node(
            name=normalized_name,
            proxy_url=normalized_proxy_url,
            proxy_pool=proxy_pool,
            account_capacity=account_capacity,
            enabled=enabled,
        )

    async def set_enabled(self, *, node_ids: list[int], enabled: bool) -> dict[str, Any]:
        unique_ids = self._normalize_ids(node_ids)
        protected_ids = (
            await self._protected_node_ids(set(unique_ids)) if not enabled else set()
        )
        eligible_ids = [
            node_id for node_id in unique_ids if node_id not in protected_ids
        ]
        result = (
            await self.client.set_egress_nodes_enabled(eligible_ids, enabled)
            if eligible_ids
            else {}
        )
        return {
            "requested": len(unique_ids),
            "eligible": len(eligible_ids),
            "updated": int(result.get("updated") or 0),
            "enabled": enabled,
            "skippedNodeIds": sorted(protected_ids),
        }

    async def delete(self, *, node_ids: list[int]) -> dict[str, Any]:
        unique_ids = self._normalize_ids(node_ids)
        protected_ids = await self._protected_node_ids(set(unique_ids))
        eligible_ids = [node_id for node_id in unique_ids if node_id not in protected_ids]
        result = await self.client.delete_egress_nodes(eligible_ids) if eligible_ids else {}
        return {
            "requested": len(unique_ids),
            "eligible": len(eligible_ids),
            "deleted": int(result.get("deleted") or 0),
            "skippedNodeIds": sorted(protected_ids),
        }

    async def test(self, node_id: int) -> dict[str, Any]:
        if node_id <= 0:
            raise ValueError("出口节点 ID 无效")
        return await self.client.test_egress_node(node_id)

    async def _protected_node_ids(self, selected_ids: set[int]) -> set[int]:
        references = self.probes.active_egress_references()
        protected = set(references["nodeIds"])
        current_account_ids = set(references["currentAccountIds"])
        if current_account_ids:
            accounts = await self.client.list_all_accounts(account_ids=current_account_ids)
            found_account_ids = {int(account.get("id") or 0) for account in accounts}
            if current_account_ids - found_account_ids:
                raise ValueError("无法确认运行中探针的当前出口，请稍后重试")
            protected.update(
                int(account.get("egressNodeId") or 0)
                for account in accounts
                if int(account.get("egressNodeId") or 0) > 0
            )
        return protected & selected_ids

    @staticmethod
    def _normalize_ids(node_ids: list[int]) -> list[int]:
        values = list(dict.fromkeys(node_id for node_id in node_ids if node_id > 0))
        if not values:
            raise ValueError("至少选择一个出口节点")
        return values
