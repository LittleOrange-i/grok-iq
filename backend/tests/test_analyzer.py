from app.analyzer import SampleMetrics, Thresholds, classify_sample, risk_status


def test_classifies_delayed_burst_as_buffered_hard():
    result = classify_sample(
        SampleMetrics(
            status_code=200,
            output_tokens=1000,
            reasoning_tokens=200,
            first_token_ms=49_000,
            duration_ms=49_050,
            egress_key="node:3",
        ),
        Thresholds(),
    )
    assert result.name == "buffered_hard"
    assert result.buffered is True
    assert result.tps == 20_000


def test_classifies_sustained_high_speed_as_fast_risk():
    result = classify_sample(
        SampleMetrics(
            status_code=200,
            output_tokens=1500,
            reasoning_tokens=100,
            first_token_ms=900,
            duration_ms=1900,
            egress_key="node:5",
        ),
        Thresholds(),
    )
    assert result.name == "fast_risk"
    assert result.buffered is False


def test_lower_tps_interval_records_a_degradation_signal():
    result = classify_sample(
        SampleMetrics(
            status_code=200,
            output_tokens=300,
            reasoning_tokens=0,
            first_token_ms=1000,
            duration_ms=2000,
            egress_key="node:3",
        ),
        Thresholds(),
    )
    assert result.name == "elevated"
    assert result.anomalous is True
    assert result.hard is False


def test_repeated_strong_signals_become_high_risk():
    status, score, reasons = risk_status(
        anomaly_count=5,
        hard_count=4,
        fast_count=2,
        marker_miss_count=0,
        anomaly_streak=3,
        sample_count=8,
        thresholds=Thresholds(),
    )
    assert status == "high_risk"
    assert score >= 75
    assert any("固定出口" in reason for reason in reasons)


def test_repeated_soft_signals_remain_suspect():
    status, _, _ = risk_status(
        anomaly_count=3,
        hard_count=0,
        fast_count=0,
        marker_miss_count=0,
        anomaly_streak=3,
        sample_count=3,
        thresholds=Thresholds(),
    )
    assert status == "suspect"


def test_sparse_anomalies_do_not_become_suspect_from_count_alone():
    status, score, _ = risk_status(
        anomaly_count=3,
        hard_count=0,
        fast_count=0,
        marker_miss_count=0,
        anomaly_streak=1,
        sample_count=10,
        thresholds=Thresholds(),
    )
    assert status == "watch"
    assert score >= 15


def test_cumulative_majority_of_soft_signals_becomes_suspect():
    status, score, reasons = risk_status(
        anomaly_count=3,
        hard_count=0,
        fast_count=0,
        marker_miss_count=0,
        anomaly_streak=1,
        sample_count=5,
        thresholds=Thresholds(),
    )
    assert status == "suspect"
    assert score >= 50
    assert any("达到 50%" in reason for reason in reasons)
