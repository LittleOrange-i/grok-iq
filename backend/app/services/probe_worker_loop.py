from __future__ import annotations

import asyncio
import logging
import os
from typing import TYPE_CHECKING, Any

from app.core.clock import utc_now
from app.services.probe_runtime import WorkerRuntime

if TYPE_CHECKING:
    from app.services.probe_manager import ProbeManager


class ProbeWorkerLoop:
    """Claims and executes runs for one worker slot."""

    def __init__(self, manager: ProbeManager, logger: logging.Logger):
        self.manager = manager
        self.logger = logger

    async def run(self, index: int) -> None:
        manager = self.manager
        worker_id = f"worker-{index}"
        runtime = manager._worker_runtime[index]
        manager._set_worker_status(runtime, "idle")
        self.logger.info("worker started worker=%s pid=%s", worker_id, os.getpid())
        try:
            while self._should_run(index):
                context = await self._claim(worker_id, runtime)
                if context is None:
                    await self._wait(runtime)
                    continue
                self._record_claim(context, runtime)
                finished = await self._execute(context, runtime, worker_id)
                self._record_completion(finished, runtime)
                manager._clear_worker_run(runtime)
                manager._set_worker_status(
                    runtime,
                    "stopping" if index > manager._desired_worker_concurrency else "idle",
                )
        finally:
            manager._clear_worker_run(runtime)
            manager._set_worker_status(runtime, "stopped")
            self.logger.info("worker stopped worker=%s pid=%s", worker_id, os.getpid())

    def _should_run(self, index: int) -> bool:
        manager = self.manager
        return not manager._stopping and index <= manager._desired_worker_concurrency

    async def _claim(self, worker_id: str, runtime: WorkerRuntime) -> Any:
        manager = self.manager
        try:
            async with manager._claim_lock:
                return manager.repository.claim_next(worker_id)
        except Exception as exc:
            runtime.last_error = str(exc)
            manager._set_worker_status(runtime, "error")
            self.logger.exception("worker claim failed worker=%s", worker_id)
            await asyncio.sleep(1)
            return None

    async def _wait(self, runtime: WorkerRuntime) -> None:
        manager = self.manager
        manager._set_worker_status(runtime, "idle")
        manager._wake.clear()
        try:
            await asyncio.wait_for(manager._wake.wait(), timeout=1.0)
        except TimeoutError:
            pass

    def _record_claim(self, context: Any, runtime: WorkerRuntime) -> None:
        manager = self.manager
        run = context.run
        profile = context.profile
        runtime.current_run_id = str(run["id"])
        runtime.current_account_id = int(run["account_id"])
        runtime.current_account_name = str(run.get("account_name") or run.get("account_email") or "")
        runtime.current_profile_id = str(run["profile_id"])
        runtime.current_profile_name = str(profile.get("name") or "")
        runtime.current_execution_mode = str(run.get("execution_mode") or "chat")
        runtime.current_run_started_at = utc_now()
        runtime.last_error = ""
        manager._set_worker_status(runtime, "running")
        self.logger.info(
            "run claimed worker=%s run=%s account=%s profile=%s mode=%s",
            runtime.worker_id,
            runtime.current_run_id,
            runtime.current_account_id,
            runtime.current_profile_id,
            runtime.current_execution_mode,
        )

    async def _execute(
        self, context: Any, runtime: WorkerRuntime, worker_id: str
    ) -> dict[str, Any] | None:
        manager = self.manager
        try:
            return await manager._execute(context, runtime)
        except Exception as exc:
            runtime.last_error = str(exc)
            self.logger.exception(
                "unhandled worker execution error worker=%s run=%s",
                worker_id,
                runtime.current_run_id,
            )
            current = manager.repository.get_run(runtime.current_run_id)
            if not current or str(current.get("status")) not in {
                "running",
                "cancel_requested",
                "recovering",
            }:
                return None
            try:
                return manager.repository.finish_run(
                    runtime.current_run_id,
                    status="failed",
                    error=f"Worker 未处理异常: {exc}",
                )
            except Exception:
                self.logger.exception(
                    "failed to finalize crashed run worker=%s run=%s",
                    worker_id,
                    runtime.current_run_id,
                )
                return None

    def _record_completion(
        self, finished: dict[str, Any] | None, runtime: WorkerRuntime
    ) -> None:
        if finished is None:
            return
        manager = self.manager
        runtime.completed_runs += 1
        failed = str(finished.get("status")) in {"failed", "completed_with_errors"}
        if failed:
            runtime.failed_runs += 1
        duration = (
            max(0.0, (utc_now() - runtime.current_run_started_at).total_seconds())
            if runtime.current_run_started_at
            else 0.0
        )
        with manager._recent_completions_lock:
            manager._recent_completions.append((utc_now(), failed, duration))
