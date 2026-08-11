from __future__ import annotations

import hmac
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.core.clock import app_now
from app.core.config import Settings
from app.integrations.grok2api.client import Grok2APIClient, IntegrationError
from app.persistence.account_repository import AccountRepository
from app.persistence.auth_repository import AdminAlreadyExistsError
from app.persistence.probe_repository import ProbeRepository, QueueFullError, RunStateError
from app.services.account_service import AccountService
from app.services.auth_service import AuthenticationError, AuthService
from app.services.chat_service import ChatService, ChatUpstreamError
from app.services.probe_manager import ProbeManager
from app.services.register_integration import RegisterIntegrationService
from app.services.scheduler import SchedulerService
from app.services.settings_service import RuntimeSettingsService

from .auth import build_admin_auth_dependency
from .schemas import (
    AccountActionInput,
    AccountBatchUpdateInput,
    AuthLoginInput,
    AuthSetupInput,
    BulkIdsInput,
    ChatProviderCreateInput,
    ChatProviderUpdateInput,
    ProbePlanEnabledInput,
    ProbePlanInput,
    ProbeRunBatchCreate,
    ProbeRunCreate,
    ProfileInput,
    RegisterAccountEvent,
    RuntimeSettingsInput,
)


def _http_error(exc: Exception, status: int = 400) -> HTTPException:
    if isinstance(exc, ChatUpstreamError):
        return HTTPException(
            status_code=exc.status_code if 400 <= exc.status_code < 600 else 502,
            detail=str(exc),
        )
    if isinstance(exc, IntegrationError):
        return HTTPException(status_code=502, detail=str(exc))
    if isinstance(exc, QueueFullError):
        return HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, RunStateError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=status, detail=str(exc))


