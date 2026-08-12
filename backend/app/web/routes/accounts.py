from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.services.account_service import AccountService
from app.web.schemas import (
    AccountActionInput,
    AccountBatchDeleteInput,
    AccountBatchEgressInput,
    AccountBatchUpdateInput,
)


def build_accounts_router(service: AccountService) -> APIRouter:
    router = APIRouter()

    @router.get("/dashboard")
    async def dashboard(
        hours: int = Query(default=168, ge=1, le=8760),
    ) -> dict[str, Any]:
        return await service.dashboard(hours)

    @router.get("/accounts")
    async def accounts(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
        search: str = "",
        enabled: str = "",
        upstream_status: str = Query(default="", alias="status"),
        monitor_status: str = Query(default="", alias="monitorStatus"),
        recovery_guarded: str = Query(default="", alias="recoveryGuarded"),
    ) -> dict[str, Any]:
        return await service.list_accounts(
            page=page,
            page_size=page_size,
            search=search,
            enabled=enabled,
            upstream_status=upstream_status,
            monitor_status=monitor_status,
            recovery_guarded=recovery_guarded,
        )

    @router.get("/accounts/selection")
    async def account_selection(
        search: str = "",
        enabled: str = "",
        upstream_status: str = Query(default="", alias="status"),
        monitor_status: str = Query(default="", alias="monitorStatus"),
        recovery_guarded: str = Query(default="", alias="recoveryGuarded"),
    ) -> dict[str, Any]:
        return await service.select_account_ids(
            search=search,
            enabled=enabled,
            upstream_status=upstream_status,
            monitor_status=monitor_status,
            recovery_guarded=recovery_guarded,
        )

    @router.get("/accounts/options")
    async def account_options(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
        search: str = "",
        upstream_status: str = Query(default="", alias="status"),
    ) -> dict[str, Any]:
        return await service.list_account_options(
            page=page,
            page_size=page_size,
            search=search,
            upstream_status=upstream_status,
        )

    @router.put("/accounts/batch")
    async def batch_update_accounts(
        payload: AccountBatchUpdateInput,
    ) -> dict[str, Any]:
        return await service.set_accounts_enabled(
            account_ids=payload.account_ids,
            enabled=payload.enabled,
        )

    @router.delete("/accounts/batch")
    async def batch_delete_accounts(
        payload: AccountBatchDeleteInput,
    ) -> dict[str, Any]:
        return await service.delete_upstream_accounts(
            account_ids=payload.account_ids,
        )

    @router.put("/accounts/batch/egress")
    async def batch_update_account_egress(
        payload: AccountBatchEgressInput,
    ) -> dict[str, Any]:
        return await service.set_accounts_egress(
            account_ids=payload.account_ids,
            egress_node_id=payload.egress_node_id,
        )

    @router.get("/accounts/{account_id}")
    async def account_detail(
        account_id: int,
        limit: int = Query(default=200, ge=10, le=1000),
    ) -> dict[str, Any]:
        return await service.detail(account_id, limit)

    @router.post("/accounts/{account_id}/action")
    async def account_action(
        account_id: int,
        payload: AccountActionInput,
    ) -> dict[str, Any]:
        return await service.action(
            account_id=account_id,
            action=payload.action,
            note=payload.note,
            propagate=payload.propagate,
            quarantine_minutes=payload.quarantine_minutes,
        )

    @router.delete("/accounts/{account_id}")
    async def delete_account(account_id: int) -> dict[str, Any]:
        return await service.delete_upstream_account(account_id)

    return router
