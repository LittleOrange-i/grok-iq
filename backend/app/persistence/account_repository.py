from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import case, func, select

from app.analyzer import Thresholds, maximum_anomaly_streak, risk_status
from app.core.clock import ensure_utc, utc_now

from .database import Database
from .models import AccountAssessment, Alert, ProbeSample, model_dict

ANOMALY_NAMES = {"elevated", "buffered_soft", "buffered_hard", "fast_risk", "marker_miss"}
HARD_ANOMALY_NAMES = {"buffered_hard", "fast_risk", "marker_miss"}


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

    def recalculate(self, account_id: int, thresholds: Thresholds, window_hours: int) -> dict[str, Any]:
        cutoff = utc_now() - timedelta(hours=window_hours)
        with self.database.transaction() as session:
            rows = session.scalars(
                select(ProbeSample)
                .where(ProbeSample.account_id == account_id, ProbeSample.created_at >= cutoff)
                .order_by(ProbeSample.created_at.asc(), ProbeSample.id.asc())
            ).all()
            anomalies = [row for row in rows if row.classification in ANOMALY_NAMES]
            hard = [row for row in anomalies if row.classification in HARD_ANOMALY_NAMES]
            fast = [row for row in anomalies if row.classification == "fast_risk"]
            marker = [row for row in anomalies if row.classification == "marker_miss"]
            egress_count = len({self._observed_egress_key(row) for row in anomalies})
            streak = maximum_anomaly_streak(row.classification for row in rows)
            measurable = [row for row in rows if row.status == "done" and row.tps > 0]
            status, score, reasons = risk_status(
                anomaly_count=len(anomalies),
                hard_count=len(hard),
                fast_count=len(fast),
                marker_miss_count=len(marker),
                distinct_egress_count=egress_count,
                anomaly_streak=streak,
                sample_count=len(measurable),
                thresholds=thresholds,
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
            latest = rows[-1] if rows else None
            latest_measurable = measurable[-1] if measurable else None
            assessment.monitor_status = status
            assessment.risk_score = score
            assessment.sample_count = len(measurable)
            assessment.anomaly_count = len(anomalies)
            assessment.hard_anomaly_count = len(hard)
            assessment.fast_risk_count = len(fast)
            assessment.marker_miss_count = len(marker)
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
    ) -> dict[str, Any]:
        with self.database.transaction() as session:
            assessment = session.get(AccountAssessment, account_id)
            if assessment is None:
                assessment = AccountAssessment(account_id=account_id)
                session.add(assessment)
            reason = f"grok-register 报告 bot_risk/bfs={bfs}"
            assessment.monitor_status = "high_risk"
            assessment.risk_score = max(assessment.risk_score, 85)
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
