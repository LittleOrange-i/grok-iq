from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from app.core.clock import (
    app_day_key,
    app_day_start,
    app_isoformat,
    parse_optional_datetime,
    utc_now,
)
from app.core.disposition import (
    DISPOSITION_SOURCE_LABELS,
    normalize_disposition_source,
)

MAX_STATS_RANGE_DAYS = 90
SOURCE_ORDER = ("probe", "request_audit", "register", "manual", "sso", "unknown")


def resolve_stats_range(
    start_raw: str | None,
    end_raw: str | None,
) -> tuple[datetime, datetime]:
    start = parse_optional_datetime(start_raw)
    end = parse_optional_datetime(end_raw)
    if start is None and end is None:
        start = app_day_start()
        end = start + timedelta(days=1)
        return start, end
    if start is None or end is None:
        raise ValueError("统计开始和结束时间需要同时填写")
    if end.second == 0 and end.microsecond == 0:
        end = end + timedelta(minutes=1)
    if end <= start:
        raise ValueError("统计结束时间必须晚于开始时间")
    if end - start > timedelta(days=MAX_STATS_RANGE_DAYS):
        raise ValueError(f"统计时间范围不能超过 {MAX_STATS_RANGE_DAYS} 天")
    return start, end


def compute_isolation_stats(
    *,
    assessments: list[dict[str, Any]],
    register_events: list[dict[str, Any]],
    start: datetime,
    end: datetime,
) -> dict[str, Any]:
    isolated_accounts = [
        _isolated_account(item) for item in assessments if _is_isolation_zone(item)
    ]
    isolated_ids = {item["account_id"] for item in isolated_accounts}
    isolated_in_range = [
        item for item in isolated_accounts if _in_range(item["isolated_at"], start, end)
    ]
    identities = _register_identities(register_events)
    registered_isolated = [
        item
        for item in identities
        if item["account_id"] is not None and item["account_id"] in isolated_ids
    ]
    registered_isolated_in_range = [
        item
        for item in registered_isolated
        if _in_range(_isolated_at_for(isolated_accounts, item["account_id"]), start, end)
    ]
    hours_to_isolate = []
    for item in registered_isolated:
        hours = _hours_between(
            item["registered_at"],
            _isolated_at_for(isolated_accounts, item["account_id"]),
        )
        if hours is not None and hours >= 0:
            hours_to_isolate.append(hours)
    completed = sum(1 for item in identities if item["status"] == "completed")
    isolated_count = len(registered_isolated)
    return {
        "range": {
            "from": app_isoformat(start),
            "to": app_isoformat(end),
        },
        "zone": {
            "total": len(isolated_accounts),
            "isolatedInRange": len(isolated_in_range),
            "bySource": _source_counts(isolated_accounts),
        },
        "registered": {
            "total": len(identities),
            "completed": completed,
            "failed": sum(1 for item in identities if item["status"] == "failed"),
            "pending": sum(1 for item in identities if item["status"] == "pending"),
            "isolated": isolated_count,
            "isolatedInRange": len(registered_isolated_in_range),
            "isolationRate": _rate(isolated_count, completed or len(identities)),
        },
        "timing": {
            "sampleCount": len(hours_to_isolate),
            "avgHours": _round(_mean(hours_to_isolate)),
            "medianHours": _round(_median(hours_to_isolate)),
        },
        "isolated": {
            "total": len(isolated_in_range),
            "bySource": _source_counts(isolated_in_range),
        },
        "trend": _trend(
            identities=identities,
            isolated_accounts=isolated_accounts,
            start=start,
            end=end,
        ),
        "generatedAt": app_isoformat(utc_now()),
    }


def _is_isolation_zone(assessment: dict[str, Any]) -> bool:
    return (
        str(assessment.get("monitor_status") or "") == "quarantined"
        and assessment.get("quarantine_until") is None
    )


