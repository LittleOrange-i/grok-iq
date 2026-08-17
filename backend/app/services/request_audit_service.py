from __future__ import annotations

import asyncio
import hashlib
import math
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from app.core.clock import APP_TIMEZONE, app_now, ensure_utc, to_app_timezone, utc_now
from app.core.config import Settings
from app.integrations.grok2api.client import Grok2APIClient
from app.persistence.account_repository import AccountRepository
from app.persistence.probe_repository import ProbeRepository
from app.persistence.request_audit_repository import RequestAuditRepository

REQUEST_AUDIT_SCOPE = "grok_build_today"
REQUEST_AUDIT_PAGE_SIZE = 500
# Keep one scheduler/manual execution bounded to 100k upstream rows. The
# durable cursor resumes larger first-day imports or traffic bursts later.
REQUEST_AUDIT_MAX_PAGES = 200
# Kept for API compatibility; adaptive scheduling is the default and exposes
# its actual busy/normal/idle intervals in status payloads.
REQUEST_AUDIT_SCAN_CRON = "*/5 * * * *"
REQUEST_AUDIT_WINDOW_PRESETS = frozenset({"today", "6h", "24h", "7d", "30d"})
REQUEST_AUDIT_ACTIVITY_MINUTES = 5
REQUEST_AUDIT_ACCOUNT_CACHE_SECONDS = 120


def _finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _positive_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if number > 0 else None


def _nonnegative_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if number >= 0 else None


def _int_or_zero(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError, OverflowError):
        return 0


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return ensure_utc(value)
    if value is None or str(value).strip() == "":
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError, OverflowError):
        return None
    return ensure_utc(parsed)


def _day_bounds(day_key: str) -> tuple[datetime, datetime]:
    value = date.fromisoformat(day_key)
    start = datetime.combine(value, time.min, tzinfo=APP_TIMEZONE).astimezone(UTC)
    end = (
        datetime.combine(value, time.min, tzinfo=APP_TIMEZONE) + timedelta(days=1)
    ).astimezone(UTC)
    return start, end


def current_day_key() -> str:
    return app_now().date().isoformat()


def _record_day_key(value: datetime) -> str:
    converted = to_app_timezone(value)
    return (converted or value).date().isoformat()


def calculate_audit_tps(item: dict[str, Any]) -> float | None:
    """Match grok2api's outputTokensPerSecond calculation.

    The upstream value is authoritative when present.  The fallback mirrors
    the source implementation: output tokens divided by generation time
    (duration minus first-token latency), in seconds.
    """

    if not bool(item.get("streaming")):
        return None
    status = _int_or_zero(item.get("statusCode"))
    if status < 200 or status >= 300 or str(item.get("errorCode") or ""):
        return None
    output_tokens = _positive_int(item.get("outputTokens"))
    first_token_ms = _nonnegative_int(item.get("firstTokenMs"))
    duration_ms = _nonnegative_int(item.get("durationMs"))
    if not output_tokens or first_token_ms is None or duration_ms is None:
        return None
    generation_ms = duration_ms - first_token_ms
    if generation_ms <= 0:
        return None
    direct = _finite_float(item.get("outputTokensPerSecond"))
    if direct is not None:
        return max(0.0, direct)
    return output_tokens * 1000.0 / generation_ms


def classify_audit_tps(
    tps: float | None,
    soft_threshold: float,
    hard_threshold: float,
) -> tuple[str, list[str]]:
    if tps is None or tps <= 0:
        return "normal", []
    if tps >= hard_threshold:
        return "high", [f"TPS ≥ {hard_threshold:g}"]
    if tps >= soft_threshold:
        return "watch", [f"TPS ≥ {soft_threshold:g}"]
    return "normal", []


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        converted = to_app_timezone(value)
        return converted.isoformat() if converted else None
    if value is None:
        return None
    return str(value)


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = (len(ordered) - 1) * 0.95
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


