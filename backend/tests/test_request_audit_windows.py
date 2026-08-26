from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock

from app.core.clock import utc_now
from app.core.config import Settings
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


def test_repeated_reasoning_zero_keeps_strong_tps_as_primary_rule():
    service = RequestAuditService(
        settings=Settings(_env_file=None),
        client=MagicMock(),
        repository=MagicMock(),
    )
    now = utc_now()
    records = [
        {
            "upstream_id": str(index),
            "account_id": 7,
            "status_code": 200,
            "output_tokens": 600,
            "reasoning_tokens": 0,
            "reasoning_tokens_reported": True,
            "first_token_ms": 100,
            "duration_ms": 1100,
            "tps": 600,
            "model_upstream_model": "Build/grok-4.6",
            "model_public_id": "grok-4.6",
            "operation": "chat",
            "media_input_images": 0,
            "created_at": now + timedelta(seconds=index),
        }
        for index in (1, 2)
    ]

    evaluations = service._audit_risk_evaluations(records)
    latest = evaluations["2"]

    assert latest.classification.name == "high"
    assert latest.classification.rule_id == "fast_risk"
    assert "reasoning_zero" in latest.classification.rule_ids
    assert latest.reasoning_streak == 2


def test_media_input_observe_does_not_auto_disable_for_reasoning_zero():
    service = RequestAuditService(
        settings=Settings(_env_file=None),
        client=MagicMock(),
        repository=MagicMock(),
    )
    now = utc_now()
    records = [
        {
            "upstream_id": str(index),
            "account_id": 5433,
            "status_code": 200,
            "output_tokens": 155,
            "reasoning_tokens": 0,
            "reasoning_tokens_reported": True,
            "first_token_ms": 100,
            "duration_ms": 1100,
            "tps": 1700 + index,
            "model_upstream_model": "Build/grok-4.6",
            "model_public_id": "grok-4.6",
            "operation": "responses",
            "media_input_images": 3,
            "created_at": now + timedelta(seconds=index),
        }
        for index in (1, 2, 3, 4)
    ]

    evaluations = service._audit_risk_evaluations(records)
    latest = evaluations["4"]
    candidates = service._pre_disable_candidates(records, evaluations=evaluations)

    assert latest.classification.rule_id == "media_input_observe"
    assert latest.classification.name == "watch"
    assert latest.classification.hard is False
    assert "reasoning_zero" in latest.classification.rule_ids
    assert latest.reasoning_streak == 0
    assert candidates == []