def _isolated_account(assessment: dict[str, Any]) -> dict[str, Any]:
    account_id = int(assessment.get("account_id") or 0)
    disposition = (
        assessment.get("disposition")
        if isinstance(assessment.get("disposition"), dict)
        else {}
    )
    source = normalize_disposition_source(str(disposition.get("source") or ""))
    isolated_at = parse_optional_datetime(disposition.get("at")) or parse_optional_datetime(
        assessment.get("updated_at")
    )
    return {
        "account_id": account_id,
        "source": source,
        "isolated_at": isolated_at,
    }


def _register_identities(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        grouped[_event_identity(event)].append(event)
    identities: list[dict[str, Any]] = []
    for rows in grouped.values():
        ordered = sorted(rows, key=lambda item: parse_optional_datetime(item.get("created_at")) or utc_now())
        statuses = {str(item.get("status") or "") for item in ordered}
        if "completed" in statuses:
            status = "completed"
        elif statuses <= {"failed"}:
            status = "failed"
        else:
            status = "pending"
        account_ids = [
            account_id
            for account_id in (_event_account_id(item) for item in ordered)
            if account_id is not None
        ]
        identities.append(
            {
                "account_id": account_ids[0] if account_ids else None,
                "status": status,
                "registered_at": parse_optional_datetime(ordered[0].get("created_at")),
            }
        )
    return identities


def _event_identity(event: dict[str, Any]) -> str:
    account_id = _event_account_id(event)
    if account_id is not None:
        return f"account:{account_id}"
    email = str(event.get("email") or "").strip().lower()
    if email:
        return f"email:{email}"
    return f"event:{event.get('event_id') or ''}"


def _event_account_id(event: dict[str, Any]) -> int | None:
    for key in ("grok2api_account_id", "resolved_account_id"):
        try:
            value = int(event.get(key) or 0)
        except (TypeError, ValueError):
            value = 0
        if value > 0:
            return value
    return None


def _isolated_at_for(
    isolated_accounts: list[dict[str, Any]], account_id: int | None
) -> datetime | None:
    if account_id is None:
        return None
    for item in isolated_accounts:
        if item["account_id"] == account_id:
            return item["isolated_at"]
    return None


def _in_range(value: datetime | None, start: datetime, end: datetime) -> bool:
    return value is not None and start <= value < end


def _hours_between(start: datetime | None, end: datetime | None) -> float | None:
    if start is None or end is None:
        return None
    return (end - start).total_seconds() / 3600


def _source_counts(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, int] = defaultdict(int)
    for item in items:
        counts[str(item.get("source") or "unknown")] += 1
    ordered_keys = [key for key in SOURCE_ORDER if counts.get(key)]
    ordered_keys.extend(sorted(key for key in counts if key not in SOURCE_ORDER))
    return [
        {
            "source": source,
            "label": DISPOSITION_SOURCE_LABELS.get(
                source, "未知" if source == "unknown" else source
            ),
            "count": counts[source],
        }
        for source in ordered_keys
    ]


def _trend(
    *,
    identities: list[dict[str, Any]],
    isolated_accounts: list[dict[str, Any]],
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    days: list[str] = []
    cursor = app_day_start(start)
    last = app_day_start(end - timedelta(microseconds=1))
    while cursor <= last:
        key = app_day_key(cursor)
        if key:
            days.append(key)
        cursor += timedelta(days=1)
    registered_by_day: dict[str, int] = defaultdict(int)
    registered_isolated_by_day: dict[str, int] = defaultdict(int)
    isolated_ids = {item["account_id"] for item in isolated_accounts}
    for item in identities:
        day = app_day_key(item["registered_at"])
        if not day:
            continue
        registered_by_day[day] += 1
        account_id = item["account_id"]
        if account_id in isolated_ids:
            registered_isolated_by_day[day] += 1
    isolated_by_day: dict[str, int] = defaultdict(int)
    for item in isolated_accounts:
        day = app_day_key(item["isolated_at"])
        if day:
            isolated_by_day[day] += 1
    return [
        {
            "day": day,
            "registered": registered_by_day.get(day, 0),
            "isolated": isolated_by_day.get(day, 0),
            "registeredIsolated": registered_isolated_by_day.get(day, 0),
        }
        for day in days
    ]


def _rate(count: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(count / total, 4)


def _mean(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 3)
