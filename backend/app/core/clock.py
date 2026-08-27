from __future__ import annotations

import os
import time
from datetime import UTC, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

APP_TIMEZONE_NAME = "Asia/Shanghai"
PROCESS_TIMEZONE = APP_TIMEZONE_NAME

try:
    APP_TIMEZONE = ZoneInfo(APP_TIMEZONE_NAME)
except ZoneInfoNotFoundError:
    # China has no DST transitions in the supported application period. The
    # fixed offset keeps slim containers usable even when system tzdata is not
    # installed.
    APP_TIMEZONE = timezone(timedelta(hours=8), name=APP_TIMEZONE_NAME)


def utc_now() -> datetime:
    """Return one timezone-aware UTC timestamp.

    Keeping time creation in one place makes scheduling and persistence tests
    deterministic without introducing a domain layer for a small service.
    """

    return datetime.now(UTC)


def ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def to_app_timezone(value: datetime | None) -> datetime | None:
    """Convert a stored/runtime timestamp to the application's display zone."""

    normalized = ensure_utc(value)
    return normalized.astimezone(APP_TIMEZONE) if normalized else None


def app_now() -> datetime:
    """Return the current timestamp in Asia/Shanghai."""

    return datetime.now(APP_TIMEZONE)


def app_day_start(value: datetime | None = None) -> datetime:
    """Return 00:00 Asia/Shanghai as UTC for the given instant."""

    current = to_app_timezone(value) or app_now()
    local_start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    return local_start.astimezone(UTC)


def app_day_key(value: datetime | None) -> str | None:
    converted = to_app_timezone(value)
    return converted.date().isoformat() if converted else None


def app_isoformat(value: datetime | None) -> str | None:
    converted = to_app_timezone(value)
    return converted.isoformat() if converted else None


def parse_optional_datetime(value: Any) -> datetime | None:
    """Parse an optional ISO timestamp from upstream account payloads."""

    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return ensure_utc(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return ensure_utc(datetime.fromisoformat(text.replace("Z", "+00:00")))
    except ValueError:
        return None


def account_created_at(account: dict[str, Any] | None) -> datetime | None:
    if not account:
        return None
    return parse_optional_datetime(account.get("createdAt") or account.get("created_at"))


def configure_process_timezone() -> None:
    """Align stdlib logging and local-time rotation with Asia/Shanghai."""

    os.environ["TZ"] = PROCESS_TIMEZONE
    if hasattr(time, "tzset"):
        time.tzset()
