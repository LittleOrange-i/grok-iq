from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Response

from app.services.request_audit_service import RequestAuditService
from app.web.schemas import RequestAuditScanInput

from ._shared import disable_client_cache


def build_request_audits_router(service: RequestAuditService) -> APIRouter:
    router = APIRouter()

    @router.get("/request-audits")
    def request_audits(
        response: Response,
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
        account: str = "",
        risk: str = Query(default="", pattern="^(|normal|watch|high)$"),
        egress_ip: str = Query(default="", alias="egressIp"),
        window_preset: str = Query(
            default="today",
            alias="window",
            pattern="^(today|6h|24h|7d|30d|custom)$",
        ),
        start_at: str | None = Query(default=None, alias="startAt"),
        end_at: str | None = Query(default=None, alias="endAt"),
    ) -> dict[str, Any]:
        disable_client_cache(response)
        return service.list_page(
            page=page,
            page_size=page_size,
            account=account,
            risk=risk,
            egress_ip=egress_ip,
            window_preset=window_preset,
            start_at=start_at,
            end_at=end_at,
        )

    @router.get("/request-audits/summary")
    def request_audit_summary(
        response: Response,
        window_preset: str = Query(
            default="today",
            alias="window",
            pattern="^(today|6h|24h|7d|30d|custom)$",
        ),
        start_at: str | None = Query(default=None, alias="startAt"),
        end_at: str | None = Query(default=None, alias="endAt"),
    ) -> dict[str, Any]:
        disable_client_cache(response)
        return service.summary(
            window_preset=window_preset,
            start_at=start_at,
            end_at=end_at,
        )

    @router.get("/request-audits/status")
    def request_audit_status(response: Response) -> dict[str, Any]:
        disable_client_cache(response)
        return service.status()

    @router.post("/request-audits/scan")
    async def scan_request_audits(
        response: Response,
        payload: RequestAuditScanInput | None = None,
    ) -> dict[str, Any]:
        disable_client_cache(response)
        value = payload or RequestAuditScanInput()
        return await service.scan(
            trigger="manual",
            window_preset=value.window_preset,
            start_at=value.start_at,
            end_at=value.end_at,
        )

    return router
