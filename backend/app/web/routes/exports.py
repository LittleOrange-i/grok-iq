from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.services.export_service import ExportService


def build_exports_router(service: ExportService) -> APIRouter:
    router = APIRouter()

    @router.get("/exports/quarantine")
    async def export_quarantine(
        fmt: str = Query(default="csv", alias="format"),
    ) -> Response:
        return await _render(service, "quarantine", fmt)

    @router.get("/exports/high-risk")
    async def export_high_risk(
        fmt: str = Query(default="csv", alias="format"),
    ) -> Response:
        return await _render(service, "high-risk", fmt)

    @router.get("/exports/request-audits")
    async def export_request_audits(
        fmt: str = Query(default="csv", alias="format"),
        account: str = "",
        account_id: int | None = Query(default=None, ge=1, alias="accountId"),
        risk: str = Query(default="", pattern="^(|risky|normal|watch|high)$"),
        client_key: str = Query(default="", alias="clientKey"),
        egress_node_id: int | None = Query(default=None, ge=1, alias="egressNodeId"),
        window_preset: str = Query(
            default="today",
            alias="window",
            pattern="^(today|1h|3h|6h|24h|7d|30d|custom)$",
        ),
        start_at: str | None = Query(default=None, alias="startAt"),
        end_at: str | None = Query(default=None, alias="endAt"),
    ) -> Response:
        return await _render(
            service,
            "request-audits",
            fmt,
            account=account,
            account_id=account_id,
            risk=risk,
            client_key=client_key,
            egress_node_id=egress_node_id,
            window_preset=window_preset,
            start_at=start_at,
            end_at=end_at,
        )

    @router.get("/exports/probe-samples")
    async def export_probe_samples(
        fmt: str = Query(default="csv", alias="format"),
        account_id: int | None = Query(default=None, ge=1, alias="accountId"),
    ) -> Response:
        return await _render(
            service,
            "probe-samples",
            fmt,
            account_id=account_id,
        )

    return router


async def _render(service: ExportService, kind: str, fmt: str, **filters: Any) -> Response:
    try:
        return await service.render(kind, fmt, **filters)
    except ValueError as error:
        status = 503 if "未启用" in str(error) else 400
        raise HTTPException(status_code=status, detail=str(error)) from error
