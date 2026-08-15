from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response

from app.services.update_check import UpdateCheckService

from ._shared import disable_client_cache


def build_system_router(updates: UpdateCheckService) -> APIRouter:
    router = APIRouter()

    @router.get("/system/version")
    def get_system_version(response: Response) -> dict[str, Any]:
        disable_client_cache(response)
        return updates.snapshot()

    @router.post("/system/update/check")
    async def check_system_update(response: Response) -> dict[str, Any]:
        disable_client_cache(response)
        return await updates.check()

    return router
