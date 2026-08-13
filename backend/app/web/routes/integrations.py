from __future__ import annotations

import hmac
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from app.core.config import Settings
from app.services.register_integration import RegisterIntegrationService
from app.web.schemas import RegisterAccountEvent


def build_integrations_router(
    settings: Settings,
    register: RegisterIntegrationService,
) -> APIRouter:
    router = APIRouter()

    def require_register_token(request: Request) -> None:
        expected_token = settings.grok_register_webhook_token.strip()
        if not expected_token:
            raise HTTPException(
                status_code=503,
                detail="grok-register 联动令牌尚未配置",
            )
        supplied_token = request.headers.get("x-grokiq-token", "").strip()
        if not hmac.compare_digest(supplied_token, expected_token):
            raise HTTPException(status_code=401, detail="联动令牌无效")

    @router.post(
        "/integrations/grok-register/account-created",
        status_code=202,
    )
    @router.post(
        "/integrations/grok-register/account-imported",
        status_code=202,
    )
    async def grok_register_account_created(
        payload: RegisterAccountEvent,
        request: Request,
    ) -> dict[str, Any]:
        require_register_token(request)
        return register.accept(payload.model_dump())

    return router


def build_register_events_router(
    register: RegisterIntegrationService,
) -> APIRouter:
    router = APIRouter()

    @router.get("/register-webhook-events")
    async def register_webhook_events(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
        status: str = "",
        search: str = "",
    ) -> dict[str, Any]:
        return register.list_events(
            page=page,
            page_size=page_size,
            status=status,
            search=search,
        )

    return router
