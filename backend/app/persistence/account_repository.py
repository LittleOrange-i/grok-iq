from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import case, func, select

from app.analyzer import (
    Thresholds,
    active_anomaly_classifications,
    aggregate_rule_reasons,
    maximum_anomaly_streak,
    risk_status,
    rule_metadata,
)
from app.core.clock import ensure_utc, utc_now

from .database import Database
from .models import (
    AccountAssessment,
    Alert,
    AppSetting,
    MetadataRow,
    ProbeSample,
    model_dict,
)

ANOMALY_NAMES = active_anomaly_classifications()
HARD_ANOMALY_NAMES = {
    name
    for name in ANOMALY_NAMES
    if ((metadata := rule_metadata(name)) is not None and bool(metadata.hard))
}
FIXED_EGRESS_RISK_MIGRATION_KEY = "fixed_egress_risk_formula_v1"
ALL_EGRESS_RISK_MIGRATION_KEY = "all_egress_risk_formula_v1"


class AccountRepository:
    def __init__(self, database: Database):
        self.database = database

    def get_assessment(self, account_id: int) -> dict[str, Any] | None:
        with self.database.session() as session:
            value = session.get(AccountAssessment, account_id)
            return model_dict(value) if value else None

    def get_assessments(self, account_ids: list[int]) -> dict[int, dict[str, Any]]:
        if not account_ids:
            return {}
        with self.database.session() as session:
            values = session.scalars(
                select(AccountAssessment).where(AccountAssessment.account_id.in_(account_ids))
            ).all()
            return {value.account_id: model_dict(value) for value in values}

    def list_assessments(self, limit: int = 1000) -> list[dict[str, Any]]:
        with self.database.session() as session:
            values = session.scalars(
                select(AccountAssessment)
                .order_by(AccountAssessment.risk_score.desc(), AccountAssessment.updated_at.desc())
                .limit(limit)
            ).all()
            return [model_dict(value) for value in values]

    def migrate_fixed_egress_risk_formula(
        self,
        thresholds: Thresholds,
        window_hours: int,
    ) -> int:
        """Recalculate persisted verdicts once after replacing cross-egress scoring."""

        with self.database.session() as session:
            if session.get(MetadataRow, FIXED_EGRESS_RISK_MIGRATION_KEY) is not None:
                return 0
            account_ids = list(session.scalars(select(AccountAssessment.account_id)).all())

        for account_id in account_ids:
            self.recalculate(account_id, thresholds, window_hours)

        with self.database.transaction() as session:
            if session.get(MetadataRow, FIXED_EGRESS_RISK_MIGRATION_KEY) is None:
                session.add(
                    MetadataRow(
                        key=FIXED_EGRESS_RISK_MIGRATION_KEY,
                        value=utc_now().isoformat(),
                    )
                )
            legacy_cross_egress = session.get(AppSetting, "cross_egress_min")
            if legacy_cross_egress is not None:
                session.delete(legacy_cross_egress)
        return len(account_ids)

    def migrate_all_egress_risk_formula(
        self,
        thresholds: Thresholds,
        window_hours: int,
    ) -> int:
        """Recalculate persisted verdicts once after including diagnostic samples."""

        with self.database.session() as session:
            if session.get(MetadataRow, ALL_EGRESS_RISK_MIGRATION_KEY) is not None:
                return 0
            account_ids = set(session.scalars(select(AccountAssessment.account_id)).all())
            account_ids.update(
                session.scalars(select(ProbeSample.account_id).distinct()).all()
            )

        for account_id in account_ids:
            self.recalculate(account_id, thresholds, window_hours)

        with self.database.transaction() as session:
            if session.get(MetadataRow, ALL_EGRESS_RISK_MIGRATION_KEY) is None:
                session.add(
                    MetadataRow(
                        key=ALL_EGRESS_RISK_MIGRATION_KEY,
                        value=utc_now().isoformat(),
                    )
                )
        return len(account_ids)

    def recalculate_all(self, thresholds: Thresholds, window_hours: int) -> int:
        with self.database.session() as session:
            account_ids = set(
                session.scalars(select(AccountAssessment.account_id)).all()
            )
            account_ids.update(
                session.scalars(select(ProbeSample.account_id).distinct()).all()
            )
        for account_id in account_ids:
            self.recalculate(account_id, thresholds, window_hours)
        return len(account_ids)

    def risky_account_ids(self) -> set[int]:
        with self.database.session() as session:
            return set(
                session.scalars(
                    select(AccountAssessment.account_id).where(
                        AccountAssessment.monitor_status.in_(
                            {"watch", "suspect", "high_risk", "quarantined"}
                        )
                    )
                ).all()
            )

    def recalculate(self, account_id: int, thresholds: Thresholds, window_hours: int) -> dict[str, Any]:
        cutoff = utc_now() - timedelta(hours=window_hours)
        with self.database.transaction() as session:
            rows = session.scalars(
                select(ProbeSample)
                .where(
                    ProbeSample.account_id == account_id,
                    ProbeSample.created_at >= cutoff,
                )
                .order_by(ProbeSample.created_at.asc(), ProbeSample.id.asc())
            ).all()
            anomaly_names = active_anomaly_classifications(thresholds)
            anomalies = [
                row
                for row in rows
                if row.classification in anomaly_names
            ]
            hard = [
                row
                for row in anomalies
                if (
                    (metadata := rule_metadata(row.classification)) is not None
                    and bool(metadata.hard)
                )
            ]
            fast = [row for row in anomalies if row.classification == "fast_risk"]
            marker = [row for row in anomalies if row.classification == "marker_miss"]
            reasoning_zero = [
                row for row in anomalies if row.classification == "reasoning_zero"
            ]
            egress_count = len({self._observed_egress_key(row) for row in anomalies})
            streak = maximum_anomaly_streak(
                (row.classification for row in rows),
                anomaly_names,
            )
            measurable = [row for row in rows if row.status == "done" and row.tps > 0]
            status, score, reasons = risk_status(
                anomaly_count=len(anomalies),
                hard_count=len(hard),
                fast_count=len(fast),
                marker_miss_count=len(marker),
                reasoning_zero_count=len(reasoning_zero),
                anomaly_streak=streak,
                sample_count=len(measurable),
                thresholds=thresholds,
            )
            rule_counts: dict[str, int] = {}
            for row in anomalies:
                rule_counts[row.classification] = (
                    rule_counts.get(row.classification, 0) + 1
                )
            generic_rule_reasons = aggregate_rule_reasons(rule_counts, thresholds)
            legacy_special_reasons = {
                "fast_risk": f"持续生成型高速样本 {len(fast)} 次",
                "marker_miss": f"预期标记缺失 {len(marker)} 次",
                "reasoning_zero": (
                    f"成功请求思考输出为 0 共 {len(reasoning_zero)} 次"
                ),
            }
            reasons = list(
                dict.fromkeys(
                    [
                        *[
                            reason
                            for reason in reasons
                            if reason not in legacy_special_reasons.values()
                        ],
                        *generic_rule_reasons,
                        *(
                            [f"强降智信号 {len(hard)} 次"]
                            if hard
                            else []
                        ),
                    ]
                )
            )
            assessment = session.get(AccountAssessment, account_id)
            if assessment is None:
                assessment = AccountAssessment(account_id=account_id)
                session.add(assessment)
            quarantine_until = ensure_utc(assessment.quarantine_until)
            if assessment.monitor_status == "quarantined" and (
                quarantine_until is None or quarantine_until > utc_now()
            ):
                status = "quarantined"
            elif str(assessment.manual_note or "").startswith("registration:"):
                # Registration risk is independent evidence supplied by the
                # linked registration service and must survive probe scoring.
                status = "high_risk"
                score = min(
                    thresholds.risk_score_cap,
                    max(score, thresholds.risk_high_floor, 85.0),
                )
                reasons = list(
                    dict.fromkeys(
                        [
                            *(assessment.risk_reasons or []),
                            *reasons,
                        ]
                    )
                )
            latest = rows[-1] if rows else None
            latest_measurable = measurable[-1] if measurable else None
            assessment.monitor_status = status
            assessment.risk_score = score
            assessment.sample_count = len(measurable)
            assessment.anomaly_count = len(anomalies)
            assessment.hard_anomaly_count = len(hard)
            assessment.fast_risk_count = len(fast)
            assessment.marker_miss_count = len(marker)
            assessment.reasoning_zero_count = len(reasoning_zero)
            assessment.distinct_egress_count = egress_count
            assessment.anomaly_streak = streak
            assessment.avg_tps = sum(row.tps for row in measurable) / len(measurable) if measurable else 0.0
            assessment.max_tps = max((row.tps for row in measurable), default=0.0)
            assessment.latest_tps = latest_measurable.tps if latest_measurable else 0.0
            assessment.latest_classification = latest.classification if latest else ""
            assessment.latest_sample_at = latest.created_at if latest else None
            assessment.last_anomaly_at = anomalies[-1].created_at if anomalies else None
            assessment.risk_reasons = reasons
            assessment.updated_at = utc_now()
            session.flush()
            result = model_dict(assessment)
        return result

    @staticmethod
    def _observed_egress_key(sample: ProbeSample) -> str:
        """Prefer the audited node over the requested routing strategy."""

        if sample.verified_egress_node_id is not None:
            return f"egress:{sample.verified_egress_node_id}"
        if sample.target_kind == "direct":
            return "direct"
        return sample.target_key

    def set_manual_status(
        self,
        *,
        account_id: int,
        status: str,
        note: str,
        quarantine_until=None,  # type: ignore[no-untyped-def]
        previous_upstream_enabled: bool | None = None,
        disabled_by_monitor: bool | None = None,
        recovery_guarded: bool | None = None,
    ) -> dict[str, Any]:
        with self.database.transaction() as session:
            assessment = session.get(AccountAssessment, account_id)
            if assessment is None:
                assessment = AccountAssessment(account_id=account_id)
                session.add(assessment)
            assessment.monitor_status = status
            assessment.manual_note = note
            assessment.quarantine_until = quarantine_until
            if previous_upstream_enabled is not None:
                assessment.previous_upstream_enabled = previous_upstream_enabled
            if disabled_by_monitor is not None:
                assessment.disabled_by_monitor = disabled_by_monitor
            if recovery_guarded is not None:
                assessment.recovery_guarded = recovery_guarded
            assessment.updated_at = utc_now()
            session.flush()
            result = model_dict(assessment)
        return result

    def mark_registration_risk(
        self,
        *,
        account_id: int,
        bfs: int | str | None,
        registration_id: str,
        risk_score_cap: float = 100,
        risk_high_floor: float = 75,
    ) -> dict[str, Any]:
        with self.database.transaction() as session:
            assessment = session.get(AccountAssessment, account_id)
            if assessment is None:
                assessment = AccountAssessment(account_id=account_id)
                session.add(assessment)
            reason = f"grok-register 报告 bot_risk/bfs={bfs}"
            assessment.monitor_status = "high_risk"
            assessment.risk_score = min(
                risk_score_cap,
                max(
                    float(assessment.risk_score or 0),
                    risk_high_floor,
                    85.0,
                ),
            )
            assessment.risk_reasons = list(dict.fromkeys([*(assessment.risk_reasons or []), reason]))
            assessment.manual_note = f"registration:{registration_id}"
            assessment.updated_at = utc_now()
            session.flush()
            result = model_dict(assessment)
        return result

    def due_quarantines(self) -> list[dict[str, Any]]:
        now = utc_now()
        with self.database.session() as session:
            values = session.scalars(
                select(AccountAssessment).where(
                    AccountAssessment.monitor_status == "quarantined",
                    AccountAssessment.disabled_by_monitor.is_(True),
                    AccountAssessment.quarantine_until.is_not(None),
                    AccountAssessment.quarantine_until <= now,
                )
            ).all()
            return [model_dict(value) for value in values]

    def mark_restored(self, account_id: int, *, recovery_guarded: bool) -> None:
        with self.database.transaction() as session:
            assessment = session.get(AccountAssessment, account_id)
            if assessment is None:
                return
            assessment.monitor_status = "healthy"
            assessment.quarantine_until = None
            assessment.disabled_by_monitor = False
            assessment.previous_upstream_enabled = None
            assessment.recovery_guarded = recovery_guarded
            assessment.updated_at = utc_now()

    def create_alert(
        self,
        *,
        account_id: int,
        kind: str,
        severity: str,
        title: str,
        detail: dict[str, Any],
    ) -> str:
        alert_id = uuid.uuid4().hex
        with self.database.transaction() as session:
            session.add(
                Alert(
                    id=alert_id,
                    account_id=account_id,
                    kind=kind,
                    severity=severity,
                    title=title,
                    detail=detail,
                )
            )
        return alert_id

    def list_alerts(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.database.session() as session:
            values = session.scalars(select(Alert).order_by(Alert.created_at.desc()).limit(limit)).all()
            return [model_dict(value) for value in values]

    def dashboard_metrics(self, hours: int) -> dict[str, Any]:
        cutoff = utc_now() - timedelta(hours=hours)
        with self.database.session() as session:
            assessment_rows = session.execute(
                select(
                    func.count(AccountAssessment.account_id),
                    func.sum(
                        case(
                            (
                                AccountAssessment.monitor_status.in_(
                                    {"suspect", "high_risk", "quarantined"}
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    func.sum(
                        case(
                            (AccountAssessment.monitor_status == "quarantined", 1),
                            else_=0,
                        )
                    ),
                    func.avg(AccountAssessment.risk_score),
                )
            ).one()
            sample_rows = session.execute(
                select(
                    func.count(ProbeSample.id),
                    func.sum(
                        case(
                            (ProbeSample.classification.in_(ANOMALY_NAMES), 1),
                            else_=0,
                        )
                    ),
                    func.avg(ProbeSample.tps).filter(ProbeSample.tps > 0),
                    func.max(ProbeSample.tps),
                ).where(ProbeSample.created_at >= cutoff)
            ).one()
            status_counts = dict(
                session.execute(
                    select(
                        AccountAssessment.monitor_status,
                        func.count(AccountAssessment.account_id),
                    ).group_by(AccountAssessment.monitor_status)
                ).all()
            )
            trend = [
                {
                    "day": row.day,
                    "samples": row.samples,
                    "avg_tps": round(row.avg_tps or 0, 1),
                    "max_tps": round(row.max_tps or 0, 1),
                    "hard": row.hard or 0,
                }
                for row in session.execute(
                    select(
                        func.date(ProbeSample.created_at).label("day"),
                        func.count(ProbeSample.id).label("samples"),
                        func.avg(ProbeSample.tps).filter(ProbeSample.tps > 0).label("avg_tps"),
                        func.max(ProbeSample.tps).label("max_tps"),
                        func.sum(
                            case(
                                (ProbeSample.classification.in_(HARD_ANOMALY_NAMES), 1),
                                else_=0,
                            )
                        ).label("hard"),
                    )
                    .where(ProbeSample.created_at >= cutoff)
                    .group_by(func.date(ProbeSample.created_at))
                    .order_by(func.date(ProbeSample.created_at))
                )
            ]
        return {
            "assessments": {
                "total": assessment_rows[0] or 0,
                "risky": assessment_rows[1] or 0,
                "quarantined": assessment_rows[2] or 0,
                "avgRisk": round(assessment_rows[3] or 0, 1),
            },
            "samples": {
                "total": sample_rows[0] or 0,
                "anomalies": sample_rows[1] or 0,
                "avgTps": round(sample_rows[2] or 0, 1),
                "maxTps": round(sample_rows[3] or 0, 1),
            },
            "statusCounts": status_counts,
            "trend": trend,
        }
