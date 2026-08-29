from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response

from app.integrations.grok2api.client import Grok2APIClient
from app.services.account_service import AccountService
from app.services.client_key_quota_service import ClientKeyQuotaService
from app.web.schemas import ClientKeyQuotaInput

from ._shared import disable_client_cache


def build_public_router(
    account_service: AccountService,
    client: Grok2APIClient,
) -> APIRouter:
    router = APIRouter()
    quota_service = ClientKeyQuotaService(client)

    @router.get("/public/upstream-accounts")
    async def public_upstream_accounts(response: Response) -> dict[str, Any]:
        disable_client_cache(response)
        return await account_service.public_upstream_account_summary()

    @router.post("/public/client-key-quota")
    async def public_client_key_quota(
        payload: ClientKeyQuotaInput,
        request: Request,
        response: Response,
    ) -> dict[str, Any]:
        disable_client_cache(response)
        return await quota_service.lookup(payload.api_key, client_ip=_client_ip(request))

    return router


def _client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",", 1)[0].strip()
    if forwarded:
        return forwarded
    real_ip = (request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip
    host = request.client.host if request.client else ""
    return host or "unknown"
