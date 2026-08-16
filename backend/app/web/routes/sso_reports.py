from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from app.services.sso_report_service import SsoReportService
from app.web.schemas import AccountSsoReportInput, BulkIdsInput, SsoReportCreateInput


def build_sso_reports_router(service: SsoReportService) -> APIRouter:
    router = APIRouter(prefix="/sso-reports")

    @router.get("")
    def list_reports() -> list[dict[str, Any]]:
        return service.list()

    @router.post("", status_code=status.HTTP_202_ACCEPTED)
    async def create_report(payload: SsoReportCreateInput) -> dict[str, Any]:
        return service.create(
            payload.name,
            payload.sso_content,
            payload.proxy,
            concurrency=payload.concurrency,
            request_timeout_seconds=payload.request_timeout_seconds,
        )

    @router.post("/accounts", status_code=status.HTTP_202_ACCEPTED)
    async def create_account_report(
        payload: AccountSsoReportInput,
    ) -> dict[str, Any]:
        return service.create_for_accounts(payload.account_ids)

    @router.get("/{report_id}")
    def report_detail(report_id: str) -> dict[str, Any]:
        return service.get(report_id)

    @router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_report(report_id: str) -> Response:
        service.delete_many([report_id])
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.delete("")
    def delete_reports(payload: BulkIdsInput) -> dict[str, Any]:
        return service.delete_many(payload.ids)

    return router
