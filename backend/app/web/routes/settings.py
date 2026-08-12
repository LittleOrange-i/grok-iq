from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response

from app.core.config import Settings
from app.integrations.grok2api.client import Grok2APIClient
from app.services.probe_manager import ProbeManager
from app.services.scheduler import SchedulerService
from app.services.settings_service import RuntimeSettingsService
from app.services.wechat_notification import WeChatAccountNotificationService
from app.web.schemas import RuntimeSettingsInput

from ._shared import disable_client_cache


def build_settings_router(
    *,
    settings: Settings,
    client: Grok2APIClient,
    runtime_settings: RuntimeSettingsService,
    probes: ProbeManager,
    scheduler: SchedulerService,
    wechat: WeChatAccountNotificationService,
) -> APIRouter:
    router = APIRouter()

    @router.get("/settings")
    def get_runtime_settings() -> dict[str, Any]:
        return runtime_settings.public_view()

    @router.get("/settings/secrets/{secret_name}")
    def reveal_runtime_secret(
        secret_name: str,
        response: Response,
    ) -> dict[str, str]:
        disable_client_cache(response)
        return {"value": runtime_settings.reveal_secret(secret_name)}

    @router.put("/settings")
    async def update_runtime_settings(
        payload: RuntimeSettingsInput,
    ) -> dict[str, Any]:
        changed = runtime_settings.update(payload.runtime_changes())
        if any(key.startswith("grok2api_") for key in changed):
            client.reset_credentials()
        if any(key.startswith("wechat_") for key in changed):
            wechat.reset_credentials()
        await probes.reconfigure()
        await scheduler.reconfigure()
        return {**runtime_settings.public_view(), "changed": changed}

    @router.post("/settings/test-grok2api")
    async def test_grok2api_settings() -> dict[str, Any]:
        client.reset_credentials()
        summary = await client.admin_request(
            "GET", "/api/admin/v1/accounts/summary"
        )
        return {
            "ok": True,
            "baseUrl": settings.grok2api_base_url,
            "grokBuild": summary.get("providers", {}).get("grok_build", {}),
        }

    @router.post("/settings/test-wechat")
    async def test_wechat_settings() -> dict[str, Any]:
        result = await wechat.send_test()
        return {"ok": True, **result}

    return router
