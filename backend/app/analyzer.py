from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(slots=True, frozen=True)
class Thresholds:
    degradation_tps: float = 500
    strong_degradation_tps: float = 1000
    minimum_output_tokens: int = 32
    buffer_first_token_share: float = 0.85
    min_generation_ms: int = 250
    consecutive_anomalies: int = 3
    cross_egress_min: int = 2


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
    distinct_egress_count: int,
    anomaly_streak: int,
    sample_count: int,
    thresholds: Thresholds,
) -> tuple[str, float, list[str]]:
    reasons: list[str] = []
    cross_egress = distinct_egress_count >= thresholds.cross_egress_min
    repeated = max(anomaly_count, anomaly_streak) >= thresholds.consecutive_anomalies
    if repeated:
        reasons.append(f"连续或累计降智信号达到 {thresholds.consecutive_anomalies} 次")
    if cross_egress:
        reasons.append(f"降智信号覆盖 {distinct_egress_count} 个出口")
    if fast_count:
        reasons.append(f"持续生成型高速样本 {fast_count} 次")
    if marker_miss_count:
        reasons.append(f"预期标记缺失 {marker_miss_count} 次")
    if hard_count:
        reasons.append(f"强降智信号 {hard_count} 次")

    anomaly_rate = anomaly_count / sample_count if sample_count else 0.0
    score = min(
        100.0,
        anomaly_rate * 30
        + min(hard_count * 6, 24)
        + min(fast_count * 12, 30)
        + min(marker_miss_count * 16, 32)
        + (16 if cross_egress else 0)
        + min(anomaly_streak * 3, 15),
    )

    if repeated and cross_egress:
        return "high_risk", round(score, 1), reasons
    # Repeated anomalies already indicate an account-level problem even when
    # grok2api happened to schedule every request through the same egress.
    # Cross-egress confirmation remains required for the high-risk state that
    # can trigger automatic quarantine.
    if repeated:
        return "suspect", round(max(score, 50.0), 1), reasons
    if anomaly_count:
        return "watch", round(max(score, 15.0), 1), reasons
    return "healthy", round(score, 1), reasons
