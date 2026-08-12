from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response

from app.core.config import Settings
from app.persistence.account_repository import AccountRepository
from app.persistence.probe_repository import ProbeRepository
from app.services.probe_manager import ProbeManager
from app.services.scheduler import SchedulerService
from app.web.schemas import (
    BulkIdsInput,
    ProbePlanEnabledInput,
    ProbePlanInput,
    ProbeRunBatchCreate,
    ProbeRunCreate,
    ProfileInput,
)


def build_probes_router(
    *,
    settings: Settings,
    accounts: AccountRepository,
    repository: ProbeRepository,
    manager: ProbeManager,
    scheduler: SchedulerService,
) -> APIRouter:
    router = APIRouter()

    @router.get("/probe-profiles")
    def list_profiles() -> list[dict[str, Any]]:
        return repository.list_profiles()

    @router.post("/probe-profiles", status_code=201)
    def create_profile(payload: ProfileInput) -> dict[str, Any]:
        return {"id": repository.create_profile(payload.model_dump())}

    @router.put("/probe-profiles/{profile_id}")
    def update_profile(
        profile_id: str,
        payload: ProfileInput,
    ) -> dict[str, Any]:
        return repository.update_profile(profile_id, payload.model_dump())

    @router.delete("/probe-profiles/{profile_id}", status_code=204)
    def delete_profile(profile_id: str) -> Response:
        repository.delete_profile(profile_id)
        return Response(status_code=204)

    @router.delete("/probe-profiles")
    def delete_profiles(payload: BulkIdsInput) -> dict[str, Any]:
        return repository.delete_profiles(payload.ids)

    @router.get("/probe-plans")
    def list_plans() -> list[dict[str, Any]]:
        return scheduler.status()["plans"]

    async def plan_values(payload: ProbePlanInput) -> dict[str, Any]:
        scheduler.validate_cron(payload.cron_expression, payload.timezone)
        targets = await manager.validate_targets(
            [target.model_dump() for target in payload.proxy_targets],
            execution_mode=payload.execution_mode,
        )
        return payload.model_dump(exclude={"proxy_targets"}) | {
            "proxy_targets": targets
        }

    @router.post("/probe-plans", status_code=201)
    async def create_plan(payload: ProbePlanInput) -> dict[str, Any]:
        plan_id = repository.create_plan(await plan_values(payload))
        scheduler.reload()
        return {"id": plan_id}

    @router.put("/probe-plans/{plan_id}")
    async def update_plan(
        plan_id: str,
        payload: ProbePlanInput,
    ) -> dict[str, Any]:
        result = repository.update_plan(plan_id, await plan_values(payload))
        scheduler.reload()
        return result

    @router.put("/probe-plans/{plan_id}/enabled")
    def set_plan_enabled(
        plan_id: str,
        payload: ProbePlanEnabledInput,
    ) -> dict[str, Any]:
        result = repository.update_plan(plan_id, {"enabled": payload.enabled})
        scheduler.reload()
        return result

    @router.delete("/probe-plans/{plan_id}", status_code=204)
    def delete_plan(plan_id: str) -> Response:
        repository.delete_plan(plan_id)
        scheduler.reload()
        return Response(status_code=204)

    @router.delete("/probe-plans")
    def delete_plans(payload: BulkIdsInput) -> dict[str, Any]:
        result = repository.delete_plans(payload.ids)
        scheduler.reload()
        return result

    @router.post("/probe-plans/batch/run")
    async def run_plans(payload: BulkIdsInput) -> dict[str, Any]:
        return await scheduler.run_plans_now(payload.ids)

    @router.post("/probe-plans/{plan_id}/run")
    async def run_plan(plan_id: str) -> dict[str, Any]:
        return await scheduler.run_plan_now(plan_id)

    @router.post("/probe-runs", status_code=201)
    async def create_probe_run(payload: ProbeRunCreate) -> dict[str, Any]:
        targets = [target.model_dump() for target in payload.proxy_targets]
        if len(payload.profile_ids) > 1:
            result = await manager.enqueue_manual_batch(
                account_ids=[payload.account_id],
                profile_id=payload.profile_id,
                profile_ids=payload.profile_ids,
                execution_mode=payload.execution_mode,
                rounds=payload.rounds,
                proxy_targets=targets,
            )
            run_ids = list(result.get("runIds") or [])
            return {
                "id": run_ids[0] if run_ids else "",
                "ids": run_ids,
                "created": result.get("created", 0),
                "status": "queued" if run_ids else "skipped",
            }
        run_id = await manager.enqueue_manual(
            account_id=payload.account_id,
            profile_id=payload.profile_id,
            execution_mode=payload.execution_mode,
            rounds=payload.rounds,
            proxy_targets=targets,
        )
        return {"id": run_id, "status": "queued"}

    @router.post("/probe-runs/batch", status_code=201)
    async def create_probe_runs_batch(
        payload: ProbeRunBatchCreate,
    ) -> dict[str, Any]:
        return await manager.enqueue_manual_batch(
            account_ids=payload.account_ids,
            profile_id=payload.profile_id,
            profile_ids=payload.profile_ids,
            execution_mode=payload.execution_mode,
            rounds=payload.rounds,
            proxy_targets=[
                target.model_dump() for target in payload.proxy_targets
            ],
        )

    @router.get("/probe-runs")
    def list_probe_runs(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=30, ge=1, le=100, alias="pageSize"),
        status: str = "",
        search: str = "",
        account_id: int | None = Query(default=None, alias="accountId"),
        plan_id: str | None = Query(default=None, alias="planId"),
    ) -> dict[str, Any]:
        return repository.list_runs(
            page=page,
            page_size=page_size,
            status=status,
            search=search,
            account_id=account_id,
            plan_id=plan_id,
        )

    @router.get("/probe-workers")
    def probe_worker_status() -> dict[str, Any]:
        return manager.status()

    @router.get("/probe-workers/logs")
    def probe_worker_logs(
        limit: int = Query(default=300, ge=1, le=1500),
    ) -> dict[str, Any]:
        return manager.logs(limit)

    @router.post("/probe-runs/batch/cancel")
    async def cancel_probe_runs(payload: BulkIdsInput) -> dict[str, int]:
        return await manager.cancel_many(payload.ids)

    @router.post("/probe-runs/batch/restore-account-settings")
    async def restore_probe_runs_account_settings(
        payload: BulkIdsInput,
    ) -> dict[str, Any]:
        return await manager.restore_many(payload.ids)

    @router.get("/probe-runs/selection")
    def select_probe_runs(
        status: str = "",
        search: str = "",
        account_id: int | None = Query(default=None, alias="accountId"),
        plan_id: str | None = Query(default=None, alias="planId"),
    ) -> dict[str, Any]:
        return repository.select_run_ids(
            status=status,
            search=search,
            account_id=account_id,
            plan_id=plan_id,
        )

    @router.get("/probe-runs/{run_id}")
    def probe_run_detail(run_id: str) -> dict[str, Any]:
        value = repository.run_detail(run_id)
        if value is None:
            raise HTTPException(status_code=404, detail="探针任务不存在")
        return value

    @router.post("/probe-runs/{run_id}/cancel")
    async def cancel_probe_run(run_id: str) -> dict[str, Any]:
        return {"id": run_id, "status": await manager.cancel(run_id)}

    @router.post("/probe-runs/{run_id}/retry", status_code=201)
    async def retry_probe_run(run_id: str) -> dict[str, Any]:
        return {"id": await manager.retry(run_id), "status": "queued"}

    @router.post("/probe-runs/{run_id}/restore-account-settings")
    async def restore_probe_run_account_settings(
        run_id: str,
    ) -> dict[str, Any]:
        return await manager.restore_run_account_settings(run_id)

    def recalculate(account_id: int) -> None:
        accounts.recalculate(
            account_id,
            manager.thresholds,
            settings.analysis_window_hours,
        )

    @router.delete("/probe-runs/{run_id}", status_code=204)
    def delete_probe_run(run_id: str) -> Response:
        recalculate(repository.delete_run(run_id))
        return Response(status_code=204)

    @router.delete("/probe-samples/{sample_id}", status_code=204)
    def delete_probe_sample(sample_id: str) -> Response:
        recalculate(repository.delete_sample(sample_id))
        return Response(status_code=204)

    @router.delete("/probe-runs")
    def delete_probe_runs(payload: BulkIdsInput) -> dict[str, Any]:
        deleted, account_ids, skipped = repository.delete_runs(payload.ids)
        for account_id in account_ids:
            recalculate(account_id)
        return {
            "requested": len(payload.ids),
            "deleted": deleted,
            "skippedRunIds": skipped,
        }

    @router.get("/scheduler")
    def scheduler_status() -> dict[str, Any]:
        return scheduler.status()

    @router.delete(
        "/scheduler/executions/{execution_id}",
        status_code=204,
    )
    def delete_scheduler_execution(execution_id: str) -> Response:
        repository.delete_schedule_execution(execution_id)
        return Response(status_code=204)

    @router.delete("/scheduler/executions")
    def delete_scheduler_executions(payload: BulkIdsInput) -> dict[str, Any]:
        return repository.delete_schedule_executions(payload.ids)

    return router
