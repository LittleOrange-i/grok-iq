from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response

from app.services.account_service import AccountService

from ._shared import disable_client_cache


def build_public_router(account_service: AccountService) -> APIRouter:
    router = APIRouter()

    @router.get("/public/upstream-accounts")
    async def public_upstream_accounts(response: Response) -> dict[str, Any]:
        disable_client_cache(response)
        return await account_service.public_upstream_account_summary()

    return router
