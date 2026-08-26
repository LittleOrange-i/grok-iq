from __future__ import annotations

import asyncio
import logging
import time
from collections import Counter
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from app.core.clock import app_now
from app.core.config import Settings
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
AccountActionHandler = Callable[[int, dict[str, Any]], Awaitable[dict[str, Any]]]


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
        settings: Settings | None = None,
    ) -> None:
        self.repository = repository
        self.register_events = register_events
        self.settings = settings
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
        self._account_action_handler: AccountActionHandler | None = None
        self._action_retry_tasks: set[asyncio.Task[None]] = set()
        self._action_retry_keys: set[tuple[str, int]] = set()

    def set_account_action_handler(self, handler: AccountActionHandler | None) -> None:
        """Attach account actions after the service graph has been constructed."""

        self._account_action_handler = handler

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        interrupted = self.repository.fail_interrupted()
        if interrupted:
            logger.info("marked interrupted SSO reports failed count=%s", interrupted)
        self._task = asyncio.create_task(self._worker(), name="sso-report-worker")
        handler = self._account_action_handler
        if handler is not None:
            for pending in self.repository.pending_account_actions():
                self._schedule_account_action_retry(
                    handler,
                    account_id=int(pending["account_id"]),
                    report_id=str(pending["report_id"]),
                    detail=dict(pending["detail"]),
                )

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task is None:
            tasks = list(self._action_retry_tasks)
        else:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            tasks = list(self._action_retry_tasks)
        for retry_task in tasks:
            retry_task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._action_retry_tasks.clear()
        self._action_retry_keys.clear()
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

    def create_for_accounts(
        self,
        account_ids: list[int],
        *,
        name: str = "",
    ) -> dict[str, Any]:
        if self.register_events is None:
            raise RuntimeError("账号 SSO 存储尚未配置")
        # Bulk/manual reports may still run directly when no proxy is set.
        raw_proxy = self._effective_proxy("")
        try:
            normalized_proxy = normalize_proxy(raw_proxy)
        except Exception as exc:
            raise ValueError(
                self._redact_message(str(exc), proxy=raw_proxy)
            ) from exc
        normalized = list(
            dict.fromkeys(int(value) for value in account_ids if int(value) > 0)
        )
        stored = self.register_events.sso_for_accounts(normalized)
        credentials: list[SsoCredential] = []
        included_account_ids: set[int] = set()
        for account_id in normalized:
            item = stored.get(account_id)
            if item is None:
                continue
            parsed = SsoCredentialLoader.load(str(item.get("sso") or ""))
            if not parsed:
                continue
            email = str(item.get("email") or "")
            credentials.append(
                SsoCredential(
                    token=parsed[0].token,
                    expected_email=email or parsed[0].expected_email,
                    label=email or parsed[0].label or f"账号 {account_id}",
                    account_id=account_id,
                )
            )
            included_account_ids.add(account_id)
        missing_account_ids = [
            account_id
            for account_id in normalized
            if account_id not in included_account_ids
        ]
        if not credentials:
            raise ValueError("已选账号均没有可用 SSO")
        report = self._create_with_credentials(
            name.strip()
            or app_now().strftime("账号 SSO 检测 · %Y-%m-%d %H:%M"),
            credentials,
            normalized_proxy,
            concurrency=8,
            request_timeout_seconds=20,
        )
        return {
            **report,
            "requested": len(normalized),
            "included": len(credentials),
            "missingAccountIds": missing_account_ids,
        }

    async def check_account_once(
        self,
        account_id: int,
        *,
        require_proxy: bool = True,
    ) -> dict[str, Any]:
        """Inspect one stored account SSO without persisting any credential."""

        normalized_account_id = int(account_id)
        base: dict[str, Any] = {
            "accountId": normalized_account_id,
            "status": "check_failed",
            "proxyUsed": False,
            "error": "",
            "result": {},
        }
        if normalized_account_id <= 0:
            return {**base, "error": "账号 ID 无效"}
        if self.register_events is None:
            return {
                **base,
                "status": "missing_sso",
                "error": "账号 SSO 存储尚未配置",
            }

        raw_proxy = self._effective_proxy("")
        if require_proxy and not raw_proxy.strip():
            return {
                **base,
                "status": "proxy_required",
                "error": "停用前复检要求配置 SSO 代理",
            }
        try:
            proxy = normalize_proxy(raw_proxy)
        except Exception as exc:
            return {
                **base,
                "status": "proxy_required",
                "error": self._redact_message(str(exc), proxy=raw_proxy),
            }
        if require_proxy and not proxy:
            return {
                **base,
                "status": "proxy_required",
                "error": "停用前复检要求配置有效的 SSO 代理",
            }

        stored = self.register_events.sso_for_accounts([normalized_account_id])
        item = stored.get(normalized_account_id)
        if item is None:
            return {
                **base,
                "status": "missing_sso",
                "error": "账号没有已保存的 SSO",
            }
        credentials = SsoCredentialLoader.load(str(item.get("sso") or ""))
        if not credentials:
            return {
                **base,
                "status": "missing_sso",
                "error": "账号已保存的 SSO 为空或格式无效",
            }

        parsed = credentials[0]
        credential = SsoCredential(
            token=parsed.token,
            expected_email=str(item.get("email") or parsed.expected_email or ""),
            label=str(item.get("email") or parsed.label or f"账号 {account_id}"),
            account_id=normalized_account_id,
        )
        credentials[0] = credential
        try:
            checker = self.checker_factory(proxy, 1, 20)
            result = await asyncio.to_thread(checker.check, credential)
            return {
                **base,
                "status": "completed",
                "proxyUsed": bool(proxy),
                "result": self._single_check_result(result),
            }
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            return {
                **base,
                "status": "check_failed",
                "proxyUsed": bool(proxy),
                "error": self._redact_message(
                    str(exc),
                    token=credential.token,
                    proxy=proxy,
                ),
            }
        finally:
            self._clear_credentials(credentials)

    @staticmethod
    def _single_check_result(value: Any) -> dict[str, Any]:
        result = value if isinstance(value, dict) else {}
        bot_flag = result.get("bot_flag")
        if not isinstance(bot_flag, dict):
            bot_flag = {}
        return {
            "account_id": (
                int(result.get("account_id"))
                if isinstance(result.get("account_id"), int)
                else None
            ),
            "checked_at": str(result.get("checked_at") or ""),
            "status_code": int(result.get("status_code") or 0),
            "response_ms": int(result.get("response_ms") or 0),
            "valid_session": bool(result.get("valid_session")),
            "email_match": (
                result.get("email_match")
                if isinstance(result.get("email_match"), bool)
                else None
            ),
            "verdict": str(result.get("verdict") or "error"),
            "bot_flag": {
                "found": bool(bot_flag.get("found")),
                "source": bot_flag.get("source"),
                "details": str(bot_flag.get("details") or ""),
                "policy": str(bot_flag.get("policy") or ""),
                "risk": bot_flag.get("risk"),
                "event": str(bot_flag.get("event") or ""),
                "denied": bool(bot_flag.get("denied")),
                "flagged": bool(bot_flag.get("flagged")),
            },
            "error": str(result.get("error") or ""),
        }

    @staticmethod
    def _redact_message(
        message: str,
        *,
        token: str = "",
        proxy: str = "",
    ) -> str:
        value = str(message or "")[:1000]
        if token:
            value = value.replace(token, "[REDACTED]")
        if proxy:
            value = value.replace(proxy, "[PROXY]")
            try:
                password = urlsplit(proxy).password
            except ValueError:
                password = ""
            if password:
                value = value.replace(password, "[REDACTED]")
        return value or "SSO 检测执行失败"

    def _create_with_credentials(
        self,
        name: str,
        credentials: list[SsoCredential],
        proxy: str,
        *,
        concurrency: int,
        request_timeout_seconds: int,
        require_proxy: bool = False,
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

        normalized_proxy = normalize_proxy(self._effective_proxy(proxy))
        if require_proxy and not normalized_proxy:
            self._clear_credentials(credentials)
            raise ValueError("账号关联 SSO 检测必须先配置有效代理")
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

    def _effective_proxy(self, proxy: str) -> str:
        explicit = (proxy or "").strip()
        if explicit:
            return explicit
        if self.settings is None:
            return ""
        return (self.settings.sso_proxy or "").strip()

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
        loop = asyncio.get_running_loop()
        action_futures: list[Any] = []
        scheduled_action_accounts: set[int] = set()

        def progress(completed: int, total: int, result: dict[str, Any]) -> None:
            nonlocal last_saved_count, last_saved_at
            if isinstance(result, dict):
                try:
                    account_id = int(result.get("account_id") or 0)
                except (TypeError, ValueError):
                    account_id = 0
                if (
                    account_id > 0
                    and account_id not in scheduled_action_accounts
                    and self._actionable_account_result(result)
                ):
                    scheduled_action_accounts.add(account_id)
                    action_futures.append(
                        asyncio.run_coroutine_threadsafe(
                            self._apply_account_actions(
                                [result],
                                report_id=job.report_id,
                                proxy_used=bool(job.proxy),
                            ),
                            loop,
                        )
                    )
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
            if action_futures:
                await asyncio.gather(
                    *(asyncio.wrap_future(future) for future in action_futures),
                    return_exceptions=True,
                )
            await self._apply_account_actions(
                results,
                report_id=job.report_id,
                proxy_used=bool(job.proxy),
            )
            results = self.repository.merge_account_actions(job.report_id, results)
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

    async def _apply_account_actions(
        self,
        results: list[dict[str, Any]],
        *,
        report_id: str,
        proxy_used: bool,
    ) -> None:
        """Stop account-linked results immediately when SSO reports a bot flag."""

        handler = self._account_action_handler
        if handler is None:
            return
        for result in results:
            if not isinstance(result, dict):
                continue
            if isinstance(result.get("account_action"), dict):
                continue
            if not self._actionable_account_result(result):
                continue
            bot_flag = result.get("bot_flag") or {}
            try:
                account_id = int(result.get("account_id") or 0)
            except (TypeError, ValueError):
                account_id = 0
            if account_id <= 0:
                continue
            try:
                action = await handler(
                    account_id,
                    {
                        "reportId": report_id,
                        "ssoVerdict": str(result.get("verdict") or "flagged"),
                        "botFlag": bot_flag,
                        "checkedAt": str(result.get("checked_at") or ""),
                        "proxyUsed": proxy_used,
                    },
                )
                result["account_action"] = {
                    "status": str(action.get("actionStatus") or "action_failed"),
                    "error": str(action.get("actionError") or ""),
                }
                self.repository.record_account_result(report_id, result)
                if result["account_action"]["status"] in {
                    "task_protected",
                    "action_failed",
                }:
                    self._schedule_account_action_retry(
                        handler,
                        account_id=account_id,
                        report_id=report_id,
                        detail={
                            "reportId": report_id,
                            "ssoVerdict": str(result.get("verdict") or "flagged"),
                            "botFlag": bot_flag,
                            "checkedAt": str(result.get("checked_at") or ""),
                            "proxyUsed": proxy_used,
                        },
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception(
                    "SSO report account action failed report=%s account=%s",
                    report_id,
                    account_id,
                )
                result["account_action"] = {
                    "status": "action_failed",
                    "error": str(exc)[:1000],
                }
                self.repository.record_account_result(report_id, result)
                self._schedule_account_action_retry(
                    handler,
                    account_id=account_id,
                    report_id=report_id,
                    detail={
                        "reportId": report_id,
                        "ssoVerdict": str(result.get("verdict") or "flagged"),
                        "botFlag": bot_flag,
                        "checkedAt": str(result.get("checked_at") or ""),
                        "proxyUsed": proxy_used,
                    },
                )

    @staticmethod
    def _actionable_account_result(result: dict[str, Any]) -> bool:
        bot_flag = result.get("bot_flag")
        return bool(
            isinstance(bot_flag, dict)
            and bot_flag.get("flagged")
            and result.get("valid_session") is True
            and result.get("email_match") is True
        )

    def _schedule_account_action_retry(
        self,
        handler: AccountActionHandler,
        *,
        account_id: int,
        report_id: str,
        detail: dict[str, Any],
    ) -> None:
        key = (report_id, account_id)
        if key in self._action_retry_keys:
            return
        task = asyncio.create_task(
            self._retry_account_action(
                handler,
                account_id=account_id,
                report_id=report_id,
                detail=detail,
            ),
            name=f"sso-account-action-retry-{report_id}-{account_id}",
        )
        self._action_retry_keys.add(key)
        self._action_retry_tasks.add(task)

        def discard(done: asyncio.Task[None]) -> None:
            self._action_retry_tasks.discard(done)
            self._action_retry_keys.discard(key)

        task.add_done_callback(discard)

    async def _retry_account_action(
        self,
        handler: AccountActionHandler,
        *,
        account_id: int,
        report_id: str,
        detail: dict[str, Any],
    ) -> None:
        """Retry a protected flagged-account stop after probe cleanup releases it."""

        for _attempt in range(60):
            await asyncio.sleep(10)
            try:
                action = await handler(account_id, detail)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "SSO report delayed account action failed report=%s account=%s",
                    report_id,
                    account_id,
                )
                continue
            if str(action.get("actionStatus") or "") != "task_protected":
                for _persist_attempt in range(300):
                    if self.repository.update_account_action(
                        report_id,
                        account_id=account_id,
                        status=str(action.get("actionStatus") or "action_failed"),
                        error=str(action.get("actionError") or ""),
                    ):
                        logger.info(
                            "SSO report delayed account action completed report=%s account=%s status=%s",
                            report_id,
                            account_id,
                            action.get("actionStatus"),
                        )
                        return
                    await asyncio.sleep(2)
                return
        logger.error(
            "SSO report account action remained task-protected report=%s account=%s",
            report_id,
            account_id,
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
