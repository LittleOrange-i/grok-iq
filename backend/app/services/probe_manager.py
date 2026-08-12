from __future__ import annotations

import asyncio
import logging
import os
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.analyzer import SampleMetrics, Thresholds, classify_sample
from app.core.clock import app_isoformat, utc_now
from app.core.config import Settings
from app.core.logging import (
    PROBE_LOG_FILE_NAME,
    PROBE_LOG_RETENTION_DAYS,
    probe_log_size,
    recent_log_lines,
)
from app.integrations.grok2api.client import Grok2APIClient, IntegrationError
from app.persistence.account_repository import AccountRepository
from app.persistence.probe_repository import (
    AccountSettingsSnapshot,
    ProbeRepository,
    RunExecutionContext,
    RunStateError,
)
from app.services.wechat_notification import WeChatAccountNotificationService

logger = logging.getLogger(__name__)
FAST_QUALITY_PROBE_EXPECTED = "探针校验通过"
FAST_QUALITY_PROBE_PROMPT = f"请只输出“{FAST_QUALITY_PROBE_EXPECTED}”，不要添加其他内容。"


class AccountRestoreError(RuntimeError):
    """A diagnostic account could not be returned to its recorded state."""


@dataclass(slots=True)
class UpstreamCleanupResult:
    account_errors: list[str]
    resource_errors: list[str]

    @property
    def errors(self) -> list[str]:
        return [*self.account_errors, *self.resource_errors]


@dataclass(slots=True)
class WorkerRuntime:
    index: int
    worker_id: str
    status: str
    started_at: datetime
    state_changed_at: datetime
    last_heartbeat_at: datetime
    current_run_id: str = ""
    current_account_id: int | None = None
    current_account_name: str = ""
    current_profile_id: str = ""
    current_profile_name: str = ""
    current_execution_mode: str = ""
    current_round: int | None = None
    current_target_key: str = ""
    current_run_started_at: datetime | None = None
    completed_runs: int = 0
    failed_runs: int = 0
    last_error: str = ""


