from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock

from app.core.clock import utc_now
from app.services.request_audit_service import RequestAuditService


def build_service() -> RequestAuditService:
    return RequestAuditService(
        settings=MagicMock(),
        client=MagicMock(),
        repository=MagicMock(),
    )


def test_request_audit_window_includes_1h_and_3h():
    service = build_service()
    one = service.resolve_window(window_preset="1h")
    three = service.resolve_window(window_preset="3h")
    assert one["preset"] == "1h"
    assert one["label"] == "最近 1 小时"
    assert one["end"] - one["start"] == timedelta(hours=1)
    assert three["preset"] == "3h"
    assert three["label"] == "最近 3 小时"
    assert three["end"] - three["start"] == timedelta(hours=3)


def test_custom_window_allows_end_after_now():
    service = build_service()
    now = utc_now()
    window = service.resolve_window(
        window_preset="custom",
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(hours=2),
    )
    assert window["preset"] == "custom"
    assert window["end"] > now
