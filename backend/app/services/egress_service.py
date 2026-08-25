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

    async def set_enabled(
        self, *, node_ids: list[int], enabled: bool
    ) -> dict[str, Any]:
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

    async def update(
        self,
        *,
        node_id: int,
        name: str,
        proxy_url: str,
        proxy_pool: bool,
        account_capacity: int,
    ) -> dict[str, Any]:
        if node_id <= 0:
            raise ValueError("出口节点 ID 无效")
        normalized_name = name.strip()
        if not normalized_name:
            raise ValueError("节点名称不能为空")
        normalized_proxy_url = proxy_url.strip()
        current = await self._find_node(node_id)
        if current is None:
            raise ValueError("出口节点不存在")
        return await self.client.update_egress_node(
            node_id,
            name=normalized_name,
            proxy_pool=proxy_pool,
            account_capacity=account_capacity,
            enabled=bool(current.get("enabled")),
            proxy_url=normalized_proxy_url or None,
        )

    async def delete(self, *, node_ids: list[int]) -> dict[str, Any]:
        unique_ids = self._normalize_ids(node_ids)
        protected_ids = await self._protected_node_ids(set(unique_ids))
        eligible_ids = [
            node_id for node_id in unique_ids if node_id not in protected_ids
        ]
        result = (
            await self.client.delete_egress_nodes(eligible_ids)
            if eligible_ids
            else {}
        )
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

    async def bind_all_accounts(
        self,
        *,
        node_ids: list[int],
        accounts_per_node: int,
    ) -> dict[str, Any]:
        """Distribute every grok_build account across the selected nodes."""

        unique_nodes = self._normalize_ids(node_ids)
        if accounts_per_node <= 0:
            raise ValueError("每个出口的账号数必须大于 0")
        if len(unique_nodes) < 2:
            raise ValueError("至少选择两个出口节点")
        nodes = await self._find_nodes(set(unique_nodes))
        missing = [node_id for node_id in unique_nodes if node_id not in nodes]
        if missing:
            raise ValueError(f"出口节点不存在：{', '.join(map(str, missing))}")
        unavailable = [
            str(node_id)
            for node_id in unique_nodes
            if not bool(nodes[node_id].get("enabled"))
            or not bool(nodes[node_id].get("proxyConfigured"))
        ]
        if unavailable:
            raise ValueError(
                f"出口节点 {', '.join(unavailable)} 未启用或未配置代理"
            )
        accounts = await self.client.list_all_accounts()
        account_ids = list(
            dict.fromkeys(int(account.get("id") or 0) for account in accounts)
        )
        account_ids = [account_id for account_id in account_ids if account_id > 0]
        if not account_ids:
            return {
                "requested": 0,
                "updated": 0,
                "accountsPerNode": accounts_per_node,
                "nodeIds": unique_nodes,
                "assignments": [],
                "skippedAccountIds": [],
                "failedAccountIds": [],
                "failures": [],
            }

        recommended = (len(account_ids) + len(unique_nodes) - 1) // len(unique_nodes)
        if accounts_per_node < recommended:
            raise ValueError(
                f"每个出口至少需要 {recommended} 个账号才能覆盖全部 {len(account_ids)} 个账号"
            )
        over_capacity = [
            str(node_id)
            for node_id in unique_nodes
            if 0 < int(nodes[node_id].get("accountCapacity") or 0) < recommended
        ]
        if over_capacity:
            raise ValueError(
                f"出口节点 {', '.join(over_capacity)} 的账号容量小于平均分配所需的 {recommended} 个账号"
            )
        locked_ids = self.probes.account_settings_locked_ids(set(account_ids))
        eligible_ids = [
            account_id for account_id in account_ids if account_id not in locked_ids
        ]
        assignments: list[dict[str, Any]] = []
        failures: list[dict[str, Any]] = []
        updated = 0
        base_size, remainder = divmod(len(eligible_ids), len(unique_nodes))
        start = 0
        for index, node_id in enumerate(unique_nodes):
            batch_size = base_size + (1 if index < remainder else 0)
            batch = eligible_ids[start : start + batch_size]
            start += batch_size
            if not batch:
                continue
            result = await self.client.set_accounts_egress(
                batch, node_id, mode="manual"
            )
            batch_failures = [
                {"id": failure.account_id, "error": failure.error}
                for failure in result.failures
            ]
            failures.extend(batch_failures)
            updated += result.updated
            assignments.append(
                {
                    "nodeId": node_id,
                    "requested": len(batch),
                    "updated": result.updated,
                }
            )
        return {
            "requested": len(account_ids),
            "updated": updated,
            "accountsPerNode": accounts_per_node,
            "recommendedAccountsPerNode": recommended,
            "nodeIds": unique_nodes,
            "assignments": assignments,
            "skippedAccountIds": sorted(locked_ids),
            "failedAccountIds": sorted({int(item["id"]) for item in failures}),
            "failures": failures,
        }

    async def _find_nodes(self, node_ids: set[int]) -> dict[int, dict[str, Any]]:
        found: dict[int, dict[str, Any]] = {}
        page = 1
        while page <= 100 and set(found) != node_ids:
            payload = await self.client.list_egress_nodes(page=page, pageSize=500)
            items = payload.get("items", [])
            if not isinstance(items, list) or not items:
                break
            for item in items:
                if not isinstance(item, dict):
                    continue
                node_id = int(item.get("id") or 0)
                if node_id in node_ids:
                    found[node_id] = item
            total = int(payload.get("total") or 0)
            size = int(payload.get("pageSize") or len(items) or 500)
            if (total and page * size >= total) or len(items) < size:
                break
            page += 1
        return found

    async def _find_node(self, node_id: int) -> dict[str, Any] | None:
        page = 1
        while page <= 100:
            payload = await self.client.list_egress_nodes(
                scope="grok_build", page=page, pageSize=500
            )
            items = payload.get("items", [])
            if not isinstance(items, list) or not items:
                return None
            for item in items:
                if isinstance(item, dict) and int(item.get("id") or 0) == node_id:
                    return item
            total = int(payload.get("total") or 0)
            size = int(payload.get("pageSize") or len(items) or 500)
            if (total and page * size >= total) or len(items) < size:
                return None
            page += 1
        return None

    async def _protected_node_ids(self, selected_ids: set[int]) -> set[int]:
        references = self.probes.active_egress_references()
        protected = set(references["nodeIds"])
        current_account_ids = set(references["currentAccountIds"])
        if current_account_ids:
            accounts = await self.client.list_all_accounts(
                account_ids=current_account_ids
            )
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
