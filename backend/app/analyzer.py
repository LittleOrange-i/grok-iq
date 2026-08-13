from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(slots=True, frozen=True)
class Thresholds:
    degradation_tps: float = 150
    strong_degradation_tps: float = 500
    minimum_output_tokens: int = 32
    buffer_first_token_share: float = 0.85
    min_generation_ms: int = 250
    consecutive_anomalies: int = 3
    cumulative_anomaly_rate: float = 0.5
    high_risk_hard_count: int = 2
    risk_anomaly_rate_weight: float = 30
    risk_hard_weight: float = 6
    risk_hard_cap: float = 24
    risk_fast_weight: float = 12
    risk_fast_cap: float = 30
    risk_marker_miss_weight: float = 16
    risk_marker_miss_cap: float = 32
    risk_streak_weight: float = 3
    risk_streak_cap: float = 15
    risk_score_cap: float = 100
    risk_watch_floor: float = 15
    risk_suspect_floor: float = 50
    risk_high_floor: float = 75


@dataclass(slots=True, frozen=True)
class SampleMetrics:
    status_code: int
    output_tokens: int
    reasoning_tokens: int
    first_token_ms: int | None
    duration_ms: int
    egress_key: str
    expected_matched: bool | None = None


@dataclass(slots=True, frozen=True)
class Classification:
    name: str
    severity: int
    tps: float
    generation_ms: int
    first_token_share: float
    anomalous: bool
    hard: bool
    buffered: bool


def classify_sample(sample: SampleMetrics, thresholds: Thresholds) -> Classification:
    if sample.status_code < 200 or sample.status_code >= 300:
        return Classification("error", 1, 0.0, 0, 0.0, False, False, False)
    if sample.first_token_ms is None or sample.duration_ms <= sample.first_token_ms:
        return Classification("unmeasurable", 0, 0.0, 0, 0.0, False, False, False)

    generation_ms = sample.duration_ms - sample.first_token_ms
    tps = sample.output_tokens * 1000.0 / generation_ms if sample.output_tokens > 0 else 0.0
    first_token_share = sample.first_token_ms / sample.duration_ms if sample.duration_ms > 0 else 0.0
    buffered = (
        first_token_share >= thresholds.buffer_first_token_share
        or generation_ms < thresholds.min_generation_ms
    )

    if sample.expected_matched is False:
        return Classification("marker_miss", 5, tps, generation_ms, first_token_share, True, True, buffered)
    if sample.output_tokens < thresholds.minimum_output_tokens:
        return Classification(
            "insufficient", 0, tps, generation_ms, first_token_share, False, False, buffered
        )
    if tps < thresholds.degradation_tps:
        return Classification("normal", 0, tps, generation_ms, first_token_share, False, False, buffered)
    if tps < thresholds.strong_degradation_tps:
        name = "buffered_soft" if buffered else "elevated"
        return Classification(name, 1, tps, generation_ms, first_token_share, True, False, buffered)
    if buffered:
        return Classification("buffered_hard", 2, tps, generation_ms, first_token_share, True, True, True)
    return Classification("fast_risk", 4, tps, generation_ms, first_token_share, True, True, False)


def maximum_anomaly_streak(classifications: Iterable[str]) -> int:
    maximum = current = 0
    for name in classifications:
        if name in {"elevated", "buffered_soft", "buffered_hard", "fast_risk", "marker_miss"}:
            current += 1
            maximum = max(maximum, current)
        elif name not in {"error", "unmeasurable", "insufficient"}:
            current = 0
    return maximum


def risk_status(
    *,
    anomaly_count: int,
    hard_count: int,
    fast_count: int,
    marker_miss_count: int,
    anomaly_streak: int,
    sample_count: int,
    thresholds: Thresholds,
) -> tuple[str, float, list[str]]:
    reasons: list[str] = []
    anomaly_rate = anomaly_count / sample_count if sample_count else 0.0
    consecutive = anomaly_streak >= thresholds.consecutive_anomalies
    cumulative = (
        anomaly_count >= thresholds.consecutive_anomalies
        and anomaly_rate >= thresholds.cumulative_anomaly_rate
    )
    repeated = consecutive or cumulative
    strong_repeated = repeated and hard_count >= thresholds.high_risk_hard_count
    if consecutive:
        reasons.append(f"固定出口连续降智信号达到 {thresholds.consecutive_anomalies} 次")
    elif cumulative:
        reasons.append(
            f"固定出口降智信号占比 {anomaly_count}/{sample_count}，达到 "
            f"{thresholds.cumulative_anomaly_rate:.0%}"
        )
    if fast_count:
        reasons.append(f"持续生成型高速样本 {fast_count} 次")
    if marker_miss_count:
        reasons.append(f"预期标记缺失 {marker_miss_count} 次")
    if hard_count:
        reasons.append(f"强降智信号 {hard_count} 次")

    score = min(
        thresholds.risk_score_cap,
        anomaly_rate * thresholds.risk_anomaly_rate_weight
        + min(hard_count * thresholds.risk_hard_weight, thresholds.risk_hard_cap)
        + min(fast_count * thresholds.risk_fast_weight, thresholds.risk_fast_cap)
        + min(
            marker_miss_count * thresholds.risk_marker_miss_weight,
            thresholds.risk_marker_miss_cap,
        )
        + min(
            anomaly_streak * thresholds.risk_streak_weight,
            thresholds.risk_streak_cap,
        ),
    )

    if strong_repeated:
        return "high_risk", round(max(score, thresholds.risk_high_floor), 1), reasons
    if repeated:
        return "suspect", round(max(score, thresholds.risk_suspect_floor), 1), reasons
    if anomaly_count:
        return "watch", round(max(score, thresholds.risk_watch_floor), 1), reasons
    return "healthy", round(score, 1), reasons
