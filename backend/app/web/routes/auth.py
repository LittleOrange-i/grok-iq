from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.services.auth_service import AuthService
from app.web.schemas import AuthLoginInput, AuthSetupInput

from ._shared import disable_client_cache


def build_auth_router(
    auth_service: AuthService,
    require_admin: Callable[..., dict[str, Any]],
) -> APIRouter:
    router = APIRouter()
    protected = APIRouter(dependencies=[Depends(require_admin)])

    @router.get("/auth/status")
    def auth_status(request: Request, response: Response) -> dict[str, Any]:
        disable_client_cache(response)
        return auth_service.status(request.headers.get("authorization", ""))

    @router.post("/auth/setup")
    def auth_setup(payload: AuthSetupInput, response: Response) -> dict[str, Any]:
        disable_client_cache(response)
        return auth_service.setup(
            payload.username,
            payload.password,
            payload.confirm_password,
        )

    @router.post("/auth/login")
    def auth_login(payload: AuthLoginInput, response: Response) -> dict[str, Any]:
        disable_client_cache(response)
        if auth_service.setup_required():
            raise HTTPException(status_code=409, detail="请先创建管理员账号")
        return auth_service.login(payload.username, payload.password)

    @protected.get("/auth/me")
    def auth_me(request: Request, response: Response) -> dict[str, Any]:
        disable_client_cache(response)
        user = getattr(request.state, "auth_user", None)
        if user is None:
            raise HTTPException(status_code=401, detail="请先登录")
        return {"user": auth_service.public_user(user)}

    @protected.post("/auth/logout")
    def auth_logout(request: Request, response: Response) -> dict[str, bool]:
        disable_client_cache(response)
        user = getattr(request.state, "auth_user", None)
        if user is None:
            raise HTTPException(status_code=401, detail="请先登录")
        auth_service.logout(user)
        return {"loggedOut": True}

    router.include_router(protected)
    return router