class RequestAuditService:
    """Projects grok_build audit windows and scores throughput by account/node."""

    def __init__(
        self,
        *,
        settings: Settings,
        client: Grok2APIClient,
        repository: RequestAuditRepository,
        accounts: AccountRepository | None = None,
        probes: ProbeRepository | None = None,
    ):
        self.settings = settings
        self.client = client
        self.repository = repository
        self.accounts = accounts
        self.probes = probes
        self._scan_lock = asyncio.Lock()
        self._egress_cache_lock = asyncio.Lock()
        self._account_cache_lock = asyncio.Lock()
        self._egress_cache: dict[int, dict[str, Any]] = {}
        self._egress_cache_at = 0.0
        self._account_cache: dict[int, dict[str, Any]] = {}
        self._account_cache_known_ids: set[int] = set()
        self._account_cache_at = 0.0
        self._account_cache_checked_at: datetime | None = None

    @property
    def thresholds(self) -> dict[str, float]:
        return {
            "watch": float(self.settings.degradation_tps),
            "high": float(self.settings.strong_degradation_tps),
        }

    async def scan_scheduled(self) -> dict[str, Any]:
        return await self.scan(trigger="scheduled", window_preset="today")

    def resolve_window(
        self,
        *,
        window_preset: str = "today",
        start_at: Any = None,
        end_at: Any = None,
    ) -> dict[str, Any]:
        preset = str(window_preset or "today").strip().lower()
        if preset not in REQUEST_AUDIT_WINDOW_PRESETS | {"custom"}:
            raise ValueError("请求审计时间窗口无效")
        now = utc_now()
        explicit = start_at is not None or end_at is not None
        if explicit:
            start = _parse_datetime(start_at)
            end = _parse_datetime(end_at)
            if start is None or end is None:
                raise ValueError("自定义时间窗口需要完整的开始和结束时间")
            preset = "custom"
        elif preset == "today":
            start, end = _day_bounds(current_day_key())
        elif preset == "6h":
            start, end = now - timedelta(hours=6), now
        elif preset == "24h":
            start, end = now - timedelta(hours=24), now
        elif preset == "7d":
            start, end = now - timedelta(days=7), now
        elif preset == "30d":
            start, end = now - timedelta(days=30), now
        else:
            raise ValueError("自定义时间窗口需要完整的开始和结束时间")

        if start >= end:
            raise ValueError("请求审计开始时间必须早于结束时间")
        if end - start > timedelta(days=90, minutes=1):
            raise ValueError("单次请求审计时间窗口不能超过 90 天")
        if start < now - timedelta(days=90, minutes=1):
            raise ValueError("请求审计仅支持最近 90 天")
        if end > now + timedelta(days=1):
            raise ValueError("请求审计结束时间超出允许范围")

        today_start, today_end = _day_bounds(current_day_key())
        is_today = start == today_start and end == today_end
        labels = {
            "today": "当天",
            "6h": "最近 6 小时",
            "24h": "最近 24 小时",
            "7d": "最近 7 天",
            "30d": "最近 30 天",
            "custom": "自定义窗口",
        }
        return {
            "preset": "today" if is_today else preset,
            "label": labels["today" if is_today else preset],
            "start": start,
            "end": end,
            "is_today": is_today,
        }

    async def scan(
        self,
        *,
        trigger: str = "manual",
        window_preset: str = "today",
        start_at: Any = None,
        end_at: Any = None,
    ) -> dict[str, Any]:
        window = self.resolve_window(
            window_preset=window_preset,
            start_at=start_at,
            end_at=end_at,
        )
        async with self._scan_lock:
            return await self._scan_locked(trigger=trigger, window=window)

    @staticmethod
    def _window_scope(window: dict[str, Any]) -> tuple[str, str]:
        if window["is_today"]:
            return REQUEST_AUDIT_SCOPE, current_day_key()
        preset = str(window["preset"])
        if preset in REQUEST_AUDIT_WINDOW_PRESETS:
            return f"grok_build_{preset}", preset
        raw = f"{window['start'].isoformat()}|{window['end'].isoformat()}"
        digest = hashlib.sha256(raw.encode()).hexdigest()
        return f"grok_build_window:{digest[:24]}", digest[:16]

    @staticmethod
    def _upstream_period(start: datetime) -> str:
        age = max(timedelta(0), utc_now() - start)
        if age <= timedelta(hours=24, minutes=1):
            return "24h"
        if age <= timedelta(days=7, minutes=1):
            return "7d"
        if age <= timedelta(days=30, minutes=1):
            return "30d"
        return "90d"

    def _skipped_scan(
        self,
        *,
        trigger: str,
        window: dict[str, Any],
        error: str,
        ok: bool = True,
    ) -> dict[str, Any]:
        return {
            "ok": ok,
            "skipped": True,
            "trigger": trigger,
            "day": current_day_key(),
            "window": self._window_payload(window),
            "error": error,
            "activity": {
                "level": "idle",
                "label": "闲时",
                "requests": 0,
                "requestsPerMinute": 0,
                "maxTps": 0,
                "sampleMinutes": REQUEST_AUDIT_ACTIVITY_MINUTES,
                "reasons": [error],
                "recommendedIntervalSeconds": (
                    self.settings.request_audit_idle_scan_interval_seconds
                ),
            },
            "recommendedIntervalSeconds": (
                self.settings.request_audit_idle_scan_interval_seconds
            ),
        }

    async def _scan_locked(
        self,
        *,
        trigger: str,
        window: dict[str, Any],
    ) -> dict[str, Any]:
        if not self.settings.request_audit_enabled:
            return self._skipped_scan(
                trigger=trigger,
                window=window,
                error="请求审计监控已停用",
            )
        if trigger == "scheduled" and not self.settings.request_audit_auto_scan_enabled:
            return self._skipped_scan(
                trigger=trigger,
                window=window,
                error="请求审计自动扫描已停用",
            )

        scope, identity = self._window_scope(window)
        state = self.repository.ensure_state(scope)
        if state.get("day_key") != identity:
            state = self.repository.reset_day(scope, identity)

        started_at = utc_now()
        if (
            not self.settings.grok2api_admin_username
            or not self.settings.grok2api_admin_password
        ):
            result = self._skipped_scan(
                trigger=trigger,
                window=window,
                error="grok2api 管理凭据尚未配置",
                ok=False,
            )
            self.repository.save_state(
                scope,
                {"last_scan_at": started_at, "last_error": result["error"]},
            )
            return result

        start = window["start"]
        end = window["end"]
        initial_complete = bool(state.get("initial_complete"))
        previous_boundary_id = (
            str(state.get("newest_upstream_id") or "") if initial_complete else ""
        )
        saved_initial_cursor = (
            str(state.get("initial_cursor") or "") if not initial_complete else ""
        )
        scan_head_id = (
            str(state.get("newest_upstream_id") or "") if not initial_complete else ""
        )
        scan_head_created_at = (
            ensure_utc(state.get("newest_created_at")) if not initial_complete else None
        )
        cursor = saved_initial_cursor
        mode = (
            "incremental"
            if initial_complete
            else "initial_resume"
            if saved_initial_cursor
            else "initial"
        )
        pages = 0
        inserted = 0
        seen_records = 0
        skipped_non_build = 0
        skipped_outside_day = 0
        reached_day_start = False
        reached_overlap = False
        has_more = False
        egress_error = ""
        egress_updated = 0
        try:
            try:
                egress_map = await self._egress_map()
            except Exception as exc:  # node labels are supplemental
                egress_map = self._egress_cache
                egress_error = str(exc)
            try:
                egress_updated = self.repository.refresh_egress_node_details(
                    start=start,
                    end=end,
                    nodes=egress_map,
                )
            except Exception as exc:  # legacy cleanup must not block scanning
                detail_error = str(exc)
                egress_error = (
                    f"{egress_error}；{detail_error}" if egress_error else detail_error
                )

            while pages < REQUEST_AUDIT_MAX_PAGES:
                payload = await self.client.list_request_audits(
                    cursor=cursor,
                    page_size=REQUEST_AUDIT_PAGE_SIZE,
                    period=self._upstream_period(start),
                )
                items = payload.get("items", [])
                if not isinstance(items, list) or not items:
                    has_more = False
                    break
                pages += 1
                next_cursor = str(payload.get("nextCursor") or "")
                has_more = bool(payload.get("hasMore")) and bool(next_cursor)
                if not scan_head_id:
                    for head_item in items:
                        if not isinstance(head_item, dict):
                            continue
                        candidate_id = str(
                            head_item.get("id") or head_item.get("requestId") or ""
                        ).strip()
                        if candidate_id:
                            scan_head_id = candidate_id
                            scan_head_created_at = _parse_datetime(
                                head_item.get("createdAt")
                            )
                            break
                ids = [
                    str(item.get("id") or item.get("requestId") or "")
                    for item in items
                    if isinstance(item, dict)
                ]
                existing_ids = self.repository.existing_ids(ids)
                page_has_overlap = False
                page_records: list[dict[str, Any]] = []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    upstream_id = str(
                        item.get("id") or item.get("requestId") or ""
                    ).strip()
                    if (
                        initial_complete
                        and previous_boundary_id
                        and upstream_id == previous_boundary_id
                    ):
                        page_has_overlap = True
                        break
                    created_at = _parse_datetime(item.get("createdAt"))
                    if created_at is not None and created_at < start:
                        skipped_outside_day += 1
                        reached_day_start = True
                        break
                    if created_at is None or created_at >= end:
                        skipped_outside_day += 1
                        continue
                    if str(item.get("provider") or "") != "grok_build":
                        skipped_non_build += 1
                        continue
                    seen_records += 1
                    if not upstream_id:
                        continue
                    if upstream_id in existing_ids:
                        # Rows committed by a failed incremental attempt may
                        # sit ahead of the last durable upstream boundary. Keep
                        # paging until that boundary; only legacy states without
                        # one use a known local row as the stopping point.
                        if initial_complete and not previous_boundary_id:
                            page_has_overlap = True
                            break
                        continue
                    normalized = self._normalize_record(
                        item,
                        upstream_id,
                        _record_day_key(created_at),
                        created_at,
                        egress_map,
                    )
                    if normalized is not None:
                        page_records.append(normalized)

                # Commit each page before advancing a durable catch-up cursor.
                # A process interruption can therefore only replay the page;
                # it cannot create a gap in the local projection.
                inserted += self.repository.upsert_records(page_records)

                # Results are ordered newest-first by grok2api. The prior
                # upstream head is the durable overlap boundary; all older
                # pages were covered by the preceding successful scan.
                if page_has_overlap and initial_complete:
                    reached_overlap = True
                    break
                if reached_day_start:
                    break
                if not has_more:
                    break
                if next_cursor == cursor:
                    raise RuntimeError("grok2api 请求审计游标未推进")
                cursor = next_cursor
                if not initial_complete:
                    self.repository.save_state(
                        scope,
                        {
                            "day_key": identity,
                            "newest_upstream_id": scan_head_id,
                            "newest_created_at": scan_head_created_at,
                            "initial_cursor": cursor,
                        },
                    )

            all_records = self.repository.records_for_range(start, end)
            complete = bool(reached_day_start or not has_more or reached_overlap)
            boundary_id = scan_head_id or previous_boundary_id
            boundary_created_at = (
                scan_head_created_at if scan_head_id else state.get("newest_created_at")
            )
            state_values = {
                "day_key": identity,
                "newest_upstream_id": boundary_id,
                "newest_created_at": boundary_created_at,
                "initial_cursor": "" if complete else cursor,
                "initial_complete": complete,
                "last_scan_at": started_at,
                "last_success_at": utc_now(),
                "last_error": "",
                "last_pages": pages,
                "last_new_records": inserted,
                "last_seen_records": seen_records,
            }
            saved_state = self.repository.save_state(scope, state_values)
            self.repository.delete_older_than(
                self.repository.retention_cutoff(
                    self.settings.request_audit_retention_days
                )
            )
            activity = self._activity_payload(
                pages=pages,
                initial_complete=complete,
            )
            summary = self._summary_payload(window, all_records)
            return {
                "ok": True,
                "trigger": trigger,
                "day": current_day_key(),
                "window": self._window_payload(window),
                "mode": mode,
                "pages": pages,
                "newRecords": inserted,
                "seenRecords": seen_records,
                "skippedNonBuild": skipped_non_build,
                "skippedOutsideDay": skipped_outside_day,
                "skippedOutsideWindow": skipped_outside_day,
                "reachedOverlap": reached_overlap,
                "egressUpdated": egress_updated,
                "egressWarning": egress_error,
                "state": self._state_payload(saved_state, window=window),
                "activity": activity,
                "recommendedIntervalSeconds": activity["recommendedIntervalSeconds"],
                "summary": summary,
            }
        except Exception as exc:
            error = str(exc)
            state_error = error
            state_values: dict[str, Any] = {
                "day_key": identity,
                "last_scan_at": started_at,
                "last_error": state_error,
                "last_pages": pages,
                "last_new_records": inserted,
                "last_seen_records": seen_records,
            }
            if (
                not initial_complete
                and getattr(exc, "error_code", "") == "invalidCursor"
            ):
                state_error = f"{error}；首次扫描游标已重置"
                state_values["initial_cursor"] = ""
                state_values["last_error"] = state_error
            self.repository.save_state(scope, state_values)
            activity = self._activity_payload(
                pages=pages,
                initial_complete=False,
                scan_failed=True,
            )
            return {
                "ok": False,
                "trigger": trigger,
                "day": current_day_key(),
                "window": self._window_payload(window),
                "mode": mode,
                "pages": pages,
                "newRecords": inserted,
                "error": state_error,
                "activity": activity,
                "recommendedIntervalSeconds": activity["recommendedIntervalSeconds"],
            }

    @staticmethod
    def _window_payload(window: dict[str, Any]) -> dict[str, Any]:
        return {
            "preset": str(window["preset"]),
            "label": str(window["label"]),
            "startAt": _iso(window["start"]),
            "endAt": _iso(window["end"]),
            "isToday": bool(window["is_today"]),
        }

    def _activity_payload(
        self,
        *,
        pages: int = 0,
        initial_complete: bool = True,
        scan_failed: bool = False,
    ) -> dict[str, Any]:
        sample_end = utc_now() + timedelta(seconds=1)
        sample_start = sample_end - timedelta(minutes=REQUEST_AUDIT_ACTIVITY_MINUTES)
        recent = self.repository.records_for_range(sample_start, sample_end)
        measured = [
            float(row["tps"])
            for row in recent
            if _finite_float(row.get("tps")) is not None
            and float(row.get("tps") or 0) > 0
        ]
        requests = len(recent)
        request_rate = requests / REQUEST_AUDIT_ACTIVITY_MINUTES
        max_tps = max(measured, default=0.0)
        reasons: list[str] = []

        if scan_failed:
            level = "normal"
            reasons.append("上次扫描异常，按常态间隔重试")
        elif not initial_complete or pages > 1:
            level = "busy"
            reasons.append("审计分页仍有积压")
        elif request_rate >= self.settings.request_audit_busy_requests_per_minute:
            level = "busy"
            reasons.append(f"最近请求速率 {request_rate:.1f}/分钟达到忙时阈值")
        elif (
            self.settings.request_audit_risk_enabled
            and max_tps >= self.settings.degradation_tps
        ):
            level = "busy"
            reasons.append(f"最近出现 {max_tps:.1f} Token/s 风险请求")
        elif requests > 0:
            level = "normal"
            reasons.append("最近窗口仍有请求活动")
        else:
            level = "idle"
            reasons.append("最近窗口没有新的 grok_build 请求")

        interval_by_level = {
            "busy": self.settings.request_audit_busy_scan_interval_seconds,
            "normal": self.settings.request_audit_normal_scan_interval_seconds,
            "idle": self.settings.request_audit_idle_scan_interval_seconds,
        }
        recommended = (
            interval_by_level[level]
            if self.settings.request_audit_adaptive_scan_enabled
            else self.settings.request_audit_scan_interval_minutes * 60
        )
        return {
            "level": level,
            "label": {"busy": "忙时", "normal": "常态", "idle": "闲时"}[level],
            "requests": requests,
            "requestsPerMinute": round(request_rate, 1),
            "maxTps": round(max_tps, 1),
            "sampleMinutes": REQUEST_AUDIT_ACTIVITY_MINUTES,
            "reasons": reasons,
            "recommendedIntervalSeconds": int(recommended),
        }

    @staticmethod
    def _record_account_ids(records: list[dict[str, Any]]) -> set[int]:
        return {
            int(row["account_id"])
            for row in records
            if _positive_int(row.get("account_id")) is not None
        }

    def _cached_account_map(
        self,
        account_ids: set[int],
    ) -> dict[int, dict[str, Any]]:
        return {
            account_id: self._account_cache[account_id]
            for account_id in account_ids
            if account_id in self._account_cache
        }

    async def _upstream_account_map(
        self,
        account_ids: set[int],
    ) -> dict[int, dict[str, Any]]:
        requested_ids = {account_id for account_id in account_ids if account_id > 0}
        if not requested_ids:
            return {}
        now = asyncio.get_running_loop().time()
        fresh = (
            self._account_cache_at > 0
            and now - self._account_cache_at < REQUEST_AUDIT_ACCOUNT_CACHE_SECONDS
        )
        if fresh and requested_ids.issubset(self._account_cache_known_ids):
            return self._cached_account_map(requested_ids)

        async with self._account_cache_lock:
            now = asyncio.get_running_loop().time()
            fresh = (
                self._account_cache_at > 0
                and now - self._account_cache_at < REQUEST_AUDIT_ACCOUNT_CACHE_SECONDS
            )
            if not fresh:
                self._account_cache = {}
                self._account_cache_known_ids = set()
                self._account_cache_checked_at = None
            missing_ids = requested_ids - self._account_cache_known_ids
            if not missing_ids:
                return self._cached_account_map(requested_ids)
            try:
                values = (
                    await self.client.get_accounts_by_ids(missing_ids)
                    if len(missing_ids) <= 50
                    else await self.client.list_all_accounts(missing_ids)
                )
            except Exception:
                # Cache the failed lookup briefly so simultaneous table and
                # summary refreshes do not fan out duplicate upstream calls.
                self._account_cache_known_ids.update(missing_ids)
                self._account_cache_at = now
                raise
            for value in values:
                account_id = _positive_int(value.get("id"))
                if account_id is not None:
                    self._account_cache[account_id] = value
            self._account_cache_known_ids.update(missing_ids)
            self._account_cache_at = now
            self._account_cache_checked_at = utc_now()
            return self._cached_account_map(requested_ids)

    async def _egress_map(self) -> dict[int, dict[str, Any]]:
        now = asyncio.get_running_loop().time()
        if self._egress_cache_at > 0 and now - self._egress_cache_at < 240:
            return self._egress_cache
        async with self._egress_cache_lock:
            now = asyncio.get_running_loop().time()
            if self._egress_cache_at > 0 and now - self._egress_cache_at < 240:
                return self._egress_cache
            result: dict[int, dict[str, Any]] = {}
            page = 1
            while page <= 100:
                payload = await self.client.list_egress_nodes(
                    scope="grok_build", page=page, pageSize=500
                )
                items = payload.get("items", [])
                if not isinstance(items, list) or not items:
                    break
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    node_id = _positive_int(item.get("id"))
                    if node_id:
                        result[node_id] = item
                total = int(payload.get("total") or 0)
                size = int(payload.get("pageSize") or len(items) or 500)
                if (total > 0 and page * size >= total) or len(items) < size:
                    break
                page += 1
            self._egress_cache = result
            self._egress_cache_at = now
            return result

    def _normalize_record(
        self,
        item: dict[str, Any],
        upstream_id: str,
        day_key: str,
        created_at: datetime,
        egress_map: dict[int, dict[str, Any]],
    ) -> dict[str, Any]:
        egress_node_id = _positive_int(item.get("egressNodeId"))
        egress = egress_map.get(egress_node_id or 0, {})
        tps = calculate_audit_tps(item)
        risk_level, reasons = (
            classify_audit_tps(
                tps,
                self.settings.degradation_tps,
                self.settings.strong_degradation_tps,
            )
            if self.settings.request_audit_risk_enabled
            else ("normal", [])
        )
        raw_keys = (
            "id",
            "requestId",
            "provider",
            "operation",
            "modelPublicId",
            "modelUpstreamModel",
            "accountId",
            "accountName",
            "egressNodeId",
            "egressNodeName",
            "egressMode",
            "egressScope",
            "statusCode",
            "streaming",
            "inputTokens",
            "outputTokens",
            "reasoningTokens",
            "totalTokens",
            "firstTokenMs",
            "durationMs",
            "outputTokensPerSecond",
            "errorCode",
            "createdAt",
        )
        raw = {key: item.get(key) for key in raw_keys if key in item}
        return {
            "upstream_id": upstream_id,
            "request_id": str(item.get("requestId") or ""),
            "day_key": day_key,
            "provider": "grok_build",
            "operation": str(item.get("operation") or ""),
            "model_public_id": str(item.get("modelPublicId") or ""),
            "model_upstream_model": str(item.get("modelUpstreamModel") or ""),
            "account_id": _positive_int(item.get("accountId")),
            "account_name": str(item.get("accountName") or ""),
            "egress_node_id": egress_node_id,
            "egress_node_name": str(
                item.get("egressNodeName") or egress.get("name") or ""
            ),
            # Kept as an empty compatibility column. A node's current exitIp
            # is a probe snapshot, not the IP used by this historical request.
            "egress_ip": "",
            "egress_mode": str(item.get("egressMode") or ""),
            "egress_scope": str(item.get("egressScope") or ""),
            "status_code": _int_or_zero(item.get("statusCode")),
            "streaming": bool(item.get("streaming")),
            "input_tokens": _int_or_zero(item.get("inputTokens")),
            "output_tokens": _int_or_zero(item.get("outputTokens")),
            "reasoning_tokens": _int_or_zero(item.get("reasoningTokens")),
            "total_tokens": _int_or_zero(item.get("totalTokens")),
            "first_token_ms": _nonnegative_int(item.get("firstTokenMs")),
            "duration_ms": _int_or_zero(item.get("durationMs")),
            "tps": tps,
            "risk_level": risk_level,
            "risk_reasons": reasons,
            "raw": raw,
            "created_at": created_at,
            "fetched_at": utc_now(),
        }

    def _config_payload(self) -> dict[str, Any]:
        return {
            "enabled": self.settings.request_audit_enabled,
            "autoScanEnabled": self.settings.request_audit_auto_scan_enabled,
            "adaptiveScanEnabled": self.settings.request_audit_adaptive_scan_enabled,
            "fixedScanIntervalMinutes": self.settings.request_audit_scan_interval_minutes,
            "busyScanIntervalSeconds": self.settings.request_audit_busy_scan_interval_seconds,
            "normalScanIntervalSeconds": self.settings.request_audit_normal_scan_interval_seconds,
            "idleScanIntervalSeconds": self.settings.request_audit_idle_scan_interval_seconds,
            "busyRequestsPerMinute": self.settings.request_audit_busy_requests_per_minute,
            "liveRefreshEnabled": self.settings.request_audit_live_refresh_enabled,
            "liveRefreshSeconds": self.settings.request_audit_live_refresh_seconds,
            "riskEnabled": self.settings.request_audit_risk_enabled,
            "isolationEnabled": self.settings.request_audit_isolation_enabled,
            "retentionDays": self.settings.request_audit_retention_days,
        }

    def status(self) -> dict[str, Any]:
        day_key = current_day_key()
        window = self.resolve_window(window_preset="today")
        state = self.repository.ensure_state(REQUEST_AUDIT_SCOPE)
        if state.get("day_key") != day_key:
            state = self.repository.state_defaults(REQUEST_AUDIT_SCOPE)
            state["day_key"] = day_key
        available = self.repository.available_range()
        activity = self._activity_payload(
            pages=int(state.get("last_pages") or 0),
            initial_complete=bool(state.get("initial_complete")),
        )
        schedule_enabled = bool(
            self.settings.scheduler_enabled
            and self.settings.request_audit_enabled
            and self.settings.request_audit_auto_scan_enabled
        )
        return {
            "day": day_key,
            "provider": "grok_build",
            "thresholds": self.thresholds,
            "configured": bool(
                self.settings.grok2api_admin_username
                and self.settings.grok2api_admin_password
            ),
            "config": self._config_payload(),
            "scan": self._state_payload(state, window=window),
            "activity": activity,
            "localRecords": self.repository.count_for_range(
                window["start"], window["end"]
            ),
            "availableRange": {
                "startAt": _iso(available["start"]),
                "endAt": _iso(available["end"]),
                "records": available["records"],
            },
            "schedule": {
                "enabled": schedule_enabled,
                "adaptive": self.settings.request_audit_adaptive_scan_enabled,
                "fixedIntervalMinutes": self.settings.request_audit_scan_interval_minutes,
                "busyIntervalSeconds": self.settings.request_audit_busy_scan_interval_seconds,
                "normalIntervalSeconds": self.settings.request_audit_normal_scan_interval_seconds,
                "idleIntervalSeconds": self.settings.request_audit_idle_scan_interval_seconds,
            },
        }

    async def list_page(
        self,
        *,
        page: int,
        page_size: int,
        account: str = "",
        risk: str = "",
        egress_node_id: int | None = None,
        window_preset: str = "today",
        start_at: Any = None,
        end_at: Any = None,
    ) -> dict[str, Any]:
        window = self.resolve_window(
            window_preset=window_preset,
            start_at=start_at,
            end_at=end_at,
        )
        page_value = self.repository.list_records(
            start=window["start"],
            end=window["end"],
            page=page,
            page_size=page_size,
            account=account,
            risk=risk,
            egress_node_id=egress_node_id,
            watch_threshold=self.settings.degradation_tps,
            high_threshold=self.settings.strong_degradation_tps,
            risk_enabled=self.settings.request_audit_risk_enabled,
        )
        probe_map = self._probe_sample_map(page_value["items"])
        account_ids = self._record_account_ids(page_value["items"])
        try:
            upstream_accounts = await self._upstream_account_map(account_ids)
        except Exception:
            upstream_accounts = self._cached_account_map(account_ids)
        return {
            "day": current_day_key(),
            "provider": "grok_build",
            "window": self._window_payload(window),
            "upstreamAccountSnapshotAt": (
                _iso(self._account_cache_checked_at) if account_ids else None
            ),
            "items": [
                self._record_payload(
                    item,
                    probe_samples=self._probe_samples_for_record(item, probe_map),
                    upstream_account=upstream_accounts.get(int(item["account_id"]))
                    if item.get("account_id")
                    else None,
                )
                for item in page_value["items"]
            ],
            "total": page_value["total"],
            "page": page_value["page"],
            "pageSize": page_value["page_size"],
            "thresholds": self.thresholds,
        }

    @staticmethod
    def _record_lookup_keys(row: dict[str, Any]) -> tuple[str, ...]:
        keys: list[str] = []
        request_id = str(row.get("request_id") or "").strip()
        if request_id:
            keys.append(f"request:{request_id}")
        audit_id = _positive_int(row.get("upstream_id"))
        if audit_id is not None:
            keys.append(f"audit:{audit_id}")
        return tuple(keys)

    @classmethod
    def _probe_samples_for_record(
        cls,
        row: dict[str, Any],
        probe_map: dict[str, list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        seen: set[str] = set()
        for key in cls._record_lookup_keys(row):
            for context in probe_map.get(key, []):
                sample_id = str((context.get("sample") or {}).get("id") or "")
                if sample_id and sample_id in seen:
                    continue
                if sample_id:
                    seen.add(sample_id)
                values.append(context)
        return values

    def _probe_sample_map(
        self,
        records: list[dict[str, Any]],
        *,
        include_response: bool = False,
        ignore_errors: bool = True,
    ) -> dict[str, list[dict[str, Any]]]:
        if self.probes is None or not records:
            return {}
        request_ids = {
            str(row.get("request_id") or "").strip()
            for row in records
            if str(row.get("request_id") or "").strip()
        }
        audit_ids = {
            int(row["upstream_id"])
            for row in records
            if _positive_int(row.get("upstream_id")) is not None
        }
        try:
            contexts = self.probes.samples_for_audits(
                request_ids=request_ids,
                audit_ids=audit_ids,
                include_response=include_response,
            )
        except Exception:
            if ignore_errors:
                return {}
            raise
        result: dict[str, list[dict[str, Any]]] = defaultdict(list)
        seen: dict[str, set[str]] = defaultdict(set)
        for context in contexts:
            sample = context.get("sample") or {}
            sample_id = str(sample.get("id") or "")
            keys: list[str] = []
            request_id = str(sample.get("request_id") or "").strip()
            audit_id = _positive_int(sample.get("audit_id"))
            if request_id:
                keys.append(f"request:{request_id}")
            if audit_id is not None:
                keys.append(f"audit:{audit_id}")
            for key in keys:
                if sample_id and sample_id in seen[key]:
                    continue
                if sample_id:
                    seen[key].add(sample_id)
                result[key].append(context)
        return result

    def probe_context(
        self,
        *,
        request_id: str = "",
        audit_id: int | None = None,
    ) -> dict[str, Any]:
        contexts = self._probe_sample_map(
            [
                {
                    "request_id": request_id,
                    "upstream_id": str(audit_id or ""),
                }
            ],
            include_response=True,
            ignore_errors=False,
        )
        flattened: list[dict[str, Any]] = []
        seen: set[str] = set()
        for values in contexts.values():
            for value in values:
                sample_id = str((value.get("sample") or {}).get("id") or "")
                if sample_id and sample_id in seen:
                    continue
                if sample_id:
                    seen.add(sample_id)
                flattened.append(value)
        return {
            "requestId": request_id,
            "auditId": audit_id,
            "samples": flattened,
        }

    async def summary(
        self,
        *,
        window_preset: str = "today",
        start_at: Any = None,
        end_at: Any = None,
    ) -> dict[str, Any]:
        window = self.resolve_window(
            window_preset=window_preset,
            start_at=start_at,
            end_at=end_at,
        )
        records = self.repository.records_for_range(window["start"], window["end"])
        assessments = self._assessment_payloads(records)
        account_ids = self._record_account_ids(records)
        upstream_result, nodes_result = await asyncio.gather(
            self._upstream_account_map(account_ids),
            self._egress_map(),
            return_exceptions=True,
        )
        if isinstance(upstream_result, BaseException):
            upstream_accounts = self._cached_account_map(account_ids)
        else:
            upstream_accounts = upstream_result
        accounts = self._account_payloads(
            records,
            assessments=assessments,
            upstream_accounts=upstream_accounts,
        )
        if isinstance(nodes_result, BaseException):
            # Node metadata is supplemental. Retain the last good snapshot and
            # keep the local audit projection available if upstream is busy.
            nodes = self._egress_cache
        else:
            nodes = nodes_result
        scope, identity = self._window_scope(window)
        state = self.repository.ensure_state(scope)
        if state.get("day_key") != identity:
            state = self.repository.state_defaults(scope)
            state["day_key"] = identity
        return {
            "day": current_day_key(),
            "provider": "grok_build",
            "window": self._window_payload(window),
            "thresholds": self.thresholds,
            "upstreamAccountSnapshotAt": (
                _iso(self._account_cache_checked_at) if account_ids else None
            ),
            "summary": self._summary_payload(window, records, accounts),
            "accounts": accounts,
            "nodes": self._node_payloads(
                records,
                assessments=assessments,
                nodes=nodes,
                upstream_accounts=upstream_accounts,
            ),
            "trend": self._trend_payload(window, records),
            "scan": self._state_payload(state, window=window),
        }

    def _summary_payload(
        self,
        window: dict[str, Any],
        records: list[dict[str, Any]],
        account_values: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        measured = [
            float(row["tps"])
            for row in records
            if _finite_float(row.get("tps")) is not None
            and float(row.get("tps") or 0) > 0
        ]
        if account_values is None:
            account_values = self._account_payloads(records)
        watch = sum(
            1 for row in account_values if row["riskLevel"] in {"watch", "high"}
        )
        high = sum(1 for row in account_values if row["riskLevel"] == "high")
        return {
            "requests": len(records),
            "measuredRequests": len(measured),
            "outputTokens": sum(int(row.get("output_tokens") or 0) for row in records),
            "averageTps": round(sum(measured) / len(measured), 1) if measured else 0,
            "p95Tps": round(_p95(measured), 1),
            "maxTps": round(max(measured, default=0), 1),
            "watchAccounts": watch,
            "highRiskAccounts": high,
            "accountCount": len(account_values),
            "lastSeenAt": _iso(
                max(
                    (row.get("created_at") for row in records if row.get("created_at")),
                    default=None,
                )
            ),
            "day": current_day_key(),
            "window": self._window_payload(window),
        }

    def _assessment_payloads(
        self, records: list[dict[str, Any]]
    ) -> dict[int, dict[str, Any]]:
        account_ids = sorted(
            {
                int(row["account_id"])
                for row in records
                if row.get("account_id") is not None
            }
        )
        return (
            self.accounts.get_assessments(account_ids)
            if self.accounts is not None and account_ids
            else {}
        )

    def _account_payloads(
        self,
        records: list[dict[str, Any]],
        *,
        assessments: dict[int, dict[str, Any]] | None = None,
        upstream_accounts: dict[int, dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in records:
            account_id = row.get("account_id")
            key = (
                str(account_id)
                if account_id
                else f"unknown:{row.get('account_name') or 'unknown'}"
            )
            groups[key].append(row)
        if assessments is None:
            assessments = self._assessment_payloads(records)
        upstream_accounts = upstream_accounts or {}
        result = [
            self._account_payload(
                rows,
                assessment=(
                    assessments.get(int(rows[0]["account_id"]), {})
                    if rows[0].get("account_id")
                    else {}
                ),
                upstream_account=(
                    upstream_accounts.get(int(rows[0]["account_id"]), {})
                    if rows[0].get("account_id")
                    else {}
                ),
            )
            for rows in groups.values()
        ]
        rank = {"high": 2, "watch": 1, "normal": 0}
        result.sort(
            key=lambda row: (rank[row["riskLevel"]], row["maxTps"]), reverse=True
        )
        return result

    def _account_payload(
        self,
        rows: list[dict[str, Any]],
        *,
        assessment: dict[str, Any],
        upstream_account: dict[str, Any],
    ) -> dict[str, Any]:
        speeds = [
            float(row["tps"])
            for row in rows
            if _finite_float(row.get("tps")) is not None
            and float(row.get("tps") or 0) > 0
        ]
        max_tps = max(speeds, default=0.0)
        risk_level, _ = self._classify(max_tps)
        latest = max(
            rows,
            key=lambda row: (
                ensure_utc(row.get("created_at")) or datetime.min.replace(tzinfo=UTC)
            ),
        )
        account_id = int(rows[0]["account_id"]) if rows[0].get("account_id") else None
        monitor_status = str(assessment.get("monitor_status") or "")
        node_ids = sorted(
            {int(row["egress_node_id"]) for row in rows if row.get("egress_node_id")}
        )
        nodes = sorted(
            {
                str(row.get("egress_node_name") or row.get("egress_node_id") or "")
                for row in rows
                if str(row.get("egress_node_name") or row.get("egress_node_id") or "")
            }
        )
        watch_count = (
            sum(1 for value in speeds if value >= self.settings.degradation_tps)
            if self.settings.request_audit_risk_enabled
            else 0
        )
        high_count = (
            sum(1 for value in speeds if value >= self.settings.strong_degradation_tps)
            if self.settings.request_audit_risk_enabled
            else 0
        )
        return {
            "accountId": account_id,
            "accountName": str(latest.get("account_name") or ""),
            "requests": len(rows),
            "measuredRequests": len(speeds),
            "outputTokens": sum(int(row.get("output_tokens") or 0) for row in rows),
            "averageTps": round(sum(speeds) / len(speeds), 1) if speeds else 0,
            "p95Tps": round(_p95(speeds), 1),
            "maxTps": round(max_tps, 1),
            "latestTps": (
                round(float(latest.get("tps") or 0), 1) if latest.get("tps") else None
            ),
            "watchCount": watch_count,
            "highRiskCount": high_count,
            "riskLevel": risk_level,
            "riskReasons": self._risk_reasons(max_tps),
            "egressNodeIds": node_ids,
            "egressNodes": nodes,
            "monitorStatus": monitor_status,
            "quarantined": monitor_status == "quarantined",
            "quarantineUntil": _iso(assessment.get("quarantine_until")),
            "probeSampleCount": _int_or_zero(assessment.get("sample_count")),
            "probeAnomalyCount": _int_or_zero(assessment.get("anomaly_count")),
            "latestProbeSampleAt": _iso(assessment.get("latest_sample_at")),
            "upstreamAccountFound": bool(upstream_account),
            "upstreamEnabled": (
                bool(upstream_account.get("enabled"))
                if "enabled" in upstream_account
                else None
            ),
            "upstreamAuthStatus": str(upstream_account.get("authStatus") or ""),
            "lastSeenAt": _iso(latest.get("created_at")),
        }

    def _node_payloads(
        self,
        records: list[dict[str, Any]],
        *,
        assessments: dict[int, dict[str, Any]],
        nodes: dict[int, dict[str, Any]],
        upstream_accounts: dict[int, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in records:
            node_id = _positive_int(row.get("egress_node_id"))
            if node_id:
                key = f"node:{node_id}"
            else:
                scope = str(row.get("egress_scope") or "unknown").strip() or "unknown"
                mode = str(row.get("egress_mode") or "unknown").strip() or "unknown"
                key = f"unmapped:{scope}:{mode}"
            groups[key].append(row)

        result: list[dict[str, Any]] = []
        for key, rows in groups.items():
            account_values = self._account_payloads(
                rows,
                assessments=assessments,
                upstream_accounts=upstream_accounts,
            )
            risky_accounts = [
                value for value in account_values if value["riskLevel"] != "normal"
            ]
            speeds = [
                float(row["tps"])
                for row in rows
                if _finite_float(row.get("tps")) is not None
                and float(row.get("tps") or 0) > 0
            ]
            max_tps = max(speeds, default=0.0)
            risk_level, _ = self._classify(max_tps)
            latest = max(
                rows,
                key=lambda row: (
                    ensure_utc(row.get("created_at"))
                    or datetime.min.replace(tzinfo=UTC)
                ),
            )
            node_id = _positive_int(latest.get("egress_node_id"))
            node = nodes.get(node_id or 0, {})
            node_name = str(node.get("name") or latest.get("egress_node_name") or "")
            proxy_pool = bool(node.get("proxyPool")) if "proxyPool" in node else None
            enabled = bool(node.get("enabled")) if "enabled" in node else None
            result.append(
                {
                    "key": key,
                    "egressNodeId": node_id,
                    "egressNodeName": node_name,
                    "mapped": node_id is not None,
                    "latestProbeIp": str(node.get("exitIp") or ""),
                    "proxyPool": proxy_pool,
                    "enabled": enabled,
                    "requests": len(rows),
                    "measuredRequests": len(speeds),
                    "outputTokens": sum(
                        int(row.get("output_tokens") or 0) for row in rows
                    ),
                    "averageTps": (
                        round(sum(speeds) / len(speeds), 1) if speeds else 0
                    ),
                    "p95Tps": round(_p95(speeds), 1),
                    "maxTps": round(max_tps, 1),
                    "watchCount": (
                        sum(
                            1
                            for value in speeds
                            if value >= self.settings.degradation_tps
                        )
                        if self.settings.request_audit_risk_enabled
                        else 0
                    ),
                    "highRiskCount": (
                        sum(
                            1
                            for value in speeds
                            if value >= self.settings.strong_degradation_tps
                        )
                        if self.settings.request_audit_risk_enabled
                        else 0
                    ),
                    "riskLevel": risk_level,
                    "riskReasons": self._risk_reasons(max_tps),
                    "accountCount": len(account_values),
                    "riskAccountCount": len(risky_accounts),
                    "accounts": risky_accounts,
                    "lastSeenAt": _iso(latest.get("created_at")),
                }
            )
        rank = {"high": 2, "watch": 1, "normal": 0}
        result.sort(
            key=lambda row: (
                rank[row["riskLevel"]],
                row["riskAccountCount"],
                row["maxTps"],
            ),
            reverse=True,
        )
        return result

    def _classify(self, tps: float | None) -> tuple[str, list[str]]:
        if not self.settings.request_audit_risk_enabled:
            return "normal", []
        return classify_audit_tps(
            tps,
            self.settings.degradation_tps,
            self.settings.strong_degradation_tps,
        )

    def _risk_reasons(self, tps: float) -> list[str]:
        if not self.settings.request_audit_risk_enabled:
            return []
        if tps >= self.settings.strong_degradation_tps:
            return [
                f"峰值 {tps:.1f} Token/s ≥ {self.settings.strong_degradation_tps:g} TPS"
            ]
        if tps >= self.settings.degradation_tps:
            return [f"峰值 {tps:.1f} Token/s ≥ {self.settings.degradation_tps:g} TPS"]
        return []

    def _trend_payload(
        self,
        window: dict[str, Any],
        records: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        start = window["start"]
        end = window["end"]
        duration = end - start
        if duration <= timedelta(days=2):
            bucket_size = timedelta(hours=1)
            granularity = "hour"
        elif duration <= timedelta(days=14):
            bucket_size = timedelta(hours=6)
            granularity = "6hour"
        elif duration <= timedelta(days=45):
            bucket_size = timedelta(days=1)
            granularity = "day"
        else:
            bucket_size = timedelta(days=7)
            granularity = "week"
        bucket_seconds = bucket_size.total_seconds()
        count = max(1, math.ceil(duration.total_seconds() / bucket_seconds))
        buckets: list[dict[str, Any]] = []
        for index in range(count):
            bucket_start = start + bucket_size * index
            bucket_end = min(end, bucket_start + bucket_size)
            local = to_app_timezone(bucket_start) or bucket_start
            label = (
                local.strftime("%H:%M")
                if duration <= timedelta(days=1)
                else local.strftime("%m-%d %H:%M")
                if bucket_size < timedelta(days=1)
                else local.strftime("%m-%d")
            )
            buckets.append(
                {
                    "index": index,
                    "label": label,
                    "bucketStart": _iso(bucket_start),
                    "bucketEnd": _iso(bucket_end),
                    "granularity": granularity,
                    "requests": 0,
                    "measuredRequests": 0,
                    "averageTps": 0,
                    "maxTps": 0,
                    "watch": 0,
                    "high": 0,
                    "_values": [],
                }
            )
        for row in records:
            created = ensure_utc(row.get("created_at"))
            if created is None:
                continue
            index = int((created - start).total_seconds() // bucket_seconds)
            if index < 0 or index >= len(buckets):
                continue
            bucket = buckets[index]
            bucket["requests"] += 1
            tps = _finite_float(row.get("tps"))
            if tps is not None and tps > 0:
                bucket["measuredRequests"] += 1
                bucket["_values"].append(tps)
                bucket["maxTps"] = round(max(bucket["maxTps"], tps), 1)
                if self.settings.request_audit_risk_enabled:
                    if tps >= self.settings.degradation_tps:
                        bucket["watch"] += 1
                    if tps >= self.settings.strong_degradation_tps:
                        bucket["high"] += 1
        for bucket in buckets:
            values = bucket.pop("_values")
            bucket["averageTps"] = round(sum(values) / len(values), 1) if values else 0
        return buckets

    def _record_payload(
        self,
        row: dict[str, Any],
        *,
        probe_samples: list[dict[str, Any]] | None = None,
        upstream_account: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        risk_level, risk_reasons = self._classify(_finite_float(row.get("tps")))
        upstream_account = upstream_account or {}
        return {
            "id": str(row.get("upstream_id") or ""),
            "requestId": str(row.get("request_id") or ""),
            "provider": str(row.get("provider") or "grok_build"),
            "operation": str(row.get("operation") or ""),
            "modelPublicId": str(row.get("model_public_id") or ""),
            "modelUpstreamModel": str(row.get("model_upstream_model") or ""),
            "accountId": int(row["account_id"]) if row.get("account_id") else None,
            "accountName": str(row.get("account_name") or ""),
            "upstreamAccountFound": bool(upstream_account),
            "upstreamEnabled": (
                bool(upstream_account.get("enabled"))
                if "enabled" in upstream_account
                else None
            ),
            "upstreamAuthStatus": str(upstream_account.get("authStatus") or ""),
            "egressNodeId": int(row["egress_node_id"])
            if row.get("egress_node_id")
            else None,
            "egressNodeName": str(row.get("egress_node_name") or ""),
            "egressMode": str(row.get("egress_mode") or ""),
            "egressScope": str(row.get("egress_scope") or ""),
            "statusCode": int(row.get("status_code") or 0),
            "streaming": bool(row.get("streaming")),
            "inputTokens": int(row.get("input_tokens") or 0),
            "outputTokens": int(row.get("output_tokens") or 0),
            "reasoningTokens": int(row.get("reasoning_tokens") or 0),
            "totalTokens": int(row.get("total_tokens") or 0),
            "firstTokenMs": (
                int(row["first_token_ms"])
                if row.get("first_token_ms") is not None
                else None
            ),
            "durationMs": int(row.get("duration_ms") or 0),
            "tps": round(float(row["tps"]), 2) if row.get("tps") is not None else None,
            "riskLevel": risk_level,
            "riskReasons": risk_reasons,
            "probeSampleCount": len(probe_samples or []),
            "probeSamples": probe_samples or [],
            "createdAt": _iso(row.get("created_at")),
        }

    @classmethod
    def _state_payload(
        cls,
        state: dict[str, Any],
        *,
        window: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        result = {
            "day": str(state.get("day_key") or ""),
            "initialComplete": bool(state.get("initial_complete")),
            "initialResumePending": bool(state.get("initial_cursor")),
            "newestAuditId": str(state.get("newest_upstream_id") or ""),
            "newestCreatedAt": _iso(state.get("newest_created_at")),
            "lastScanAt": _iso(state.get("last_scan_at")),
            "lastSuccessAt": _iso(state.get("last_success_at")),
            "lastError": str(state.get("last_error") or ""),
            "lastPages": int(state.get("last_pages") or 0),
            "lastNewRecords": int(state.get("last_new_records") or 0),
            "lastSeenRecords": int(state.get("last_seen_records") or 0),
        }
        if window is not None:
            result["window"] = cls._window_payload(window)
        return result
