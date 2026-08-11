from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator

from app.core.clock import to_app_timezone


class AppDateTime(TypeDecorator[datetime]):
    """Store UTC while exposing ORM timestamps as Asia/Shanghai.

    SQLite drops timezone offsets even when ``timezone=True`` is requested.
    Existing rows in this project are UTC wall-clock values, so naïve values
    are interpreted as UTC and converted only after reading. This keeps
    indexes, comparisons, and historical data stable while API serialization
    consistently includes ``+08:00``.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(
        self,
        value: datetime | None,
        dialect: Dialect,
    ) -> datetime | None:
        if value is None:
            return None
        normalized = (
            value.replace(tzinfo=UTC)
            if value.tzinfo is None
            else value.astimezone(UTC)
        )
        if dialect.name == "sqlite":
            return normalized.replace(tzinfo=None)
        return normalized

    def process_result_value(
        self,
        value: datetime | None,
        _dialect: Dialect,
    ) -> datetime | None:
        return to_app_timezone(value)
