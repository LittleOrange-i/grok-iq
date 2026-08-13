from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.services.auth_service import AuthenticationError, AuthService

admin_bearer = HTTPBearer(
    auto_error=False,
    scheme_name="AdminJWT",
    description="GrokIQ administrator JWT",
)


class AdminAuthenticationRequired(Exception):
    """Raised by the FastAPI dependency when an administrator session is absent."""

    def __init__(self, message: str, *, setup_required: bool):
        super().__init__(message)
        self.message = message
        self.setup_required = setup_required


def build_admin_auth_dependency(
    auth_service: AuthService,
) -> Callable[..., dict[str, Any]]:
    """Create the request-scoped dependency used by protected API routers."""

    def require_admin(
        request: Request,
        credentials: Annotated[
            HTTPAuthorizationCredentials | None,
            Depends(admin_bearer),
        ],
    ) -> dict[str, Any]:
        authorization = (
            f"{credentials.scheme} {credentials.credentials}" if credentials else ""
        )
        try:
            user = auth_service.authenticate_authorization(authorization)
        except AuthenticationError as exc:
            setup_required = auth_service.setup_required()
            message = "请先创建管理员账号" if setup_required else str(exc)
            raise AdminAuthenticationRequired(
                message,
                setup_required=setup_required,
            ) from exc
        request.state.auth_user = user
        return user

    return require_admin
