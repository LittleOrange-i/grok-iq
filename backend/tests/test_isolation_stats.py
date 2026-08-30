from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.clock import app_day_start, app_isoformat, utc_now
from app.services.isolation_stats import compute_isolation_stats, resolve_stats_range


def test_resolve_stats_range_defaults_to_shanghai_today():
    start, end = resolve_stats_range("", "")
    expected_start = app_day_start()
    assert start == expected_start
    assert end == expected_start + timedelta(days=1)


def test_resolve_stats_range_rejects_inverted_window():
    now = utc_now()
    with pytest.raises(ValueError, match="结束时间必须晚于开始时间"):
        resolve_stats_range(now.isoformat(), (now - timedelta(hours=1)).isoformat())


def test_compute_isolation_stats_counts_register_funnel_and_sources():
    now = utc_now()
    start = now - timedelta(hours=12)
    end = now + timedelta(hours=12)
    yesterday = now - timedelta(days=2)
    stats = compute_isolation_stats(
        assessments=[
            {
                "account_id": 1,
                "monitor_status": "quarantined",
                "quarantine_until": None,
                "disposition": {
                    "source": "probe",
                    "at": app_isoformat(now - timedelta(hours=1)),
                },
            },
            {
                "account_id": 2,
                "monitor_status": "quarantined",
                "quarantine_until": None,
                "disposition": {
                    "source": "request_audit",
                    "at": app_isoformat(yesterday),
                },
            },
            {
                "account_id": 3,
                "monitor_status": "quarantined",
                "quarantine_until": now + timedelta(minutes=30),
                "disposition": {"source": "manual", "at": app_isoformat(now)},
            },
        ],
        register_events=[
            {
                "event_id": "a",
                "email": "alpha@example.test",
                "status": "completed",
                "grok2api_account_id": 1,
                "created_at": app_isoformat(now - timedelta(hours=2)),
            },
            {
                "event_id": "b",
                "email": "bravo@example.test",
                "status": "completed",
                "resolved_account_id": 2,
                "created_at": app_isoformat(now - timedelta(hours=3)),
            },
            {
                "event_id": "c",
                "email": "charlie@example.test",
                "status": "failed",
                "created_at": app_isoformat(now - timedelta(hours=4)),
            },
        ],
        start=start,
        end=end,
    )

    assert stats["zone"]["total"] == 2
    assert stats["zone"]["isolatedInRange"] == 1
    assert stats["zone"]["bySource"] == [
        {"source": "probe", "label": "账号探针", "count": 1},
        {"source": "request_audit", "label": "请求审计", "count": 1},
    ]
    assert stats["registered"]["total"] == 3
    assert stats["registered"]["completed"] == 2
    assert stats["registered"]["failed"] == 1
    assert stats["registered"]["isolated"] == 2
    assert stats["registered"]["isolatedInRange"] == 1
    assert stats["registered"]["isolationRate"] == 1.0
    assert stats["isolated"]["total"] == 1
    assert stats["timing"]["sampleCount"] == 1
    assert stats["timing"]["medianHours"] == 1.0


def test_compute_isolation_stats_keeps_sub_hour_timing():
    now = utc_now()
    start = now - timedelta(hours=2)
    end = now + timedelta(hours=1)
    stats = compute_isolation_stats(
        assessments=[
            {
                "account_id": 1,
                "monitor_status": "quarantined",
                "quarantine_until": None,
                "disposition": {
                    "source": "probe",
                    "at": app_isoformat(now - timedelta(minutes=1)),
                },
            }
        ],
        register_events=[
            {
                "event_id": "a",
                "email": "alpha@example.test",
                "status": "completed",
                "grok2api_account_id": 1,
                "created_at": app_isoformat(now - timedelta(minutes=13)),
            }
        ],
        start=start,
        end=end,
    )

    assert stats["timing"]["sampleCount"] == 1
    assert stats["timing"]["medianHours"] == 0.2
    assert stats["timing"]["avgHours"] == 0.2



def test_compute_isolation_stats_includes_quality_retry_source():
    now = utc_now()
    start = now - timedelta(hours=2)
    end = now + timedelta(hours=1)
    stats = compute_isolation_stats(
        assessments=[
            {
                "account_id": 9,
                "monitor_status": "quarantined",
                "quarantine_until": None,
                "disposition": {
                    "source": "quality_retry",
                    "at": app_isoformat(now - timedelta(minutes=10)),
                },
            }
        ],
        register_events=[],
        start=start,
        end=end,
    )
    assert stats["zone"]["bySource"] == [
        {"source": "quality_retry", "label": "grok2api 降智停用", "count": 1},
    ]