def _disable_auth_cache(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def build_router(
    *,
    settings: Settings,
    client: Grok2APIClient,
    account_repository: AccountRepository,
    probe_repository: ProbeRepository,
    account_service: AccountService,
    probe_manager: ProbeManager,
    scheduler: SchedulerService,
    runtime_settings_service: RuntimeSettingsService,
    auth_service: AuthService,
    chat_service: ChatService,
    register_integration: RegisterIntegrationService,
) -> APIRouter:
    router = APIRouter(prefix="/api")
    require_admin = build_admin_auth_dependency(auth_service)
    protected_router = APIRouter(dependencies=[Depends(require_admin)])

    @router.get("/auth/status")
    def auth_status(request: Request, response: Response) -> dict[str, Any]:
        _disable_auth_cache(response)
        return auth_service.status(request.headers.get("authorization", ""))

    @router.post("/auth/setup")
    def auth_setup(payload: AuthSetupInput, response: Response) -> dict[str, Any]:
        _disable_auth_cache(response)
        try:
            return auth_service.setup(
                payload.username,
                payload.password,
                payload.confirm_password,
            )
        except AdminAlreadyExistsError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/auth/login")
    def auth_login(payload: AuthLoginInput, response: Response) -> dict[str, Any]:
        _disable_auth_cache(response)
        if auth_service.setup_required():
            raise HTTPException(status_code=409, detail="请先创建管理员账号")
        try:
            return auth_service.login(payload.username, payload.password)
        except AuthenticationError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc

    @protected_router.get("/auth/me")
    def auth_me(request: Request, response: Response) -> dict[str, Any]:
        _disable_auth_cache(response)
        user = getattr(request.state, "auth_user", None)
        if user is None:
            raise HTTPException(status_code=401, detail="请先登录")
        return {"user": auth_service.public_user(user)}

    @protected_router.post("/auth/logout")
    def auth_logout(request: Request, response: Response) -> dict[str, bool]:
        _disable_auth_cache(response)
        user = getattr(request.state, "auth_user", None)
        if user is None:
            raise HTTPException(status_code=401, detail="请先登录")
        try:
            auth_service.logout(user)
        except AuthenticationError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        return {"loggedOut": True}

    @router.get("/health")
    async def health(request: Request) -> dict[str, Any]:
        auth_state = auth_service.status(request.headers.get("authorization", ""))
        basic: dict[str, Any] = {
            "status": "ok",
            "time": app_now(),
            "setupRequired": auth_state["setupRequired"],
        }
        if not auth_state["authenticated"]:
            return basic
        upstream: dict[str, Any]
        try:
            summary = await client.admin_request("GET", "/api/admin/v1/accounts/summary")
            upstream = {"available": True, "summary": summary.get("providers", {}).get("grok_build", {})}
        except Exception as exc:
            upstream = {"available": False, "error": str(exc)}
        return {
            **basic,
            "upstream": upstream,
            "queue": probe_repository.queue_stats(),
            "scheduler": {
                "enabled": settings.scheduler_enabled,
                "running": scheduler.scheduler.running,
            },
            "integration": {
                "adminConfigured": bool(
                    settings.grok2api_admin_username
                    and settings.grok2api_admin_password
                ),
            },
        }

    @protected_router.get("/dashboard")
    async def dashboard(hours: int = Query(default=168, ge=1, le=8760)) -> dict[str, Any]:
        try:
            return await account_service.dashboard(hours)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/accounts")
    async def accounts(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
        search: str = "",
        enabled: str = "",
        upstream_status: str = Query(default="", alias="status"),
        monitor_status: str = Query(default="", alias="monitorStatus"),
        recovery_guarded: str = Query(default="", alias="recoveryGuarded"),
    ) -> dict[str, Any]:
        try:
            return await account_service.list_accounts(
                page=page,
                page_size=page_size,
                search=search,
                enabled=enabled,
                upstream_status=upstream_status,
                monitor_status=monitor_status,
                recovery_guarded=recovery_guarded,
            )
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/accounts/selection")
    async def account_selection(
        search: str = "",
        enabled: str = "",
        upstream_status: str = Query(default="", alias="status"),
        monitor_status: str = Query(default="", alias="monitorStatus"),
        recovery_guarded: str = Query(default="", alias="recoveryGuarded"),
    ) -> dict[str, Any]:
        try:
            return await account_service.select_account_ids(
                search=search,
                enabled=enabled,
                upstream_status=upstream_status,
                monitor_status=monitor_status,
                recovery_guarded=recovery_guarded,
            )
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/accounts/options")
    async def account_options(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=50, ge=1, le=200, alias="pageSize"),
        search: str = "",
        upstream_status: str = Query(default="", alias="status"),
    ) -> dict[str, Any]:
        try:
            return await account_service.list_account_options(
                page=page,
                page_size=page_size,
                search=search,
                upstream_status=upstream_status,
            )
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.put("/accounts/batch")
    async def batch_update_accounts(
        payload: AccountBatchUpdateInput,
    ) -> dict[str, Any]:
        try:
            return await account_service.set_accounts_enabled(
                account_ids=payload.account_ids,
                enabled=payload.enabled,
            )
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/accounts/{account_id}")
    async def account_detail(
        account_id: int,
        limit: int = Query(default=200, ge=10, le=1000),
    ) -> dict[str, Any]:
        try:
            return await account_service.detail(account_id, limit)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.post("/accounts/{account_id}/action")
    async def account_action(account_id: int, payload: AccountActionInput) -> dict[str, Any]:
        try:
            return await account_service.action(
                account_id=account_id,
                action=payload.action,
                note=payload.note,
                propagate=payload.propagate,
                quarantine_minutes=payload.quarantine_minutes,
            )
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.delete("/accounts/{account_id}")
    async def delete_account(account_id: int) -> dict[str, Any]:
        try:
            return await account_service.delete_upstream_account(account_id)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/egress-nodes")
    async def egress_nodes(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=100, ge=1, le=500, alias="pageSize"),
        search: str = "",
        enabled: str = "",
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "pageSize": page_size}
        if search:
            params["search"] = search
        if enabled:
            params["enabled"] = enabled
        try:
            return await client.list_egress_nodes(**params)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/probe-profiles")
    def list_profiles() -> list[dict[str, Any]]:
        return probe_repository.list_profiles()

    @protected_router.post("/probe-profiles", status_code=201)
    def create_profile(payload: ProfileInput) -> dict[str, Any]:
        return {"id": probe_repository.create_profile(payload.model_dump())}

    @protected_router.put("/probe-profiles/{profile_id}")
    def update_profile(profile_id: str, payload: ProfileInput) -> dict[str, Any]:
        try:
            return probe_repository.update_profile(profile_id, payload.model_dump())
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.delete("/probe-profiles/{profile_id}", status_code=204)
    def delete_profile(profile_id: str) -> Response:
        try:
            probe_repository.delete_profile(profile_id)
        except Exception as exc:
            raise _http_error(exc) from exc
        return Response(status_code=204)

    @protected_router.delete("/probe-profiles")
    def delete_profiles(payload: BulkIdsInput) -> dict[str, Any]:
        try:
            return probe_repository.delete_profiles(payload.ids)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/probe-plans")
    def list_plans() -> list[dict[str, Any]]:
        return scheduler.status()["plans"]

    @protected_router.post("/probe-plans", status_code=201)
    async def create_plan(payload: ProbePlanInput) -> dict[str, Any]:
        try:
            scheduler.validate_cron(payload.cron_expression, payload.timezone)
            targets = await probe_manager.validate_targets(
                [target.model_dump() for target in payload.proxy_targets],
                execution_mode=payload.execution_mode,
            )
            values = payload.model_dump(exclude={"proxy_targets"}) | {"proxy_targets": targets}
            plan_id = probe_repository.create_plan(values)
            scheduler.reload()
            return {"id": plan_id}
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.put("/probe-plans/{plan_id}")
    async def update_plan(plan_id: str, payload: ProbePlanInput) -> dict[str, Any]:
        try:
            scheduler.validate_cron(payload.cron_expression, payload.timezone)
            targets = await probe_manager.validate_targets(
                [target.model_dump() for target in payload.proxy_targets],
                execution_mode=payload.execution_mode,
            )
            values = payload.model_dump(exclude={"proxy_targets"}) | {"proxy_targets": targets}
            result = probe_repository.update_plan(plan_id, values)
            scheduler.reload()
            return result
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.put("/probe-plans/{plan_id}/enabled")
    def set_plan_enabled(plan_id: str, payload: ProbePlanEnabledInput) -> dict[str, Any]:
        try:
            result = probe_repository.update_plan(plan_id, {"enabled": payload.enabled})
            scheduler.reload()
            return result
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.delete("/probe-plans/{plan_id}", status_code=204)
    def delete_plan(plan_id: str) -> Response:
        try:
            probe_repository.delete_plan(plan_id)
            scheduler.reload()
        except Exception as exc:
            raise _http_error(exc) from exc
        return Response(status_code=204)

    @protected_router.delete("/probe-plans")
    def delete_plans(payload: BulkIdsInput) -> dict[str, Any]:
        try:
            result = probe_repository.delete_plans(payload.ids)
            scheduler.reload()
            return result
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.post("/probe-plans/batch/run")
    async def run_plans(payload: BulkIdsInput) -> dict[str, Any]:
        try:
            return await scheduler.run_plans_now(payload.ids)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.post("/probe-plans/{plan_id}/run")
    async def run_plan(plan_id: str) -> dict[str, Any]:
        try:
            return await scheduler.run_plan_now(plan_id)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.post("/probe-runs", status_code=201)
    async def create_probe_run(payload: ProbeRunCreate) -> dict[str, Any]:
        try:
            if len(payload.profile_ids) > 1:
                result = await probe_manager.enqueue_manual_batch(
                    account_ids=[payload.account_id],
                    profile_id=payload.profile_id,
                    profile_ids=payload.profile_ids,
                    execution_mode=payload.execution_mode,
                    rounds=payload.rounds,
                    proxy_targets=[target.model_dump() for target in payload.proxy_targets],
                )
                run_ids = list(result.get("runIds") or [])
                return {
                    "id": run_ids[0] if run_ids else "",
                    "ids": run_ids,
                    "created": result.get("created", 0),
                    "status": "queued" if run_ids else "skipped",
                }
            run_id = await probe_manager.enqueue_manual(
                account_id=payload.account_id,
                profile_id=payload.profile_id,
                execution_mode=payload.execution_mode,
                rounds=payload.rounds,
                proxy_targets=[target.model_dump() for target in payload.proxy_targets],
            )
            return {"id": run_id, "status": "queued"}
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.post("/probe-runs/batch", status_code=201)
    async def create_probe_runs_batch(payload: ProbeRunBatchCreate) -> dict[str, Any]:
        try:
            return await probe_manager.enqueue_manual_batch(
                account_ids=payload.account_ids,
                profile_id=payload.profile_id,
                profile_ids=payload.profile_ids,
                execution_mode=payload.execution_mode,
                rounds=payload.rounds,
                proxy_targets=[target.model_dump() for target in payload.proxy_targets],
            )
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/probe-runs")
    def list_probe_runs(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=30, ge=1, le=100, alias="pageSize"),
        status: str = "",
        search: str = "",
        account_id: int | None = Query(default=None, alias="accountId"),
        plan_id: str | None = Query(default=None, alias="planId"),
    ) -> dict[str, Any]:
        return probe_repository.list_runs(
            page=page,
            page_size=page_size,
            status=status,
            search=search,
            account_id=account_id,
            plan_id=plan_id,
        )

    @protected_router.get("/probe-workers")
    def probe_worker_status() -> dict[str, Any]:
        return probe_manager.status()

    @protected_router.get("/probe-workers/logs")
    def probe_worker_logs(
        limit: int = Query(default=300, ge=1, le=1500),
    ) -> dict[str, Any]:
        return probe_manager.logs(limit)

    @protected_router.post("/probe-runs/batch/cancel")
    async def cancel_probe_runs(payload: BulkIdsInput) -> dict[str, int]:
        try:
            return await probe_manager.cancel_many(payload.ids)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/probe-runs/{run_id}")
    def probe_run_detail(run_id: str) -> dict[str, Any]:
        value = probe_repository.run_detail(run_id)
        if value is None:
            raise HTTPException(status_code=404, detail="探针任务不存在")
        return value

    @protected_router.post("/probe-runs/{run_id}/cancel")
    async def cancel_probe_run(run_id: str) -> dict[str, Any]:
        try:
            return {"id": run_id, "status": await probe_manager.cancel(run_id)}
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.post("/probe-runs/{run_id}/retry", status_code=201)
    async def retry_probe_run(run_id: str) -> dict[str, Any]:
        try:
            new_id = await probe_manager.retry(run_id)
            return {"id": new_id, "status": "queued"}
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.post("/probe-runs/{run_id}/restore-account-settings")
    async def restore_probe_run_account_settings(run_id: str) -> dict[str, Any]:
        try:
            return await probe_manager.restore_run_account_settings(run_id)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.delete("/probe-runs/{run_id}", status_code=204)
    def delete_probe_run(run_id: str) -> Response:
        try:
            account_id = probe_repository.delete_run(run_id)
            account_repository.recalculate(
                account_id,
                probe_manager.thresholds,
                settings.analysis_window_hours,
            )
        except Exception as exc:
            raise _http_error(exc) from exc
        return Response(status_code=204)

    @protected_router.delete("/probe-samples/{sample_id}", status_code=204)
    def delete_probe_sample(sample_id: str) -> Response:
        try:
            account_id = probe_repository.delete_sample(sample_id)
            account_repository.recalculate(
                account_id,
                probe_manager.thresholds,
                settings.analysis_window_hours,
            )
        except Exception as exc:
            raise _http_error(exc) from exc
        return Response(status_code=204)

    @protected_router.delete("/probe-runs")
    def delete_probe_runs(payload: BulkIdsInput) -> dict[str, int]:
        try:
            deleted, account_ids = probe_repository.delete_runs(payload.ids)
            for account_id in account_ids:
                account_repository.recalculate(
                    account_id,
                    probe_manager.thresholds,
                    settings.analysis_window_hours,
                )
            return {"deleted": deleted}
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/scheduler")
    def scheduler_status() -> dict[str, Any]:
        return scheduler.status()

    @protected_router.delete("/scheduler/executions/{execution_id}", status_code=204)
    def delete_scheduler_execution(execution_id: str) -> Response:
        try:
            probe_repository.delete_schedule_execution(execution_id)
        except Exception as exc:
            raise _http_error(exc) from exc
        return Response(status_code=204)

    @protected_router.delete("/scheduler/executions")
    def delete_scheduler_executions(payload: BulkIdsInput) -> dict[str, Any]:
        try:
            return probe_repository.delete_schedule_executions(payload.ids)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/settings")
    def runtime_settings() -> dict[str, Any]:
        return runtime_settings_service.public_view()

    @protected_router.put("/settings")
    async def update_runtime_settings(payload: RuntimeSettingsInput) -> dict[str, Any]:
        try:
            changed = runtime_settings_service.update(payload.runtime_changes())
            if any(key.startswith("grok2api_") for key in changed):
                client.reset_credentials()
            await probe_manager.reconfigure()
            await scheduler.reconfigure()
            return {**runtime_settings_service.public_view(), "changed": changed}
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.post("/settings/test-grok2api")
    async def test_grok2api_settings() -> dict[str, Any]:
        try:
            client.reset_credentials()
            summary = await client.admin_request("GET", "/api/admin/v1/accounts/summary")
            return {
                "ok": True,
                "baseUrl": settings.grok2api_base_url,
                "grokBuild": summary.get("providers", {}).get("grok_build", {}),
            }
        except Exception as exc:
            raise _http_error(exc) from exc

    def require_register_token(request: Request) -> None:
        expected_token = settings.grok_register_webhook_token.strip()
        if not expected_token:
            raise HTTPException(status_code=503, detail="grok-register 联动令牌尚未配置")
        supplied_token = request.headers.get("x-monitor-token", "").strip()
        if not hmac.compare_digest(supplied_token, expected_token):
            raise HTTPException(status_code=401, detail="联动令牌无效")

    @router.post("/integrations/grok-register/account-created", status_code=202)
    @router.post("/integrations/grok-register/account-imported", status_code=202)
    async def grok_register_account_created(
        payload: RegisterAccountEvent,
        request: Request,
    ) -> dict[str, Any]:
        require_register_token(request)
        try:
            return register_integration.accept(payload.model_dump())
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/chat/providers")
    def chat_providers() -> list[dict[str, Any]]:
        return chat_service.list_providers()

    @protected_router.post("/chat/providers", status_code=201)
    def create_chat_provider(payload: ChatProviderCreateInput) -> dict[str, Any]:
        try:
            return chat_service.create_provider(payload.model_dump())
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.put("/chat/providers/{provider_id}")
    def update_chat_provider(
        provider_id: str,
        payload: ChatProviderUpdateInput,
    ) -> dict[str, Any]:
        try:
            return chat_service.update_provider(provider_id, payload.changes())
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.delete("/chat/providers/{provider_id}", status_code=204)
    def delete_chat_provider(provider_id: str) -> Response:
        try:
            chat_service.delete_provider(provider_id)
        except Exception as exc:
            raise _http_error(exc) from exc
        return Response(status_code=204)

    @protected_router.post("/chat/providers/{provider_id}/sync-models")
    async def sync_chat_provider_models(provider_id: str) -> dict[str, Any]:
        try:
            return await chat_service.sync_models(provider_id)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.get("/chat/models")
    async def chat_models(
        provider_id: str = Query(default="", alias="providerId"),
    ) -> list[dict[str, Any]]:
        try:
            return await chat_service.list_models(provider_id)
        except Exception as exc:
            raise _http_error(exc) from exc

    @protected_router.post("/chat/completions")
    async def chat_completions(request: Request) -> StreamingResponse:
        body = await request.body()
        try:
            stream = await chat_service.open_completion(
                provider_id=request.headers.get("x-chat-provider-id", ""),
                body=body,
                request_headers=request.headers,
            )
        except Exception as exc:
            raise _http_error(exc) from exc

        async def iterator() -> AsyncIterator[bytes]:
            try:
                async for chunk in stream.response.aiter_content():
                    yield chunk
            finally:
                await stream.session.close()

        return StreamingResponse(
            iterator(),
            media_type=stream.response.headers.get(
                "content-type", "text/event-stream"
            ),
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    router.include_router(protected_router)
    return router
