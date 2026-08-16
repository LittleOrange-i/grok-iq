from __future__ import annotations

import asyncio
import logging
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from app.core.clock import app_now
from app.integrations.sso import (
    SsoChecker,
    SsoCredential,
    SsoCredentialLoader,
    normalize_proxy,
)
from app.persistence.register_event_repository import RegisterEventRepository
from app.persistence.sso_report_repository import SsoReportRepository

logger = logging.getLogger(__name__)
SsoCheckerFactory = Callable[[str, int, int], Any]


class SsoReportNotFoundError(LookupError):
    pass


@dataclass(slots=True)
class SsoReportJob:
    report_id: str
    credentials: list[SsoCredential] = field(repr=False)
    proxy: str = field(default="", repr=False)
    concurrency: int = 8
    request_timeout_seconds: int = 20


class SsoReportService:
    def __init__(
        self,
        repository: SsoReportRepository,
        register_events: RegisterEventRepository | None = None,
        checker: SsoChecker | None = None,
        checker_factory: SsoCheckerFactory | None = None,
    ) -> None:
        self.repository = repository
        self.register_events = register_events
        if checker is not None and checker_factory is not None:
            raise ValueError("checker 和 checker_factory 不能同时设置")
        self.checker_factory = checker_factory or (
            (lambda _proxy, _concurrency, _timeout: checker)
            if checker is not None
            else (
                lambda proxy, concurrency, timeout: SsoChecker(
                    proxy=proxy,
                    max_workers=concurrency,
                    timeout=timeout,
                )
            )
        )
        self._queue: asyncio.Queue[SsoReportJob] = asyncio.Queue()
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        interrupted = self.repository.fail_interrupted()
        if interrupted:
            logger.info("marked interrupted SSO reports failed count=%s", interrupted)
        self._task = asyncio.create_task(self._worker(), name="sso-report-worker")

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task is None:
            return
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        while not self._queue.empty():
            try:
                job = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            self._clear_job(job)
            self._queue.task_done()

    def create(
        self,
        name: str,
        content: str,
        proxy: str = "",
        *,
        concurrency: int = 8,
        request_timeout_seconds: int = 20,
    ) -> dict[str, Any]:
        credentials = SsoCredentialLoader.load(content)
        return self._create_with_credentials(
            name,
            credentials,
            proxy,
            concurrency=concurrency,
            request_timeout_seconds=request_timeout_seconds,
        )

    def create_for_accounts(self, account_ids: list[int]) -> dict[str, Any]:
        if self.register_events is None:
            raise RuntimeError("账号 SSO 存储尚未配置")
        normalized = list(
            dict.fromkeys(int(value) for value in account_ids if int(value) > 0)
        )
        stored = self.register_events.sso_for_accounts(normalized)
        credentials = [
            SsoCredential(
                token=stored[account_id]["sso"],
                expected_email=stored[account_id]["email"],
                label=stored[account_id]["email"] or f"账号 {account_id}",
            )
            for account_id in normalized
            if account_id in stored
        ]
        missing_account_ids = [
            account_id for account_id in normalized if account_id not in stored
        ]
        if not credentials:
            raise ValueError("已选账号均没有可用 SSO")
        report = self._create_with_credentials(
            app_now().strftime("账号 SSO 检测 · %Y-%m-%d %H:%M"),
            credentials,
            "",
            concurrency=8,
            request_timeout_seconds=20,
        )
        return {
            **report,
            "requested": len(normalized),
            "included": len(credentials),
            "missingAccountIds": missing_account_ids,
        }

    def _create_with_credentials(
        self,
        name: str,
        credentials: list[SsoCredential],
        proxy: str,
        *,
        concurrency: int,
        request_timeout_seconds: int,
    ) -> dict[str, Any]:
        if self._task is None or self._task.done():
            raise RuntimeError("SSO 后台检测服务尚未启动")
        if not credentials:
            raise ValueError("至少输入一行 SSO")
        if len(credentials) > 1000:
            self._clear_credentials(credentials)
            raise ValueError("单次最多检测 1000 个 SSO")
        if not 1 <= concurrency <= 32:
            self._clear_credentials(credentials)
            raise ValueError("SSO 任务并发数需在 1–32 之间")
        if not 5 <= request_timeout_seconds <= 120:
            self._clear_credentials(credentials)
            raise ValueError("SSO 单请求超时需在 5–120 秒之间")

        normalized_proxy = normalize_proxy(proxy)
        report = self.repository.create_queued(
            name=name.strip() or app_now().strftime("SSO 检测 · %Y-%m-%d %H:%M"),
            total=len(credentials),
            proxy_used=bool(normalized_proxy),
            concurrency=concurrency,
            request_timeout_seconds=request_timeout_seconds,
        )
        try:
            self._queue.put_nowait(
                SsoReportJob(
                    report_id=str(report["id"]),
                    credentials=credentials,
                    proxy=normalized_proxy,
                    concurrency=concurrency,
                    request_timeout_seconds=request_timeout_seconds,
                )
            )
        except Exception:
            self._clear_credentials(credentials)
            self.repository.delete_if_queued(str(report["id"]))
            raise
        return report

    def list(self) -> list[dict[str, Any]]:
        return self.repository.list()

    def get(self, report_id: str) -> dict[str, Any]:
        report = self.repository.get(report_id)
        if report is None:
            raise SsoReportNotFoundError("SSO 报告不存在")
        return report

    def delete_many(self, report_ids: list[str]) -> dict[str, Any]:
        return self.repository.delete_many(report_ids)

    async def _worker(self) -> None:
        while True:
            job = await self._queue.get()
            try:
                await self._process(job)
            finally:
                self._clear_job(job)
                self._queue.task_done()

    async def _process(self, job: SsoReportJob) -> None:
        if not self.repository.start(job.report_id):
            return
        started = time.perf_counter()
        last_saved_count = 0
        last_saved_at = started

        def progress(completed: int, total: int, _result: dict[str, Any]) -> None:
            nonlocal last_saved_count, last_saved_at
            now = time.perf_counter()
            should_save = (
                completed == total
                or completed - last_saved_count >= 10
                or now - last_saved_at >= 1
            )
            if not should_save:
                return
            self.repository.update_progress(
                job.report_id,
                completed_count=completed,
                elapsed_seconds=round(now - started, 2),
            )
            last_saved_count = completed
            last_saved_at = now

        try:
            checker = self.checker_factory(
                job.proxy,
                job.concurrency,
                job.request_timeout_seconds,
            )

            def run_checks() -> list[dict[str, Any]]:
                try:
                    return checker.check_many(job.credentials, progress=progress)
                except TypeError as exc:
                    if "progress" not in str(exc):
                        raise
                    results = checker.check_many(job.credentials)
                    progress(len(results), len(job.credentials), {})
                    return results

            results = await asyncio.to_thread(run_checks)
            elapsed = round(time.perf_counter() - started, 2)
            self.repository.complete(
                job.report_id,
                summary=self._summary(results),
                results=results,
                elapsed_seconds=elapsed,
            )
        except asyncio.CancelledError:
            self.repository.fail(
                job.report_id,
                "服务正在停止，检测已中断，请重新创建任务",
                round(time.perf_counter() - started, 2),
            )
            raise
        except Exception as exc:
            logger.exception("SSO report processing failed report_id=%s", job.report_id)
            self.repository.fail(
                job.report_id,
                self._redacted_error(exc, job),
                round(time.perf_counter() - started, 2),
            )

    @staticmethod
    def _redacted_error(exc: Exception, job: SsoReportJob) -> str:
        message = str(exc)[:1000]
        for credential in job.credentials:
            if credential.token:
                message = message.replace(credential.token, "[REDACTED]")
        if job.proxy:
            message = message.replace(job.proxy, "[PROXY]")
            parsed_proxy = urlsplit(job.proxy)
            if parsed_proxy.password:
                message = message.replace(parsed_proxy.password, "[REDACTED]")
        return message or "SSO 检测执行失败"

    @staticmethod
    def _clear_credentials(credentials: list[SsoCredential]) -> None:
        for index in range(len(credentials)):
            credentials[index] = SsoCredential(token="")
        credentials.clear()

    @classmethod
    def _clear_job(cls, job: SsoReportJob) -> None:
        cls._clear_credentials(job.credentials)
        job.proxy = ""

    @staticmethod
    def _summary(results: list[dict[str, Any]]) -> dict[str, Any]:
        verdicts = Counter(str(item.get("verdict", "error")) for item in results)
        bot_sources = Counter(
            str(source) if source is not None else "unknown"
            for item in results
            for source in [(item.get("bot_flag") or {}).get("source")]
        )
        regions = Counter(
            str((item.get("account") or {}).get("region_code") or "unknown")
            for item in results
        )
        total = len(results)
        valid = sum(bool(item.get("valid_session")) for item in results)
        clean = sum(item.get("verdict") == "clean" for item in results)
        flagged = sum(
            str(item.get("verdict", "")).startswith("flagged") for item in results
        )
        mismatched = sum(item.get("email_match") is False for item in results)
        errors = sum(item.get("verdict") == "error" for item in results)
        invalid = sum(item.get("verdict") == "invalid_or_unknown" for item in results)
        response_values = sorted(int(item.get("response_ms", 0)) for item in results)
        median_ms = response_values[len(response_values) // 2] if response_values else 0
        return {
            "total": total,
            "valid": valid,
            "clean": clean,
            "flagged": flagged,
            "mismatched": mismatched,
            "invalid": max(0, invalid),
            "errors": errors,
            "valid_rate": round(valid * 100 / total, 2) if total else 0,
            "flagged_rate": round(flagged * 100 / valid, 2) if valid else 0,
            "verdict_distribution": dict(sorted(verdicts.items())),
            "bot_flag_distribution": dict(sorted(bot_sources.items())),
            "region_distribution": dict(sorted(regions.items())),
            "median_response_ms": median_ms,
        }
