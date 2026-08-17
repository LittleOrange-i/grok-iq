from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.integrations.grok2api.client import Grok2APIClient
from app.services.egress_service import EgressService
from app.web.schemas import (
    EgressNodeBatchDeleteInput,
    EgressNodeBatchUpdateInput,
    EgressNodeCreateInput,
    EgressNodeUpdateInput,
)


def build_egress_router(
    client: Grok2APIClient,
    service: EgressService,
) -> APIRouter:
    router = APIRouter()

    @router.get("/egress-nodes")
    async def egress_nodes(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=100, ge=1, le=500, alias="pageSize"),
        search: str = "",
        enabled: str = "",
        probe: str = "",
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "pageSize": page_size}
        if search:
            params["search"] = search
        if enabled:
            params["enabled"] = enabled
        if probe:
            params["probe"] = probe
        return await client.list_egress_nodes(**params)

    @router.patch("/egress-nodes/batch")
    async def update_egress_nodes(
        payload: EgressNodeBatchUpdateInput,
    ) -> dict[str, Any]:
        return await service.set_enabled(
            node_ids=payload.node_ids,
            enabled=payload.enabled,
        )

    @router.post("/egress-nodes", status_code=201)
    async def create_egress_node(
        payload: EgressNodeCreateInput,
    ) -> dict[str, Any]:
        return await service.create(
            name=payload.name,
            proxy_url=payload.proxy_url,
            proxy_pool=payload.proxy_pool,
            account_capacity=payload.account_capacity,
            enabled=payload.enabled,
        )

    @router.put("/egress-nodes/{node_id}")
    async def update_egress_node(
        node_id: int,
        payload: EgressNodeUpdateInput,
    ) -> dict[str, Any]:
        return await service.update(
            node_id=node_id,
            name=payload.name,
            proxy_url=payload.proxy_url,
            proxy_pool=payload.proxy_pool,
            account_capacity=payload.account_capacity,
        )

    @router.delete("/egress-nodes")
    async def delete_egress_nodes(
        payload: EgressNodeBatchDeleteInput,
    ) -> dict[str, Any]:
        return await service.delete(node_ids=payload.node_ids)

    @router.post("/egress-nodes/{node_id}/test")
    async def test_egress_node(node_id: int) -> dict[str, Any]:
        return await service.test(node_id)

    return router