class ProbeManager:
    """Persistent bounded queue for manual and Cron-created probe runs."""

    def __init__(
        self,
        *,
        settings: Settings,
        repository: ProbeRepository,
        accounts: AccountRepository,
        client: Grok2APIClient,
        thresholds: Thresholds,
        notifications: WeChatAccountNotificationService | None = None,
        log_path: Path | None = None,
    ):
        self.settings = settings
        self.repository = repository
        self.accounts = accounts
        self.client = client
        self.thresholds = thresholds
        self.notifications = notifications
        self.log_path = log_path or (settings.database_path.resolve().parent / "logs" / PROBE_LOG_FILE_NAME)
        self._process_started_at = utc_now()
        self._workers: dict[int, asyncio.Task[None]] = {}
        self._worker_runtime: dict[int, WorkerRuntime] = {}
        self._active_calls: dict[str, asyncio.Task[Any]] = {}
        self._wake = asyncio.Event()
        self._stopping = False
        self._started = False
        self._desired_worker_concurrency = settings.probe_worker_concurrency
        self._claim_lock = asyncio.Lock()
        self._enqueue_lock = asyncio.Lock()
        self._current_probe_lock = asyncio.Lock()
        self._next_current_probe_at = 0.0

    async def start(self) -> None:
        if self._started:
            return
        self.repository.seed_defaults()
        await self._recover_interrupted_runs()
        self._stopping = False
        self._started = True
        self._desired_worker_concurrency = self.settings.probe_worker_concurrency
        self._workers = {}
        for index in range(1, self._desired_worker_concurrency + 1):
            self._spawn_worker(index)
        logger.info(
            "worker pool started pid=%s concurrency=%s",
            os.getpid(),
            self._desired_worker_concurrency,
        )
        self._wake.set()

    async def stop(self) -> None:
        self._stopping = True
        for task in list(self._active_calls.values()):
            task.cancel()
        self._wake.set()
        if self._workers:
            await asyncio.gather(*self._workers.values(), return_exceptions=True)
        self._workers.clear()
        self._started = False
        logger.info("worker pool stopped pid=%s", os.getpid())

    async def reconfigure(self) -> None:
        """Hot-apply thresholds and resize the bounded worker pool."""

        self.thresholds = Thresholds(
            degradation_tps=self.settings.degradation_tps,
            strong_degradation_tps=self.settings.strong_degradation_tps,
            minimum_output_tokens=self.settings.minimum_output_tokens,
            buffer_first_token_share=self.settings.buffer_first_token_share,
            min_generation_ms=self.settings.min_generation_ms,
            consecutive_anomalies=self.settings.consecutive_anomalies,
            cross_egress_min=self.settings.cross_egress_min,
        )
        self._desired_worker_concurrency = self.settings.probe_worker_concurrency
        if not self._started:
            return
        for index, runtime in self._worker_runtime.items():
            if index > self._desired_worker_concurrency and runtime.status != "stopped":
                self._set_worker_status(runtime, "stopping")
        for index in range(1, self._desired_worker_concurrency + 1):
            task = self._workers.get(index)
            if task is None or task.done():
                self._spawn_worker(index)
        logger.info(
            "worker pool reconfigured desired_concurrency=%s live_workers=%s",
            self._desired_worker_concurrency,
            sum(not task.done() for task in self._workers.values()),
        )
        self._wake.set()

    async def enqueue_manual(
        self,
        *,
        account_id: int,
        profile_id: str,
        rounds: int,
        proxy_targets: list[dict[str, Any]],
        execution_mode: str = "chat",
    ) -> str:
        self._ensure_account_restore_ready(account_id)
        account = await self.client.get_account(account_id)
        targets = await self.validate_targets(proxy_targets, execution_mode=execution_mode)
        self._validate_account_for_targets(account, targets)
        async with self._enqueue_lock:
            run_id = self.repository.create_run(
                account_id=account_id,
                account_name=str(account.get("name") or f"account-{account_id}"),
                account_email=str(account.get("email") or ""),
                profile_id=profile_id,
                execution_mode=execution_mode,
                rounds=rounds,
                proxy_targets=targets,
                trigger="manual",
                priority=100,
                queue_limit=self.settings.probe_queue_limit,
            )
        self._wake.set()
        return run_id

    async def enqueue_manual_batch(
        self,
        *,
        account_ids: list[int],
        profile_id: str,
        rounds: int,
        proxy_targets: list[dict[str, Any]],
        execution_mode: str = "chat",
        profile_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        selected_profile_ids = list(
            dict.fromkeys(str(value).strip() for value in (profile_ids or [profile_id]) if str(value).strip())
        )
        requested_ids = {int(account_id) for account_id in account_ids if int(account_id) > 0}
        upstream_accounts, targets = await asyncio.gather(
            self.client.list_all_accounts(requested_ids),
            self.validate_targets(proxy_targets, execution_mode=execution_mode),
        )
        by_id = {int(account.get("id") or 0): account for account in upstream_accounts}
        missing = sorted(requested_ids - by_id.keys())
        invalid: list[dict[str, Any]] = []
        valid_accounts: list[dict[str, Any]] = []
        diagnostic: list[int] = []
        for account_id in sorted(requested_ids & by_id.keys()):
            account = by_id[account_id]
            try:
                self._validate_account_for_targets(account, targets)
            except ValueError as exc:
                invalid.append({"id": account_id, "reason": str(exc)})
                continue
            valid_accounts.append(account)
            if not bool(account.get("enabled")):
                diagnostic.append(account_id)

        async with self._enqueue_lock:
            result = self.repository.create_manual_runs_batch(
                accounts=valid_accounts,
                profile_ids=selected_profile_ids,
                rounds=rounds,
                proxy_targets=targets,
                execution_mode=execution_mode,
                priority=100,
                queue_limit=self.settings.probe_queue_limit,
            )
        created = len(result["runIds"])
        if created:
            self._wake.set()
        skipped_ids = set(missing)
        skipped_ids.update(item["id"] for item in invalid)
        skipped_ids.update(result["activeAccountIds"])
        skipped_ids.update(result["restoreBlockedAccountIds"])
        invalid_reasons = {item["id"]: item["reason"] for item in invalid}
        skipped_accounts = []
        for account_id in sorted(skipped_ids):
            account = by_id.get(account_id, {})
            if account_id in missing:
                code = "missing"
                reason = f"账号 {account_id} 已不在 grok2api 账号列表中"
            elif account_id in result["restoreBlockedAccountIds"]:
                code = "restore_blocked"
                reason = f"账号 {account_id} 存在未完成的原设置恢复，请先在历史任务中同步"
            elif account_id in result["activeAccountIds"]:
                code = "active_run"
                reason = f"账号 {account_id} 已有排队或执行中的探针任务，请等待其结束"
            else:
                code = "invalid"
                reason = invalid_reasons.get(account_id, f"账号 {account_id} 不满足创建条件")
            skipped_accounts.append(
                {
                    "id": account_id,
                    "name": str(account.get("name") or ""),
                    "email": str(account.get("email") or ""),
                    "code": code,
                    "reason": reason,
                }
            )
        return {
            "requested": len(requested_ids),
            "requestedTasks": len(requested_ids) * len(selected_profile_ids),
            "profileIds": result["profileIds"],
            "created": created,
            "skipped": len(skipped_ids),
            "missingAccountIds": missing,
            "invalidAccounts": invalid,
            "activeAccountIds": result["activeAccountIds"],
            "restoreBlockedAccountIds": result["restoreBlockedAccountIds"],
            "diagnosticAccountIds": diagnostic,
            "skippedAccounts": skipped_accounts,
            "runIds": result["runIds"],
        }

    async def enqueue_register_event(
        self,
        *,
        source_event_id: str,
        account: dict[str, Any],
        profile_ids: list[str],
        execution_mode: str,
        rounds: int,
        proxy_targets: list[dict[str, Any]],
    ) -> dict[str, Any]:
        account_id = int(account.get("id") or 0)
        self._ensure_account_restore_ready(account_id)
        targets = await self.validate_targets(proxy_targets, execution_mode=execution_mode)
        self._validate_account_for_targets(account, targets)
        async with self._enqueue_lock:
            result = self.repository.create_register_runs(
                source_event_id=source_event_id,
                account=account,
                profile_ids=profile_ids,
                execution_mode=execution_mode,
                rounds=rounds,
                proxy_targets=targets,
                priority=150,
                queue_limit=self.settings.probe_queue_limit,
            )
        if result["runIds"]:
            self._wake.set()
        return result

    async def enqueue_plan(self, plan: dict[str, Any]) -> dict[str, Any]:
        plan_id = str(plan["id"])
        profile_ids = list(
            dict.fromkeys(
                str(value).strip()
                for value in (plan.get("profile_ids") or [plan["profile_id"]])
                if str(value).strip()
            )
        )
        if plan.get("overlap_policy") == "skip" and self.repository.active_plan_run_count(plan_id):
            return {"created": 0, "skipped": len(plan["account_ids"]), "reason": "previous_batch_active"}

        requested_ids = {int(value) for value in plan["account_ids"]}
        upstream_accounts = await self.client.list_all_accounts(requested_ids)
        by_id = {int(value.get("id") or 0): value for value in upstream_accounts}
        execution_mode = str(plan.get("execution_mode") or "chat")
        targets = await self.validate_targets(list(plan["proxy_targets"]), execution_mode=execution_mode)
        missing: list[int] = []
        invalid: list[dict[str, Any]] = []
        diagnostic: list[int] = []
        available_accounts: list[dict[str, Any]] = []
        for account_id in sorted(requested_ids):
            account = by_id.get(account_id)
            if account is None:
                missing.append(account_id)
                continue
            try:
                self._validate_account_for_targets(account, targets)
            except ValueError as exc:
                invalid.append({"id": account_id, "reason": str(exc)})
                continue
            if not bool(account.get("enabled")):
                diagnostic.append(account_id)
            available_accounts.append(account)
        async with self._enqueue_lock:
            result = self.repository.create_plan_runs_batch(
                plan_id=plan_id,
                accounts=available_accounts,
                profile_ids=profile_ids,
                execution_mode=execution_mode,
                rounds=int(plan["rounds"]),
                proxy_targets=targets,
                priority=int(plan["priority"]),
                queue_limit=self.settings.probe_queue_limit,
            )
        created = len(result["runIds"])
        if created:
            self._wake.set()
        skipped_account_ids = set(missing)
        skipped_account_ids.update(item["id"] for item in invalid)
        skipped_account_ids.update(result["activeAccountIds"])
        skipped_account_ids.update(result["restoreBlockedAccountIds"])
        return {
            "created": created,
            "skipped": len(skipped_account_ids),
            "missingAccountIds": missing,
            "invalidAccounts": invalid,
            "diagnosticAccountIds": diagnostic,
            "activeAccountIds": result["activeAccountIds"],
            "restoreBlockedAccountIds": result["restoreBlockedAccountIds"],
            "profileIds": result["profileIds"],
            "runIds": result["runIds"],
        }

    async def retry(self, run_id: str) -> str:
        values = self.repository.retry_values(run_id)
        self._ensure_account_restore_ready(int(values["account_id"]))
        account = await self.client.get_account(int(values["account_id"]))
        self._validate_account_for_targets(account, list(values["proxy_targets"]))
        new_id = self.repository.create_run(
            **values,
            trigger="retry",
            priority=100,
            queue_limit=self.settings.probe_queue_limit,
        )
        self._wake.set()
        return new_id

    async def cancel(self, run_id: str) -> str:
        status = self.repository.request_cancel(run_id)
        active = self._active_calls.get(run_id)
        if active:
            active.cancel()
        self._wake.set()
        return status

    async def cancel_many(self, run_ids: list[str]) -> dict[str, int]:
        result, interrupt_ids = self.repository.request_cancel_many(run_ids)
        for run_id in interrupt_ids:
            active = self._active_calls.get(run_id)
            if active:
                active.cancel()
        self._wake.set()
        return result

    async def restore_many(self, run_ids: list[str]) -> dict[str, Any]:
        """Replay persisted account snapshots for many runs, one at a time.

        Each restore mutates shared upstream account state behind the claim
        lock, so the runs are processed sequentially and a failing run only
        reports itself instead of aborting the batch.
        """

        requested = list(dict.fromkeys(run_id for run_id in run_ids if run_id))
        restored = 0
        failures: list[dict[str, str]] = []
        for run_id in requested:
            try:
                await self.restore_run_account_settings(run_id)
                restored += 1
            except Exception as exc:
                failures.append({"id": run_id, "error": str(exc)})
        return {
            "requested": len(requested),
            "restored": restored,
            "failed": len(failures),
            "failedRunIds": [failure["id"] for failure in failures],
            "failures": failures,
        }

    async def validate_targets(
        self, targets: list[dict[str, Any]], *, execution_mode: str = "chat"
    ) -> list[dict[str, Any]]:
        if not targets:
            raise ValueError("至少选择一个账号当前出口或诊断出口目标")
        if execution_mode not in {"chat", "quality_test"}:
            raise ValueError("探针执行模式无效")
        if execution_mode == "quality_test" and any(target.get("kind") != "egress" for target in targets):
            raise ValueError("快速出口质量探针仅支持 grok_build 出口节点")
        if any(target.get("kind") == "current" for target in targets) and any(
            target.get("kind") != "current" for target in targets
        ):
            raise ValueError("账号当前出口不能与诊断出口混用，请分别创建定检和诊断任务")
        requested_node_ids = {
            int(target.get("id") or 0) for target in targets if target.get("kind") == "egress"
        }
        requested_node_ids.discard(0)
        nodes_by_id: dict[int, dict[str, Any]] = {}
        if requested_node_ids:
            page = 1
            while True:
                payload = await self.client.list_egress_nodes(page=page, pageSize=500)
                batch = list(payload.get("items", []))
                for node in batch:
                    node_id = int(node.get("id") or 0)
                    if node_id in requested_node_ids:
                        nodes_by_id[node_id] = node
                if requested_node_ids <= nodes_by_id.keys():
                    break
                if not batch or page * int(payload.get("pageSize") or 500) >= int(payload.get("total") or 0):
                    break
                page += 1

        normalized: list[dict[str, Any]] = []
        seen: set[str] = set()
        for target in targets:
            kind = str(target.get("kind") or "")
            if kind == "current":
                value = {"kind": "current", "id": None, "name": "账号当前出口"}
                key = "current"
            elif kind == "direct":
                value = {"kind": "direct", "id": None, "name": "上游调度（诊断）"}
                key = "direct"
            elif kind == "egress":
                node_id = int(target.get("id") or 0)
                node = nodes_by_id.get(node_id)
                if node is None:
                    raise ValueError(f"出口节点 {node_id} 不存在")
                if not node.get("enabled") or not node.get("proxyConfigured"):
                    raise ValueError(f"出口节点 {node_id} 未启用或未配置代理")
                value = {"kind": "egress", "id": node_id, "name": str(node.get("name") or node_id)}
                key = f"egress:{node_id}"
            else:
                raise ValueError("代理目标 kind 必须为 current、direct 或 egress")
            if key not in seen:
                normalized.append(value)
                seen.add(key)
        return normalized

    @staticmethod
    def _validate_probe_account(account: dict[str, Any]) -> None:
        account_id = int(account.get("id") or 0)
        auth_status = str(account.get("authStatus") or "")
        if auth_status and auth_status != "active":
            raise ValueError(f"账号 {account_id} 当前鉴权状态为 {auth_status}，暂不具备探针执行条件")

    @classmethod
    def _validate_account_for_targets(cls, account: dict[str, Any], targets: list[dict[str, Any]]) -> None:
        cls._validate_probe_account(account)
        if not any(target.get("kind") == "current" for target in targets):
            return
        account_id = int(account.get("id") or 0)
        if not bool(account.get("enabled")):
            raise ValueError(f"账号 {account_id} 已停用，正常定检不会临时激活；请启用账号或改用人工诊断")
        if int(account.get("egressNodeId") or 0) <= 0:
            raise ValueError(f"账号 {account_id} 未绑定固定出口；请先在 grok2api 绑定账号出口")

    def _ensure_account_restore_ready(self, account_id: int) -> None:
        if self.repository.has_blocking_account_restore(account_id=account_id):
            raise RunStateError("该账号存在未完成的原设置恢复，请先在历史任务中人工同步")

    def status(self) -> dict[str, Any]:
        queue = self.repository.worker_queue_stats()
        now = utc_now()
        workers: list[dict[str, Any]] = []
        for index in sorted(set(self._worker_runtime) | set(self._workers)):
            runtime = self._worker_runtime.get(index)
            if runtime is None:
                runtime = self._new_worker_runtime(index)
                self._worker_runtime[index] = runtime
            task = self._workers.get(index)
            status = runtime.status
            if task is not None and task.done() and status not in {"stopped", "restarting"}:
                status = "error"
            elif status == "idle" and queue["queued"] > 0 and queue["eligible"] == 0:
                status = "blocked"
            workers.append(
                {
                    "id": runtime.worker_id,
                    "index": runtime.index,
                    "status": status,
                    "desired": index <= self._desired_worker_concurrency,
                    "taskAlive": bool(task and not task.done()),
                    "startedAt": app_isoformat(runtime.started_at),
                    "stateChangedAt": app_isoformat(runtime.state_changed_at),
                    "lastHeartbeatAt": app_isoformat(runtime.last_heartbeat_at),
                    "completedRuns": runtime.completed_runs,
                    "failedRuns": runtime.failed_runs,
                    "lastError": runtime.last_error,
                    "currentRun": (
                        {
                            "id": runtime.current_run_id,
                            "accountId": runtime.current_account_id,
                            "accountName": runtime.current_account_name,
                            "profileId": runtime.current_profile_id,
                            "profileName": runtime.current_profile_name,
                            "executionMode": runtime.current_execution_mode,
                            "round": runtime.current_round,
                            "targetKey": runtime.current_target_key,
                            "startedAt": (
                                app_isoformat(runtime.current_run_started_at)
                                if runtime.current_run_started_at
                                else None
                            ),
                        }
                        if runtime.current_run_id
                        else None
                    ),
                }
            )

        live_workers = sum(bool(task and not task.done()) for task in self._workers.values())
        busy_workers = sum(bool(item["currentRun"]) for item in workers)
        return {
            "process": {
                "pid": os.getpid(),
                "hostname": socket.gethostname(),
                "startedAt": app_isoformat(self._process_started_at),
                "uptimeSeconds": max(0, int((now - self._process_started_at).total_seconds())),
                "model": "single_process_asyncio",
            },
            "started": self._started,
            "stopping": self._stopping,
            "configuredConcurrency": self.settings.probe_worker_concurrency,
            "desiredConcurrency": self._desired_worker_concurrency,
            "liveWorkers": live_workers,
            "busyWorkers": busy_workers,
            "idleWorkers": max(0, live_workers - busy_workers),
            "queue": queue,
            "workers": workers,
            "policy": {
                "sameAccountSerial": True,
                "reason": (
                    "正常定检保持账号当前出口，诊断任务才会临时修改账号设置；"
                    "为避免同一账号的请求和诊断状态冲突，同账号任务始终顺序执行。"
                ),
            },
            "log": {
                "fileName": self.log_path.name,
                "retentionDays": PROBE_LOG_RETENTION_DAYS,
                "sizeBytes": probe_log_size(self.log_path),
            },
        }

    def logs(self, limit: int) -> dict[str, Any]:
        return {
            "items": recent_log_lines(self.log_path, limit),
            "limit": limit,
            "fileName": self.log_path.name,
            "retentionDays": PROBE_LOG_RETENTION_DAYS,
            "sizeBytes": probe_log_size(self.log_path),
        }

    def _new_worker_runtime(self, index: int) -> WorkerRuntime:
        now = utc_now()
        return WorkerRuntime(
            index=index,
            worker_id=f"worker-{index}",
            status="starting",
            started_at=now,
            state_changed_at=now,
            last_heartbeat_at=now,
        )

    def _spawn_worker(self, index: int) -> None:
        runtime = self._new_worker_runtime(index)
        self._worker_runtime[index] = runtime
        task = asyncio.create_task(self._worker(index), name=f"probe-worker-{index}")
        self._workers[index] = task
        task.add_done_callback(
            lambda finished, worker_index=index: self._handle_worker_exit(worker_index, finished)
        )

    def _handle_worker_exit(self, index: int, task: asyncio.Task[None]) -> None:
        if self._workers.get(index) is not task:
            return
        runtime = self._worker_runtime.get(index)
        if self._stopping or index > self._desired_worker_concurrency:
            if runtime is not None:
                self._set_worker_status(runtime, "stopped")
            return
        error = ""
        if task.cancelled():
            error = "Worker task cancelled unexpectedly"
        else:
            exception = task.exception()
            if exception is not None:
                error = str(exception)
        if runtime is not None:
            runtime.last_error = error
            self._set_worker_status(runtime, "restarting")
        logger.error(
            "worker exited unexpectedly worker=%s error=%s; restarting",
            f"worker-{index}",
            error or "task returned",
        )
        self._spawn_worker(index)

    @staticmethod
    def _set_worker_status(runtime: WorkerRuntime, status: str) -> None:
        now = utc_now()
        if runtime.status != status:
            runtime.status = status
            runtime.state_changed_at = now
        runtime.last_heartbeat_at = now

    @staticmethod
    def _clear_worker_run(runtime: WorkerRuntime) -> None:
        runtime.current_run_id = ""
        runtime.current_account_id = None
        runtime.current_account_name = ""
        runtime.current_profile_id = ""
        runtime.current_profile_name = ""
        runtime.current_execution_mode = ""
        runtime.current_round = None
        runtime.current_target_key = ""
        runtime.current_run_started_at = None

    async def _worker(self, index: int) -> None:
        worker_id = f"worker-{index}"
        runtime = self._worker_runtime[index]
        self._set_worker_status(runtime, "idle")
        logger.info("worker started worker=%s pid=%s", worker_id, os.getpid())
        try:
            while True:
                if self._stopping:
                    return
                if index > self._desired_worker_concurrency:
                    return
                try:
                    async with self._claim_lock:
                        context = self.repository.claim_next(worker_id)
                except Exception as exc:
                    runtime.last_error = str(exc)
                    self._set_worker_status(runtime, "error")
                    logger.exception("worker claim failed worker=%s", worker_id)
                    await asyncio.sleep(1)
                    continue
                if context is None:
                    self._set_worker_status(runtime, "idle")
                    self._wake.clear()
                    try:
                        await asyncio.wait_for(self._wake.wait(), timeout=1.0)
                    except TimeoutError:
                        pass
                    continue

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
                self._set_worker_status(runtime, "running")
                logger.info(
                    "run claimed worker=%s run=%s account=%s profile=%s mode=%s",
                    worker_id,
                    runtime.current_run_id,
                    runtime.current_account_id,
                    runtime.current_profile_id,
                    runtime.current_execution_mode,
                )

                finished: dict[str, Any] | None = None
                try:
                    finished = await self._execute(context, runtime)
                except Exception as exc:
                    runtime.last_error = str(exc)
                    logger.exception(
                        "unhandled worker execution error worker=%s run=%s",
                        worker_id,
                        runtime.current_run_id,
                    )
                    current = self.repository.get_run(runtime.current_run_id)
                    if current and str(current.get("status")) in {
                        "running",
                        "cancel_requested",
                        "recovering",
                    }:
                        try:
                            finished = self.repository.finish_run(
                                runtime.current_run_id,
                                status="failed",
                                error=f"Worker 未处理异常: {exc}",
                            )
                        except Exception:
                            logger.exception(
                                "failed to finalize crashed run worker=%s run=%s",
                                worker_id,
                                runtime.current_run_id,
                            )
                finally:
                    if finished is not None:
                        runtime.completed_runs += 1
                        if str(finished.get("status")) in {
                            "failed",
                            "completed_with_errors",
                        }:
                            runtime.failed_runs += 1
                    self._clear_worker_run(runtime)
                    self._set_worker_status(
                        runtime,
                        "stopping" if index > self._desired_worker_concurrency else "idle",
                    )
        finally:
            self._clear_worker_run(runtime)
            self._set_worker_status(runtime, "stopped")
            logger.info("worker stopped worker=%s pid=%s", worker_id, os.getpid())

    async def _execute(
        self,
        context: RunExecutionContext,
        runtime: WorkerRuntime,
    ) -> dict[str, Any]:
        run = context.run
        profile = context.profile
        run_id = str(run["id"])
        account_id = int(run["account_id"])
        execution_mode = str(run.get("execution_mode") or "chat")
        original_node_id: int | None = None
        original_mode = ""
        snapshot: AccountSettingsSnapshot | None = None
        route_id = ""
        public_model = ""
        client_key_id = ""
        api_key = ""
        cancelled = False
        fatal_error = ""
        cleanup_errors: list[str] = []

        try:
            account = await self.client.get_account(account_id)
            self._validate_account_for_targets(account, list(run["proxy_targets"]))
            original_node_id = int(account.get("egressNodeId") or 0) or None
            original_mode = str(account.get("egressAssignmentMode") or "")
            priority_value = account.get("priority")
            snapshot = self.repository.ensure_account_settings_snapshot(
                run_id=run_id,
                enabled=bool(account.get("enabled")),
                priority=int(priority_value) if priority_value is not None else 1,
                max_concurrent=int(account.get("maxConcurrent") or 1),
                egress_node_id=original_node_id,
                egress_assignment_mode=original_mode,
                diagnostic_priority=self.settings.probe_diagnostic_priority,
                diagnostic_max_concurrent=1,
            )
            route_id, public_model = await self.client.create_probe_route(
                account_id=account_id,
                upstream_model=str(profile["model"]),
                allow_temporarily_unavailable=not snapshot.enabled,
            )
            self.repository.set_upstream_context(
                run_id=run_id,
                original_node_id=original_node_id,
                original_mode=original_mode,
                route_id=route_id,
                public_model=public_model,
                client_key_id="",
            )
            client_key_id, api_key = await self.client.create_probe_client_key(route_id)
            self.repository.set_upstream_context(
                run_id=run_id,
                original_node_id=original_node_id,
                original_mode=original_mode,
                route_id=route_id,
                public_model=public_model,
                client_key_id=client_key_id,
            )

            completed = self.repository.completed_step_keys(run_id)
            for round_number in range(1, int(run["rounds"]) + 1):
                for target in run["proxy_targets"]:
                    target_key = self._target_key(target)
                    if (round_number, target_key) in completed:
                        continue
                    if self._stopping or self.repository.is_cancel_requested(run_id):
                        cancelled = True
                        break
                    self.repository.set_current_step(run_id, round_number, target_key)
                    runtime.current_round = round_number
                    runtime.current_target_key = target_key
                    self._set_worker_status(runtime, "running")
                    logger.info(
                        "step started worker=%s run=%s account=%s round=%s target=%s",
                        runtime.worker_id,
                        run_id,
                        account_id,
                        round_number,
                        target_key,
                    )
                    try:
                        if execution_mode == "chat":
                            if target.get("kind") == "current":
                                await self._wait_for_current_probe_slot(run_id)
                                live_account = await self.client.get_account(account_id)
                                live_node_id = int(live_account.get("egressNodeId") or 0) or None
                                if live_node_id != original_node_id:
                                    raise IntegrationError(
                                        f"账号出口在定检期间从节点 {original_node_id} 变为 "
                                        f"{live_node_id or '未绑定'}，已停止该样本"
                                    )
                            else:
                                self.repository.mark_account_mutation_pending(run_id)
                                await self.client.set_account_egress(account_id, target)
                                await asyncio.sleep(0.15)

                            def probe_factory() -> Awaitable[Any]:
                                return self.client.chat_probe(
                                    api_key=api_key,
                                    public_model=public_model,
                                    account_id=account_id,
                                    system_prompt=str(profile["system_prompt"]),
                                    prompt=str(profile["prompt"]),
                                    expected=str(profile["expected_text"]),
                                    max_output_tokens=int(profile["max_output_tokens"]),
                                    temperature=profile["temperature"],
                                    extra_body=dict(profile["extra_body"] or {}),
                                )

                        else:
                            egress_node_id = int(target.get("id") or 0)

                            def probe_factory(
                                node_id: int = egress_node_id,
                            ) -> Awaitable[Any]:
                                return self.client.quality_probe(
                                    client_key_id=client_key_id,
                                    public_model=public_model,
                                    account_id=account_id,
                                    egress_node_id=node_id,
                                    # Keep quick mode independent of user profiles
                                    # while exposing a readable validation marker.
                                    prompt=FAST_QUALITY_PROBE_PROMPT,
                                    expected=FAST_QUALITY_PROBE_EXPECTED,
                                    max_output_tokens=0,
                                )

                        result = await self._run_probe_call(
                            run_id=run_id,
                            account_id=account_id,
                            snapshot=snapshot,
                            factory=probe_factory,
                        )
                        self._verify_probe_egress(
                            target=target,
                            original_node_id=original_node_id,
                            result=result,
                        )
                    except asyncio.CancelledError:
                        cancelled = True
                        break
                    except AccountRestoreError:
                        raise
                    except Exception as exc:
                        if isinstance(exc, IntegrationError) and exc.transient:
                            await self._wait_for_account_cooldown(run_id, account_id, exc)
                        self.repository.add_sample(
                            run_id,
                            self._error_sample(
                                round_number,
                                target,
                                exc,
                                current_node_id=original_node_id,
                            ),
                        )
                        logger.warning(
                            "step failed worker=%s run=%s account=%s round=%s target=%s "
                            "status=%s code=%s error=%s",
                            runtime.worker_id,
                            run_id,
                            account_id,
                            round_number,
                            target_key,
                            int(getattr(exc, "status_code", 0) or 0),
                            str(getattr(exc, "error_code", "") or ""),
                            str(exc),
                        )
                    else:
                        classified = classify_sample(
                            SampleMetrics(
                                status_code=result.status_code,
                                output_tokens=result.output_tokens,
                                reasoning_tokens=result.reasoning_tokens,
                                first_token_ms=result.first_token_ms,
                                duration_ms=result.duration_ms,
                                egress_key=target_key,
                                expected_matched=result.expected_matched,
                            ),
                            self.thresholds,
                        )
                        self.repository.add_sample(
                            run_id,
                            {
                                "round_number": round_number,
                                "target_key": target_key,
                                "target_kind": str(target["kind"]),
                                "egress_node_id": (
                                    original_node_id if target.get("kind") == "current" else target.get("id")
                                ),
                                "egress_name": str(target.get("name") or ""),
                                "request_id": result.request_id,
                                "audit_id": result.audit_id,
                                "verified_account_id": result.verified_account_id,
                                "verified_egress_node_id": result.verified_egress_node_id,
                                "status": "done",
                                "status_code": result.status_code,
                                "output_tokens": result.output_tokens,
                                "reasoning_tokens": result.reasoning_tokens,
                                "visible_tokens": result.visible_tokens,
                                "chunk_count": result.chunk_count,
                                "first_token_ms": result.first_token_ms,
                                "duration_ms": result.duration_ms,
                                "generation_ms": result.generation_ms,
                                "first_token_share": result.first_token_share,
                                "tps": result.tps,
                                "expected_matched": result.expected_matched,
                                "response_sha256": result.response_sha256,
                                "response_text": result.response_text,
                                "usage": result.usage,
                                "classification": classified.name,
                                "severity": classified.severity,
                                "error": "",
                                "created_at": utc_now(),
                            },
                        )
                        logger.info(
                            "step completed worker=%s run=%s account=%s round=%s target=%s "
                            "http=%s output_tokens=%s tps=%.2f duration_ms=%s classification=%s",
                            runtime.worker_id,
                            run_id,
                            account_id,
                            round_number,
                            target_key,
                            result.status_code,
                            result.output_tokens,
                            result.tps,
                            result.duration_ms,
                            classified.name,
                        )
                    if cancelled:
                        break
                    if self.settings.probe_step_delay_seconds:
                        await asyncio.sleep(self.settings.probe_step_delay_seconds)
                if cancelled:
                    break
        except asyncio.CancelledError:
            cancelled = True
        except Exception as exc:
            fatal_error = str(exc)
            logger.exception("probe run %s failed", run_id)
        finally:
            cleanup_result = await self._cleanup_upstream(
                run_id=run_id,
                account_id=account_id,
                snapshot=snapshot,
                legacy_original_node_id=original_node_id,
                legacy_original_mode=original_mode,
                route_id=route_id,
                client_key_id=client_key_id,
                restore_egress=self._run_changes_egress(run),
                source="automatic",
            )
            cleanup_errors.extend(cleanup_result.errors)
            if not cleanup_result.resource_errors:
                self.repository.clear_upstream_context(run_id)

        error = "; ".join(value for value in [fatal_error, *cleanup_errors] if value)
        if cancelled:
            status = "cancelled"
        elif fatal_error:
            status = "failed"
        elif cleanup_errors:
            status = "completed_with_errors"
        else:
            status = None
        finished = self.repository.finish_run(run_id, status=status, error=error)
        try:
            previous_assessment = self.accounts.get_assessment(account_id)
            assessment = self.accounts.recalculate(
                account_id,
                self.thresholds,
                self.settings.analysis_window_hours,
            )
        except Exception:
            # Run evidence is already complete. Post-processing failure must be
            # visible in the rotating log, but it must not terminate a Worker.
            logger.exception(
                "run post-processing failed worker=%s run=%s account=%s",
                runtime.worker_id,
                run_id,
                account_id,
            )
        else:
            try:
                assessment = await self._apply_auto_quarantine(account_id, assessment)
            except Exception:
                # A failed automatic action must not suppress the risk message;
                # send the recalculated high-risk assessment below.
                logger.exception(
                    "auto quarantine failed worker=%s run=%s account=%s",
                    runtime.worker_id,
                    run_id,
                    account_id,
                )
            if self.notifications is not None:
                try:
                    trigger = str(run.get("trigger") or "probe")
                    force_notification = trigger in {"manual", "retry"} and str(
                        finished.get("status") or ""
                    ) in {"completed", "completed_with_errors"}
                    await self.notifications.notify_account_transition(
                        account={
                            "id": account_id,
                            "name": str(run.get("account_name") or ""),
                            "email": str(run.get("account_email") or ""),
                        },
                        previous=previous_assessment,
                        current=assessment,
                        source=trigger,
                        force=force_notification,
                    )
                except Exception:
                    logger.exception(
                        "wechat notification failed worker=%s run=%s account=%s",
                        runtime.worker_id,
                        run_id,
                        account_id,
                    )
        logger.info(
            "run finished worker=%s run=%s account=%s status=%s completed_steps=%s/%s errors=%s",
            runtime.worker_id,
            run_id,
            account_id,
            finished.get("status"),
            finished.get("completed_steps"),
            finished.get("total_steps"),
            finished.get("error_count"),
        )
        return finished

    async def _run_probe_call(
        self,
        *,
        run_id: str,
        account_id: int,
        snapshot: AccountSettingsSnapshot,
        factory: Callable[[], Awaitable[Any]],
    ) -> Any:
        """Run one sample, temporarily activating an originally disabled account."""

        primary_error: BaseException | None = None
        activation_required = not snapshot.enabled
        try:
            if activation_required:
                # Persist intent before the upstream PATCH. A crash between the
                # two operations is therefore handled conservatively by startup
                # recovery or the task detail's manual synchronization action.
                self.repository.set_diagnostic_activation(run_id, True)
                await self.client.set_account_routing_settings(
                    account_id,
                    enabled=True,
                    priority=snapshot.diagnostic_priority,
                    max_concurrent=snapshot.diagnostic_max_concurrent,
                )
                await asyncio.sleep(0.15)

            retry_limit = max(0, int(getattr(self.settings, "probe_transient_retry_attempts", 2)))
            for attempt in range(retry_limit + 1):
                call = asyncio.create_task(factory(), name=f"probe-call-{run_id}-{attempt + 1}")
                self._active_calls[run_id] = call
                try:
                    result = await call
                    self._active_calls.pop(run_id, None)
                    if attempt and hasattr(result, "usage"):
                        # Keep the successful sample as one logical step while
                        # exposing how many upstream attempts were needed.
                        usage = dict(result.usage or {})
                        usage["probeAttempts"] = attempt + 1
                        try:
                            result = replace(result, usage=usage)
                        except (TypeError, ValueError):
                            pass
                    return result
                except asyncio.CancelledError:
                    raise
                except IntegrationError as exc:
                    self._active_calls.pop(run_id, None)
                    exc.attempt_count = attempt + 1
                    primary_error = exc
                    if not exc.transient or attempt >= retry_limit:
                        raise
                    delay = await self._transient_retry_delay(
                        account_id=account_id,
                        error=exc,
                        attempt=attempt,
                    )
                    logger.info(
                        "probe %s transient upstream state (%s/%s), retrying in %.1fs: %s",
                        run_id,
                        attempt + 1,
                        retry_limit + 1,
                        delay,
                        exc,
                    )
                    await self._sleep_probe_delay(run_id, delay)
                finally:
                    self._active_calls.pop(run_id, None)
        except BaseException as exc:
            primary_error = exc
            raise
        finally:
            self._active_calls.pop(run_id, None)
            if activation_required:
                try:
                    await self._restore_diagnostic_activation(
                        run_id=run_id,
                        account_id=account_id,
                        snapshot=snapshot,
                    )
                except Exception as exc:
                    message = f"单次探针后恢复账号路由设置失败: {exc}"
                    self.repository.finish_account_restore(run_id, "automatic", message)
                    if isinstance(primary_error, asyncio.CancelledError):
                        logger.exception("%s", message)
                    else:
                        raise AccountRestoreError(message) from exc

    async def _transient_retry_delay(
        self,
        *,
        account_id: int,
        error: IntegrationError,
        attempt: int,
    ) -> float:
        """Choose a bounded delay without confusing quota with availability.

        grok2api normally sends ``Retry-After`` for cooling responses.  The
        account-scoped 503 used by a pinned temporary route may not include
        that header, so consult the live account record as a second source and
        finally use a small exponential fallback.
        """

        base = max(
            0.1,
            float(getattr(self.settings, "probe_transient_retry_base_seconds", 5.0)),
        )
        maximum = max(
            base,
            float(getattr(self.settings, "probe_transient_retry_max_seconds", 30.0)),
        )
        delay = max(error.retry_after_seconds, base * (2**attempt))
        try:
            account = await self.client.get_account(account_id)
            cooldown_until = account.get("cooldownUntil")
            if cooldown_until:
                value = str(cooldown_until).replace("Z", "+00:00")
                remaining = (
                    datetime.fromisoformat(value).astimezone(UTC) - datetime.now(UTC)
                ).total_seconds()
                if remaining > 0:
                    delay = max(delay, remaining)
        except Exception:
            # The retry must still work when the admin endpoint is briefly
            # unavailable; the fallback above is deliberately sufficient for
            # grok2api's short network cooldown.
            pass
        return min(maximum, max(0.1, delay))

    async def _wait_for_account_cooldown(
        self,
        run_id: str,
        account_id: int,
        error: IntegrationError,
    ) -> None:
        """Let a final transient failure settle before the next target.

        A failed proxy can cool the account globally in grok2api.  Advancing
        immediately to the next proxy would then produce a cascade of 429/503
        samples that say nothing about that next proxy.  Only wait when the
        upstream account endpoint reports a concrete future cooldown, and cap
        it with the same retry ceiling used above.
        """

        if not error.transient:
            return
        try:
            account = await self.client.get_account(account_id)
            cooldown_until = account.get("cooldownUntil")
            if not cooldown_until:
                return
            remaining = (
                datetime.fromisoformat(str(cooldown_until).replace("Z", "+00:00")).astimezone(UTC)
                - datetime.now(UTC)
            ).total_seconds()
            maximum = max(
                0.1,
                float(getattr(self.settings, "probe_transient_retry_max_seconds", 30.0)),
            )
            if remaining > 0:
                await self._sleep_probe_delay(run_id, min(maximum, remaining))
        except asyncio.CancelledError:
            raise
        except Exception:
            return

    async def _sleep_probe_delay(self, run_id: str, seconds: float) -> None:
        """Sleep in short slices so cancellation and shutdown stay responsive."""

        deadline = asyncio.get_running_loop().time() + max(0.0, seconds)
        while True:
            if self._stopping or self.repository.is_cancel_requested(run_id):
                raise asyncio.CancelledError
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return
            await asyncio.sleep(min(0.5, remaining))

    async def _wait_for_current_probe_slot(self, run_id: str) -> None:
        """Rate-limit normal checks across all workers without affecting diagnostics."""

        interval = max(
            0.0,
            float(
                getattr(
                    self.settings,
                    "probe_current_egress_interval_seconds",
                    10.0,
                )
            ),
        )
        if interval <= 0:
            return
        async with self._current_probe_lock:
            loop = asyncio.get_running_loop()
            delay = self._next_current_probe_at - loop.time()
            if delay > 0:
                await self._sleep_probe_delay(run_id, delay)
            self._next_current_probe_at = loop.time() + interval

    async def _restore_diagnostic_activation(
        self,
        *,
        run_id: str,
        account_id: int,
        snapshot: AccountSettingsSnapshot,
    ) -> None:
        async def restore() -> None:
            await self.client.set_account_routing_settings(
                account_id,
                enabled=snapshot.enabled,
                priority=snapshot.priority,
                max_concurrent=snapshot.max_concurrent,
            )
            self.repository.set_diagnostic_activation(run_id, False)

        task = asyncio.create_task(restore(), name=f"probe-account-restore-{run_id}")
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

    async def _cleanup_upstream(
        self,
        *,
        run_id: str,
        account_id: int,
        snapshot: AccountSettingsSnapshot | None,
        legacy_original_node_id: int | None,
        legacy_original_mode: str,
        route_id: str,
        client_key_id: str,
        restore_egress: bool,
        source: str,
        account_restore_started: bool = False,
    ) -> UpstreamCleanupResult:
        account_errors: list[str] = []
        resource_errors: list[str] = []

        async def cleanup() -> None:
            current_run = self.repository.get_run(run_id) or {}
            restore_status = str(current_run.get("account_restore_status") or "")
            restore_egress_requested = restore_egress and (
                source == "manual" or restore_status in {"pending", "restoring", "restore_failed"}
            )
            restore_requested = (
                bool(current_run.get("diagnostic_activation_active"))
                or restore_status in {"pending", "restoring", "restore_failed"}
                or restore_egress_requested
                or source == "manual"
            )
            restore_account_routing = bool(
                current_run.get("diagnostic_activation_active")
                or (source == "manual" and snapshot is not None and not snapshot.enabled)
            )
            if snapshot is not None:
                if restore_requested and not account_restore_started:
                    self.repository.begin_account_restore(run_id, source)
                if restore_account_routing:
                    try:
                        await self.client.set_account_routing_settings(
                            account_id,
                            enabled=snapshot.enabled,
                            priority=snapshot.priority,
                            max_concurrent=snapshot.max_concurrent,
                        )
                        self.repository.set_diagnostic_activation(run_id, False)
                    except Exception as exc:
                        account_errors.append(f"恢复启用状态、优先级和并发数失败: {exc}")
                if restore_egress_requested:
                    try:
                        await self.client.restore_account_egress(
                            account_id,
                            snapshot.egress_node_id,
                            snapshot.egress_assignment_mode,
                        )
                    except Exception as exc:
                        account_errors.append(f"恢复账号出口失败: {exc}")
                if restore_requested:
                    restore_error = "; ".join(account_errors)
                    self.repository.finish_account_restore(run_id, source, restore_error)
            elif restore_egress_requested:
                if not account_restore_started:
                    self.repository.begin_account_restore(run_id, source)
                try:
                    await self.client.restore_account_egress(
                        account_id, legacy_original_node_id, legacy_original_mode
                    )
                except Exception as exc:
                    account_errors.append(f"恢复账号出口失败: {exc}")
                self.repository.finish_account_restore(run_id, source, "; ".join(account_errors))
            try:
                await self.client.delete_probe_client_key(client_key_id)
            except Exception as exc:
                resource_errors.append(f"删除临时 Client Key 失败: {exc}")
            try:
                await self.client.delete_probe_route(route_id)
            except Exception as exc:
                resource_errors.append(f"删除临时模型路由失败: {exc}")

        task = asyncio.create_task(cleanup())
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
        return UpstreamCleanupResult(
            account_errors=account_errors,
            resource_errors=resource_errors,
        )

    async def _recover_interrupted_runs(self) -> None:
        for run in self.repository.interrupted_runs():
            run_id = str(run["id"])
            cleanup_result = await self._cleanup_upstream(
                run_id=run_id,
                account_id=int(run["account_id"]),
                snapshot=self.repository.account_settings_snapshot(run_id),
                legacy_original_node_id=run["original_egress_node_id"],
                legacy_original_mode=str(run["original_egress_assignment_mode"] or ""),
                route_id=str(run["temporary_route_id"] or ""),
                client_key_id=str(run["temporary_client_key_id"] or ""),
                restore_egress=self._run_changes_egress(run),
                source="startup",
            )
            if not cleanup_result.resource_errors:
                self.repository.clear_upstream_context(run_id)
            self.repository.finish_recovery(run_id, "; ".join(cleanup_result.errors))
        try:
            cleaned = await self.client.cleanup_stale_resources()
            if any(cleaned.values()):
                logger.info("cleaned stale grok2api probe resources: %s", cleaned)
        except Exception as exc:
            logger.warning("stale probe resource cleanup skipped: %s", exc)

    async def restore_run_account_settings(self, run_id: str) -> dict[str, Any]:
        """Replay a run's persisted snapshot as an operator compensation action."""

        run = self.repository.get_run(run_id)
        if run is None:
            raise ValueError("探针任务不存在")
        if run["status"] not in {"completed", "completed_with_errors", "failed", "cancelled"}:
            raise RunStateError("任务执行期间由自动恢复流程管理账号设置")
        account_id = int(run["account_id"])
        snapshot = self.repository.account_settings_snapshot(run_id)
        restore_egress = self._run_changes_egress(run)
        if snapshot is None and not restore_egress:
            raise RunStateError("该任务没有可同步的账号原设置记录")
        if (
            not restore_egress
            and not bool(run.get("diagnostic_activation_active"))
            and str(run.get("account_restore_status") or "") != "restore_failed"
        ):
            raise RunStateError("正常定检未修改账号设置，无需同步")

        async with self._claim_lock:
            if self.repository.has_executing_run(
                account_id=account_id,
                exclude_run_id=run_id,
            ):
                raise RunStateError("该账号存在执行中的探针任务")
            self.repository.begin_account_restore(run_id, "manual")

        cleanup_result = await self._cleanup_upstream(
            run_id=run_id,
            account_id=account_id,
            snapshot=snapshot,
            legacy_original_node_id=(
                snapshot.egress_node_id if snapshot is not None else run.get("original_egress_node_id")
            ),
            legacy_original_mode=(
                snapshot.egress_assignment_mode
                if snapshot is not None
                else str(run.get("original_egress_assignment_mode") or "")
            ),
            route_id=str(run.get("temporary_route_id") or ""),
            client_key_id=str(run.get("temporary_client_key_id") or ""),
            restore_egress=restore_egress,
            source="manual",
            account_restore_started=True,
        )
        if cleanup_result.account_errors:
            raise AccountRestoreError("; ".join(cleanup_result.account_errors))
        if cleanup_result.resource_errors:
            logger.warning(
                "account settings restored for run %s with resource cleanup warnings: %s",
                run_id,
                "; ".join(cleanup_result.resource_errors),
            )
        else:
            self.repository.clear_upstream_context(run_id)
        self._wake.set()
        return self.repository.get_run(run_id) or {}

    async def _apply_auto_quarantine(
        self,
        account_id: int,
        assessment: dict[str, Any],
    ) -> dict[str, Any]:
        if not self.settings.auto_quarantine or assessment["monitor_status"] != "high_risk":
            return assessment
        if assessment.get("disabled_by_monitor"):
            return assessment
        account = await self.client.get_account(account_id)
        was_enabled = bool(account.get("enabled"))
        if was_enabled:
            await self.client.set_account_enabled(account_id, False)
        until = utc_now() + timedelta(minutes=self.settings.quarantine_minutes)
        quarantined = self.accounts.set_manual_status(
            account_id=account_id,
            status="quarantined",
            note="连续多出口探针达到自动隔离阈值",
            quarantine_until=until,
            previous_upstream_enabled=was_enabled,
            disabled_by_monitor=was_enabled,
            recovery_guarded=False,
        )
        self.accounts.create_alert(
            account_id=account_id,
            kind="auto_quarantine",
            severity="critical",
            title="账号已被自动暂时停用",
            detail={
                "quarantineUntil": app_isoformat(until),
                "riskScore": assessment["risk_score"],
            },
        )
        return quarantined

    @staticmethod
    def _target_key(target: dict[str, Any]) -> str:
        kind = target.get("kind")
        if kind in {"current", "direct"}:
            return str(kind)
        return f"egress:{int(target.get('id') or 0)}"

    @staticmethod
    def _run_changes_egress(run: dict[str, Any]) -> bool:
        if str(run.get("execution_mode") or "chat") != "chat":
            return False
        return any(target.get("kind") in {"direct", "egress"} for target in run.get("proxy_targets") or [])

    @staticmethod
    def _verify_probe_egress(
        *,
        target: dict[str, Any],
        original_node_id: int | None,
        result: Any,
    ) -> None:
        kind = str(target.get("kind") or "")
        verified_node_id = result.verified_egress_node_id
        expected_node_id = original_node_id if kind == "current" else int(target.get("id") or 0) or None
        if kind == "direct" or expected_node_id == verified_node_id:
            return
        label = "账号当前出口" if kind == "current" else "指定诊断出口"
        actual = str(verified_node_id) if verified_node_id is not None else "本地/未知出口"
        error = IntegrationError(
            f"{label}应为节点 {expected_node_id}，但请求审计记录为 {actual}",
            request_id=str(result.request_id or ""),
        )
        error.audit_id = result.audit_id
        error.verified_account_id = result.verified_account_id
        error.verified_egress_node_id = result.verified_egress_node_id
        error.probe_result = result
        raise error

    def _error_sample(
        self,
        round_number: int,
        target: dict[str, Any],
        error: BaseException | str,
        *,
        current_node_id: int | None = None,
    ) -> dict[str, Any]:
        status_code = int(getattr(error, "status_code", 0) or 0)
        error_code = str(getattr(error, "error_code", "") or "")
        request_id = str(getattr(error, "request_id", "") or "")
        retry_after = float(getattr(error, "retry_after_seconds", 0.0) or 0.0)
        attempt_count = int(getattr(error, "attempt_count", 1) or 1)
        message = str(error)
        result = getattr(error, "probe_result", None)
        usage: dict[str, Any] = dict(result.usage or {}) if result is not None else {}
        if error_code or status_code or retry_after or attempt_count > 1:
            usage["probeError"] = {
                "code": error_code,
                "statusCode": status_code,
                "retryAfterSeconds": round(retry_after, 3),
                "attempts": attempt_count,
                "transient": bool(getattr(error, "transient", False)),
            }
        return {
            "round_number": round_number,
            "target_key": self._target_key(target),
            "target_kind": str(target.get("kind") or ""),
            "egress_node_id": (current_node_id if target.get("kind") == "current" else target.get("id")),
            "egress_name": str(target.get("name") or ""),
            "request_id": request_id,
            "audit_id": getattr(error, "audit_id", None),
            "verified_account_id": getattr(error, "verified_account_id", None),
            "verified_egress_node_id": getattr(error, "verified_egress_node_id", None),
            "status": "error",
            "status_code": result.status_code if result is not None else status_code,
            "error_code": error_code,
            "retry_count": max(0, attempt_count - 1),
            "retry_after_seconds": retry_after,
            "output_tokens": result.output_tokens if result is not None else 0,
            "reasoning_tokens": result.reasoning_tokens if result is not None else 0,
            "visible_tokens": result.visible_tokens if result is not None else 0,
            "chunk_count": result.chunk_count if result is not None else 0,
            "first_token_ms": result.first_token_ms if result is not None else 0,
            "duration_ms": result.duration_ms if result is not None else 0,
            "generation_ms": result.generation_ms if result is not None else 0,
            "first_token_share": result.first_token_share if result is not None else 0.0,
            "tps": result.tps if result is not None else 0.0,
            "expected_matched": result.expected_matched if result is not None else None,
            "response_sha256": result.response_sha256 if result is not None else "",
            "response_text": result.response_text if result is not None else "",
            "usage": usage,
            "classification": "error",
            "severity": 1,
            "error": message[:4000],
            "created_at": utc_now(),
        }
