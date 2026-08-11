from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.clock import to_app_timezone
from app.core.config import Settings
from app.persistence.probe_repository import ProbeRepository

from .probe_manager import ProbeManager

logger = logging.getLogger(__name__)


class SchedulerService:
    def __init__(
        self,
        *,
        settings: Settings,
        repository: ProbeRepository,
        probes: ProbeManager,
        recovery_callback: Callable[[], Awaitable[dict[str, Any]]],
    ):
        self.settings = settings
        self.repository = repository
        self.probes = probes
        self.recovery_callback = recovery_callback
        self.scheduler = AsyncIOScheduler(timezone=settings.scheduler_timezone)

    async def start(self) -> None:
        self.scheduler = AsyncIOScheduler(timezone=self.settings.scheduler_timezone)
        if not self.settings.scheduler_enabled:
            return
        self.scheduler.start()
        self.reload()

    async def stop(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

    async def reconfigure(self) -> None:
        """Rebuild APScheduler so timezone and enablement changes apply now."""

        await self.stop()
        await self.start()

    @staticmethod
    def validate_cron(expression: str, timezone: str) -> None:
        try:
            zone = ZoneInfo(timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("时区名称无效") from exc
        try:
            CronTrigger.from_crontab(expression, timezone=zone)
        except ValueError as exc:
            raise ValueError(f"Cron 表达式无效: {exc}") from exc

    def reload(self) -> None:
        if not self.scheduler.running:
            return
        for job in list(self.scheduler.get_jobs()):
            self.scheduler.remove_job(job.id)
        for plan in self.repository.list_plans():
            if plan["enabled"]:
                self._add_plan_job(plan)
        self.scheduler.add_job(
            self._run_recovery,
            CronTrigger.from_crontab(
                self.settings.recovery_cron,
                timezone=ZoneInfo(self.settings.scheduler_timezone),
            ),
            id="system:quarantine-recovery",
            name="隔离恢复检查",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
            misfire_grace_time=self.settings.scheduler_misfire_grace_seconds,
        )

    def _add_plan_job(self, plan: dict[str, Any]) -> None:
        trigger = CronTrigger.from_crontab(
            str(plan["cron_expression"]),
            timezone=ZoneInfo(str(plan["timezone"])),
        )
        self.scheduler.add_job(
            self._run_plan,
            trigger,
            args=[str(plan["id"])],
            id=f"plan:{plan['id']}",
            name=str(plan["name"]),
            replace_existing=True,
            coalesce=True,
            max_instances=1,
            misfire_grace_time=self.settings.scheduler_misfire_grace_seconds,
        )

    async def run_plan_now(self, plan_id: str) -> dict[str, Any]:
        return await self._execute_plan(plan_id)

    async def run_plans_now(self, plan_ids: list[str]) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(value for value in plan_ids if value))
        summary: dict[str, Any] = {
            "requested": len(unique_ids),
            "processed": 0,
            "created": 0,
            "skipped": 0,
            "failed": 0,
            "restoreBlocked": 0,
            "failures": [],
        }
        for plan_id in unique_ids:
            try:
                result = await self.run_plan_now(plan_id)
            except Exception as exc:
                summary["failed"] += 1
                summary["failures"].append({"id": plan_id, "message": str(exc)})
                continue
            summary["processed"] += 1
            summary["created"] += int(result.get("created", 0))
            summary["skipped"] += int(result.get("skipped", 0))
            summary["restoreBlocked"] += len(
                result.get("restoreBlockedAccountIds", [])
            )
        return summary

    async def _run_plan(self, plan_id: str) -> None:
        await self._execute_plan(plan_id)

    async def _execute_plan(self, plan_id: str) -> dict[str, Any]:
        key = f"plan:{plan_id}"
        execution_id = self.repository.start_schedule_execution(key)
        try:
            plan = self.repository.get_plan(plan_id)
            if plan is None or not plan["enabled"]:
                result = {"created": 0, "skipped": 0, "reason": "plan_disabled_or_deleted"}
                self.repository.finish_schedule_execution(
                    execution_id, status="skipped", message="计划已停用或删除", detail=result
                )
                return result
            result = await self.probes.enqueue_plan(plan)
            status = "skipped" if result.get("created", 0) == 0 else "succeeded"
            restore_blocked = len(result.get("restoreBlockedAccountIds", []))
            if status == "skipped":
                message = f"{restore_blocked} 个账号等待原设置同步" if restore_blocked else "未创建新任务"
            else:
                message = f"创建 {result['created']} 个任务"
                if restore_blocked:
                    message += f"，{restore_blocked} 个账号等待原设置同步"
            self.repository.finish_schedule_execution(
                execution_id,
                status=status,
                message=message,
                detail=result,
            )
            return result
        except Exception as exc:
            self.repository.finish_schedule_execution(
                execution_id, status="failed", message=str(exc), detail={}
            )
            logger.exception("scheduled probe plan %s failed", plan_id)
            raise

    async def _run_recovery(self) -> None:
        execution_id = self.repository.start_schedule_execution("system:quarantine-recovery")
        try:
            result = await self.recovery_callback()
            guarded = int(result.get("guarded", 0))
            message = f"恢复 {result['restored']} 个账号"
            if guarded:
                message += f"，{guarded} 个已设为最低优先级"
            self.repository.finish_schedule_execution(
                execution_id,
                status="succeeded",
                message=message,
                detail=result,
            )
        except Exception as exc:
            self.repository.finish_schedule_execution(
                execution_id, status="failed", message=str(exc), detail={}
            )
            logger.exception("quarantine recovery failed")

    def status(self) -> dict[str, Any]:
        jobs = {
            job.id: {
                "id": job.id,
                "name": job.name,
                "nextRunAt": to_app_timezone(job.next_run_time),
            }
            for job in self.scheduler.get_jobs()
        }
        plans = []
        for plan in self.repository.list_plans():
            plans.append({**plan, "job": jobs.get(f"plan:{plan['id']}")})
        return {
            "enabled": self.settings.scheduler_enabled,
            "running": self.scheduler.running,
            "plans": plans,
            "systemJobs": [value for key, value in jobs.items() if key.startswith("system:")],
            "executions": self.repository.list_schedule_executions(limit=100),
        }
