from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.clock import utc_now

from .database import Database
from .models import (
    MetadataRow,
    ProbeDurationEstimate,
    ProbePlan,
    ProbeProfile,
    ProbeRun,
    ProbeSample,
    ScheduleExecution,
    model_dict,
)
from .seeds import DEFAULT_PROFILE_IDS, DEFAULT_PROFILES

ACTIVE_RUN_STATUSES = {"queued", "running", "cancel_requested", "recovering"}
CANCELLABLE_RUN_STATUSES = {"queued", "running", "recovering"}
EXECUTING_RUN_STATUSES = {"running", "cancel_requested", "recovering"}
ESTIMATED_RUN_STATUSES = {"queued", "running"}
TERMINAL_RUN_STATUSES = {"completed", "completed_with_errors", "failed", "cancelled"}
BLOCKING_ACCOUNT_RESTORE_STATUSES = {"restoring", "restore_failed"}
DEGRADATION_CLASSIFICATIONS = frozenset(
    {"elevated", "buffered_soft", "buffered_hard", "fast_risk", "marker_miss"}
)
DEFAULT_PROFILES_UNLIMITED_MIGRATION_KEY = "default_probe_profiles_follow_upstream_v1"
DEFAULT_PROFILES_EXPECTED_OUTPUT_MIGRATION_KEY = "default_probe_profiles_expected_output_v1"
DEFAULT_QUALITY_MARKER_MIGRATION_KEY = "default_probe_profiles_quality_marker_cn_v1"
DEFAULT_HTML_PREVIEW_MIGRATION_KEY = "default_probe_profiles_html_preview_pelican_v1"
PROBE_DURATION_ESTIMATE_BACKFILL_KEY = "probe_duration_estimates_backfill_v1"
SAFE_CURRENT_EGRESS_MIGRATION_KEY = "probe_targets_current_egress_v1"
LEGACY_QUALITY_MARKER_FIELDS = {
    "prompt": "先用三点总结为什么天空呈蓝色，最后一行只输出 QUALITY_OK。",
    "expected_text": "QUALITY_OK",
    "expected_output": "最后一行应包含 `QUALITY_OK`。",
}
LEGACY_HTML_PREVIEW_FIELDS = {
    "name": "HTML 生成基线",
    "prompt": "生成一个深色风格的服务状态卡片 HTML，包含正常、观察、风险三种状态。",
    "expected_output": """<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>服务状态卡片</title>
    <style>
      body { margin: 0; padding: 32px; background: #09090b; color: #fafafa; font-family: sans-serif; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .card { padding: 20px; border: 1px solid #27272a; border-radius: 14px; background: #18181b; }
      .ok { color: #34d399; } .watch { color: #fbbf24; } .risk { color: #fb7185; }
    </style>
  </head>
  <body>
    <main class="grid">
      <section class="card ok">正常</section>
      <section class="card watch">观察</section>
      <section class="card risk">风险</section>
    </main>
  </body>
</html>""",
}


def _profile_ids(profile_ids: Any, profile_id: Any = "") -> list[str]:
    values = profile_ids if isinstance(profile_ids, list) and profile_ids else [profile_id]
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = str(value or "").strip()
        if normalized and normalized not in seen:
            result.append(normalized)
            seen.add(normalized)
    return result


def _profile_dict(profile: ProbeProfile) -> dict[str, Any]:
    result = model_dict(profile)
    result["built_in"] = profile.id in DEFAULT_PROFILE_IDS
    return result


def _finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


class QueueFullError(ValueError):
    pass


class RunStateError(ValueError):
    pass


@dataclass(slots=True, frozen=True)
class RunExecutionContext:
    run: dict[str, Any]
    profile: dict[str, Any]


@dataclass(slots=True, frozen=True)
class AccountSettingsSnapshot:
    enabled: bool
    priority: int
    max_concurrent: int
    egress_node_id: int | None
    egress_assignment_mode: str
    diagnostic_priority: int
    diagnostic_max_concurrent: int


class ProbeRepository:
    def __init__(self, database: Database):
        self.database = database

    def seed_defaults(self) -> None:
        with self.database.transaction() as session:
            for values in DEFAULT_PROFILES:
                if session.get(ProbeProfile, values["id"]) is None:
                    session.add(ProbeProfile(**values))
            migration = session.get(MetadataRow, DEFAULT_PROFILES_UNLIMITED_MIGRATION_KEY)
            if migration is None:
                for values in DEFAULT_PROFILES:
                    profile = session.get(ProbeProfile, values["id"])
                    if profile is not None:
                        profile.max_output_tokens = 0
                        profile.updated_at = utc_now()
                session.add(
                    MetadataRow(
                        key=DEFAULT_PROFILES_UNLIMITED_MIGRATION_KEY,
                        value=utc_now().isoformat(),
                    )
                )
            expected_output_migration = session.get(
                MetadataRow, DEFAULT_PROFILES_EXPECTED_OUTPUT_MIGRATION_KEY
            )
            if expected_output_migration is None:
                for values in DEFAULT_PROFILES:
                    profile = session.get(ProbeProfile, values["id"])
                    if profile is not None and not profile.expected_output:
                        profile.expected_output = str(values.get("expected_output") or "")
                        profile.updated_at = utc_now()
                session.add(
                    MetadataRow(
                        key=DEFAULT_PROFILES_EXPECTED_OUTPUT_MIGRATION_KEY,
                        value=utc_now().isoformat(),
                    )
                )
            marker_migration = session.get(
                MetadataRow, DEFAULT_QUALITY_MARKER_MIGRATION_KEY
            )
            if marker_migration is None:
                defaults = next(
                    values
                    for values in DEFAULT_PROFILES
                    if values["id"] == "quality-marker"
                )
                profile = session.get(ProbeProfile, "quality-marker")
                changed = False
                if profile is not None:
                    for field, legacy_value in LEGACY_QUALITY_MARKER_FIELDS.items():
                        if getattr(profile, field) == legacy_value:
                            setattr(profile, field, defaults[field])
                            changed = True
                    if changed:
                        profile.updated_at = utc_now()
                session.add(
                    MetadataRow(
                        key=DEFAULT_QUALITY_MARKER_MIGRATION_KEY,
                        value=utc_now().isoformat(),
                    )
                )
            html_preview_migration = session.get(
                MetadataRow, DEFAULT_HTML_PREVIEW_MIGRATION_KEY
            )
            if html_preview_migration is None:
                defaults = next(
                    values for values in DEFAULT_PROFILES if values["id"] == "html-preview"
                )
                profile = session.get(ProbeProfile, "html-preview")
                changed = False
                if profile is not None:
                    for field, legacy_value in LEGACY_HTML_PREVIEW_FIELDS.items():
                        if getattr(profile, field) == legacy_value:
                            setattr(profile, field, defaults[field])
                            changed = True
                    if changed:
                        profile.updated_at = utc_now()
                session.add(
                    MetadataRow(
                        key=DEFAULT_HTML_PREVIEW_MIGRATION_KEY,
                        value=utc_now().isoformat(),
                    )
                )
            duration_backfill = session.get(
                MetadataRow, PROBE_DURATION_ESTIMATE_BACKFILL_KEY
            )
            if duration_backfill is None:
                session.execute(delete(ProbeDurationEstimate))
                rows = session.execute(
                    select(
                        ProbeRun.profile_id,
                        ProbeRun.execution_mode,
                        func.count(ProbeSample.id),
                        func.sum(ProbeSample.duration_ms),
                    )
                    .join(ProbeSample, ProbeSample.run_id == ProbeRun.id)
                    .where(ProbeSample.duration_ms > 0)
                    .group_by(ProbeRun.profile_id, ProbeRun.execution_mode)
                ).all()
                now = utc_now()
                session.add_all(
                    [
                        ProbeDurationEstimate(
                            profile_id=str(profile_id),
                            execution_mode=str(execution_mode or "chat"),
                            sample_count=int(sample_count or 0),
                            total_duration_ms=int(total_duration_ms or 0),
                            created_at=now,
                            updated_at=now,
                        )
                        for profile_id, execution_mode, sample_count, total_duration_ms in rows
                    ]
                )
                session.add(
                    MetadataRow(
                        key=PROBE_DURATION_ESTIMATE_BACKFILL_KEY,
                        value=now.isoformat(),
                    )
                )
            current_egress_migration = session.get(
                MetadataRow, SAFE_CURRENT_EGRESS_MIGRATION_KEY
            )
            if current_egress_migration is None:
                for plan in session.scalars(
                    select(ProbePlan).where(ProbePlan.execution_mode == "chat")
                ).all():
                    if self._is_legacy_direct_only(plan.proxy_targets):
                        plan.proxy_targets = [
                            {"kind": "current", "id": None, "name": "账号当前出口"}
                        ]
                        plan.updated_at = utc_now()
                for run in session.scalars(
                    select(ProbeRun).where(
                        ProbeRun.execution_mode == "chat",
                        ProbeRun.status == "queued",
                    )
                ).all():
                    if self._is_legacy_direct_only(run.proxy_targets):
                        run.proxy_targets = [
                            {"kind": "current", "id": None, "name": "账号当前出口"}
                        ]
                        run.current_target_key = None
                session.add(
                    MetadataRow(
                        key=SAFE_CURRENT_EGRESS_MIGRATION_KEY,
                        value=utc_now().isoformat(),
                    )
                )

    @staticmethod
    def _is_legacy_direct_only(targets: Any) -> bool:
        return (
            isinstance(targets, list)
            and len(targets) == 1
            and isinstance(targets[0], dict)
            and targets[0].get("kind") == "direct"
        )

    # Profiles -----------------------------------------------------------------
    def list_profiles(self) -> list[dict[str, Any]]:
        with self.database.session() as session:
            values = session.scalars(
                select(ProbeProfile).order_by(
                    ProbeProfile.created_at.desc(), ProbeProfile.id.desc()
                )
            ).all()
            return [_profile_dict(value) for value in values]

    def get_profile(self, profile_id: str) -> dict[str, Any] | None:
        with self.database.session() as session:
            value = session.get(ProbeProfile, profile_id)
            return _profile_dict(value) if value else None

    def create_profile(self, values: dict[str, Any]) -> str:
        profile_id = uuid.uuid4().hex
        with self.database.transaction() as session:
            session.add(ProbeProfile(id=profile_id, **values))
        return profile_id

    def update_profile(self, profile_id: str, values: dict[str, Any]) -> dict[str, Any]:
        with self.database.transaction() as session:
            profile = session.get(ProbeProfile, profile_id)
            if profile is None:
                raise ValueError("探针方案不存在")
            for key, value in values.items():
                setattr(profile, key, value)
            profile.updated_at = utc_now()
            result = _profile_dict(profile)
        return result

    def delete_profile(self, profile_id: str) -> None:
        with self.database.transaction() as session:
            profile = session.get(ProbeProfile, profile_id)
            if profile is None:
                raise ValueError("探针方案不存在")
            used_by_run = session.scalar(
                select(func.count(ProbeRun.id)).where(ProbeRun.profile_id == profile_id)
            )
            plan_selections = session.execute(
                select(ProbePlan.profile_id, ProbePlan.profile_ids)
            ).all()
            used_by_plan = any(
                profile_id in _profile_ids(selected_ids, primary_id)
                for primary_id, selected_ids in plan_selections
            )
            if used_by_run or used_by_plan:
                raise RunStateError("探针方案已有计划或历史任务，请停用而不是删除")
            session.delete(profile)

    def delete_profiles(self, profile_ids: list[str]) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(value for value in profile_ids if value))
        with self.database.transaction() as session:
            profiles_by_id = {
                profile.id: profile
                for profile in session.scalars(
                    select(ProbeProfile).where(ProbeProfile.id.in_(unique_ids))
                ).all()
            }
            used_by_run = set(
                session.scalars(
                    select(ProbeRun.profile_id)
                    .where(ProbeRun.profile_id.in_(unique_ids))
                    .distinct()
                ).all()
            )
            plan_selections = session.execute(
                select(ProbePlan.profile_id, ProbePlan.profile_ids)
            ).all()
            used_by_plan = {
                profile_id
                for primary_id, selected_ids in plan_selections
                for profile_id in _profile_ids(selected_ids, primary_id)
                if profile_id in profiles_by_id
            }
            protected_ids = used_by_run | used_by_plan
            deleted_ids = [
                profile_id
                for profile_id in unique_ids
                if profile_id in profiles_by_id and profile_id not in protected_ids
            ]
            for profile_id in deleted_ids:
                session.delete(profiles_by_id[profile_id])

        missing_ids = [
            profile_id for profile_id in unique_ids if profile_id not in profiles_by_id
        ]
        protected_in_request = [
            profile_id for profile_id in unique_ids if profile_id in protected_ids
        ]
        return {
            "requested": len(unique_ids),
            "deleted": len(deleted_ids),
            "skipped": len(missing_ids) + len(protected_in_request),
            "protected": len(protected_in_request),
            "missing": len(missing_ids),
            "protectedIds": protected_in_request,
            "missingIds": missing_ids,
        }

    @staticmethod
    def _plan_dict(plan: ProbePlan) -> dict[str, Any]:
        result = model_dict(plan)
        selected_profile_ids = _profile_ids(
            result.get("profile_ids"), result.get("profile_id")
        )
        result["profile_ids"] = selected_profile_ids
        if selected_profile_ids:
            result["profile_id"] = selected_profile_ids[0]
        return result

    @staticmethod
    def _require_profiles(
        session: Any,
        profile_ids: list[str],
        *,
        require_enabled: bool,
    ) -> list[str]:
        selected_profile_ids = _profile_ids(profile_ids)
        if not selected_profile_ids:
            raise ValueError("至少选择一个探针方案")
        profiles = session.scalars(
            select(ProbeProfile).where(ProbeProfile.id.in_(selected_profile_ids))
        ).all()
        by_id = {profile.id: profile for profile in profiles}
        missing = [profile_id for profile_id in selected_profile_ids if profile_id not in by_id]
        if missing:
            raise ValueError(f"探针方案不存在: {', '.join(missing)}")
        disabled = [
            profile_id
            for profile_id in selected_profile_ids
            if require_enabled and not by_id[profile_id].enabled
        ]
        if disabled:
            raise ValueError(f"探针方案已停用: {', '.join(disabled)}")
        return selected_profile_ids

    # Cron plans ----------------------------------------------------------------
    def list_plans(self) -> list[dict[str, Any]]:
        with self.database.session() as session:
            values = session.scalars(
                select(ProbePlan).order_by(ProbePlan.enabled.desc(), ProbePlan.name.asc())
            ).all()
            return [self._plan_dict(value) for value in values]

    def get_plan(self, plan_id: str) -> dict[str, Any] | None:
        with self.database.session() as session:
            value = session.get(ProbePlan, plan_id)
            return self._plan_dict(value) if value else None

    def create_plan(self, values: dict[str, Any]) -> str:
        plan_id = uuid.uuid4().hex
        with self.database.transaction() as session:
            selected_profile_ids = self._require_profiles(
                session,
                _profile_ids(values.get("profile_ids"), values.get("profile_id")),
                require_enabled=False,
            )
            values = {
                **values,
                "profile_id": selected_profile_ids[0],
                "profile_ids": selected_profile_ids,
            }
            session.add(ProbePlan(id=plan_id, **values))
        return plan_id

    def update_plan(self, plan_id: str, values: dict[str, Any]) -> dict[str, Any]:
        with self.database.transaction() as session:
            plan = session.get(ProbePlan, plan_id)
            if plan is None:
                raise ValueError("Cron 探针计划不存在")
            if "profile_id" in values or "profile_ids" in values:
                selected_profile_ids = self._require_profiles(
                    session,
                    _profile_ids(
                        values.get("profile_ids"),
                        values.get("profile_id", plan.profile_id),
                    ),
                    require_enabled=False,
                )
                values = {
                    **values,
                    "profile_id": selected_profile_ids[0],
                    "profile_ids": selected_profile_ids,
                }
            for key, value in values.items():
                setattr(plan, key, value)
            plan.updated_at = utc_now()
            result = self._plan_dict(plan)
        return result

    def delete_plan(self, plan_id: str) -> None:
        with self.database.transaction() as session:
            plan = session.get(ProbePlan, plan_id)
            if plan is None:
                raise ValueError("Cron 探针计划不存在")
            active = session.scalar(
                select(func.count(ProbeRun.id)).where(
                    ProbeRun.plan_id == plan_id, ProbeRun.status.in_(ACTIVE_RUN_STATUSES)
                )
            )
            if active:
                raise RunStateError("计划仍有排队或执行中的任务")
            session.delete(plan)

    def delete_plans(self, plan_ids: list[str]) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(value for value in plan_ids if value))
        with self.database.transaction() as session:
            plans_by_id = {
                plan.id: plan
                for plan in session.scalars(
                    select(ProbePlan).where(ProbePlan.id.in_(unique_ids))
                ).all()
            }
            active_ids = set(
                session.scalars(
                    select(ProbeRun.plan_id)
                    .where(
                        ProbeRun.plan_id.in_(unique_ids),
                        ProbeRun.status.in_(ACTIVE_RUN_STATUSES),
                    )
                    .distinct()
                ).all()
            )
            deleted_ids = [
                plan_id
                for plan_id in unique_ids
                if plan_id in plans_by_id and plan_id not in active_ids
            ]
            for plan_id in deleted_ids:
                session.delete(plans_by_id[plan_id])

        missing_ids = [
            plan_id for plan_id in unique_ids if plan_id not in plans_by_id
        ]
        active_in_request = [
            plan_id for plan_id in unique_ids if plan_id in active_ids
        ]
        return {
            "requested": len(unique_ids),
            "deleted": len(deleted_ids),
            "skipped": len(missing_ids) + len(active_in_request),
            "active": len(active_in_request),
            "missing": len(missing_ids),
            "activeIds": active_in_request,
            "missingIds": missing_ids,
        }

    # Persistent queue ----------------------------------------------------------
    def create_run(
        self,
        *,
        account_id: int,
        account_name: str,
        account_email: str,
        profile_id: str,
        rounds: int,
        proxy_targets: list[dict[str, Any]],
        trigger: str,
        priority: int,
        queue_limit: int,
        plan_id: str | None = None,
        parent_run_id: str | None = None,
        execution_mode: str = "chat",
    ) -> str:
        run_id = uuid.uuid4().hex
        now = utc_now()
        with self.database.transaction() as session:
            profile = session.get(ProbeProfile, profile_id)
            if profile is None or not profile.enabled:
                raise ValueError("探针方案不存在或已停用")
            if plan_id and session.get(ProbePlan, plan_id) is None:
                raise ValueError("Cron 探针计划不存在")
            active_count = (
                session.scalar(
                    select(func.count(ProbeRun.id)).where(ProbeRun.status.in_(ACTIVE_RUN_STATUSES))
                )
                or 0
            )
            if active_count >= queue_limit:
                raise QueueFullError(f"探针队列已达到上限 {queue_limit}")
            session.add(
                ProbeRun(
                    id=run_id,
                    account_id=account_id,
                    account_name=account_name,
                    account_email=account_email,
                    profile_id=profile_id,
                    plan_id=plan_id,
                    parent_run_id=parent_run_id,
                    status="queued",
                    trigger=trigger,
                    automatic=trigger != "manual",
                    priority=priority,
                    execution_mode=execution_mode,
                    rounds=rounds,
                    proxy_targets=proxy_targets,
                    total_steps=rounds * len(proxy_targets),
                    created_at=now,
                    queued_at=now,
                )
            )
        return run_id

    def create_manual_runs_batch(
        self,
        *,
        accounts: list[dict[str, Any]],
        rounds: int,
        proxy_targets: list[dict[str, Any]],
        execution_mode: str,
        priority: int,
        queue_limit: int,
        profile_ids: list[str] | None = None,
        profile_id: str = "",
    ) -> dict[str, Any]:
        """Atomically enqueue many account runs with one ORM transaction."""

        unique_accounts = {
            int(account["id"]): account for account in accounts if int(account.get("id") or 0) > 0
        }
        requested_profile_ids = _profile_ids(profile_ids, profile_id)
        requested_ids = set(unique_accounts)
        if not requested_ids:
            return {
                "runIds": [],
                "createdAccountIds": [],
                "activeAccountIds": [],
                "restoreBlockedAccountIds": [],
                "profileIds": requested_profile_ids,
            }

        now = utc_now()
        with self.database.transaction() as session:
            selected_profile_ids = self._require_profiles(
                session, requested_profile_ids, require_enabled=True
            )

            active_account_ids = set(
                session.scalars(
                    select(ProbeRun.account_id).where(
                        ProbeRun.account_id.in_(requested_ids),
                        ProbeRun.status.in_(ACTIVE_RUN_STATUSES),
                    )
                ).all()
            )
            restore_blocked_account_ids = set(
                session.scalars(
                    select(ProbeRun.account_id).where(
                        ProbeRun.account_id.in_(requested_ids),
                        (
                            ProbeRun.account_restore_status.in_(BLOCKING_ACCOUNT_RESTORE_STATUSES)
                            | ProbeRun.diagnostic_activation_active.is_(True)
                        ),
                    )
                ).all()
            )
            candidate_ids = sorted(requested_ids - active_account_ids - restore_blocked_account_ids)
            active_count = int(
                session.scalar(
                    select(func.count(ProbeRun.id)).where(ProbeRun.status.in_(ACTIVE_RUN_STATUSES))
                )
                or 0
            )
            available = max(queue_limit - active_count, 0)
            required_capacity = len(candidate_ids) * len(selected_profile_ids)
            if required_capacity > available:
                raise QueueFullError(
                    f"队列剩余容量 {available}，本次需要 {required_capacity}；"
                    "本次未创建任务，请提高全局队列上限或等待现有任务完成"
                )

            rows: list[ProbeRun] = []
            run_ids: list[str] = []
            for account_id in candidate_ids:
                account = unique_accounts[account_id]
                for profile_id in selected_profile_ids:
                    run_id = uuid.uuid4().hex
                    run_ids.append(run_id)
                    rows.append(
                        ProbeRun(
                            id=run_id,
                            account_id=account_id,
                            account_name=str(account.get("name") or f"account-{account_id}"),
                            account_email=str(account.get("email") or ""),
                            profile_id=profile_id,
                            status="queued",
                            trigger="manual",
                            automatic=False,
                            priority=priority,
                            execution_mode=execution_mode,
                            rounds=rounds,
                            proxy_targets=proxy_targets,
                            total_steps=rounds * len(proxy_targets),
                            created_at=now,
                            queued_at=now,
                        )
                    )
            session.add_all(rows)

        return {
            "runIds": run_ids,
            "createdAccountIds": candidate_ids,
            "activeAccountIds": sorted(active_account_ids),
            "restoreBlockedAccountIds": sorted(restore_blocked_account_ids),
            "profileIds": selected_profile_ids,
        }

    def create_register_runs(
        self,
        *,
        source_event_id: str,
        account: dict[str, Any],
        profile_ids: list[str],
        rounds: int,
        proxy_targets: list[dict[str, Any]],
        execution_mode: str,
        priority: int,
        queue_limit: int,
    ) -> dict[str, Any]:
        """Idempotently expand one accepted registration event into probe runs."""

        account_id = int(account.get("id") or 0)
        if account_id <= 0:
            raise ValueError("注册账号 ID 无效")
        event_id = str(source_event_id or "").strip()
        if not event_id:
            raise ValueError("注册事件 ID 不能为空")
        now = utc_now()
        with self.database.transaction() as session:
            existing = session.scalars(
                select(ProbeRun)
                .where(ProbeRun.source_event_id == event_id)
                .order_by(ProbeRun.created_at.asc())
            ).all()
            if existing:
                return {
                    "runIds": [run.id for run in existing],
                    "profileIds": [run.profile_id for run in existing],
                    "created": 0,
                }

            selected_profile_ids = self._require_profiles(
                session, profile_ids, require_enabled=True
            )
            active_for_account = int(
                session.scalar(
                    select(func.count(ProbeRun.id)).where(
                        ProbeRun.account_id == account_id,
                        ProbeRun.status.in_(ACTIVE_RUN_STATUSES),
                    )
                )
                or 0
            )
            if active_for_account:
                raise RunStateError("账号已有未完成探针，注册探针将在其结束后重试")
            restore_blocked = int(
                session.scalar(
                    select(func.count(ProbeRun.id)).where(
                        ProbeRun.account_id == account_id,
                        (
                            ProbeRun.account_restore_status.in_(
                                BLOCKING_ACCOUNT_RESTORE_STATUSES
                            )
                            | ProbeRun.diagnostic_activation_active.is_(True)
                        ),
                    )
                )
                or 0
            )
            if restore_blocked:
                raise RunStateError("账号存在未完成的原设置恢复，注册探针稍后重试")
            active_count = int(
                session.scalar(
                    select(func.count(ProbeRun.id)).where(
                        ProbeRun.status.in_(ACTIVE_RUN_STATUSES)
                    )
                )
                or 0
            )
            if active_count + len(selected_profile_ids) > queue_limit:
                raise QueueFullError(f"探针队列已达到上限 {queue_limit}")

            rows: list[ProbeRun] = []
            for profile_id in selected_profile_ids:
                rows.append(
                    ProbeRun(
                        id=uuid.uuid4().hex,
                        account_id=account_id,
                        account_name=str(account.get("name") or f"account-{account_id}"),
                        account_email=str(account.get("email") or ""),
                        profile_id=profile_id,
                        source_event_id=event_id,
                        status="queued",
                        trigger="register",
                        automatic=True,
                        priority=priority,
                        execution_mode=execution_mode,
                        rounds=rounds,
                        proxy_targets=proxy_targets,
                        total_steps=rounds * len(proxy_targets),
                        created_at=now,
                        queued_at=now,
                    )
                )
            session.add_all(rows)
            return {
                "runIds": [run.id for run in rows],
                "profileIds": selected_profile_ids,
                "created": len(rows),
            }

    def create_plan_runs_batch(
        self,
        *,
        plan_id: str,
        accounts: list[dict[str, Any]],
        profile_ids: list[str],
        rounds: int,
        proxy_targets: list[dict[str, Any]],
        execution_mode: str,
        priority: int,
        queue_limit: int,
        register_cooldown_minutes: int = 0,
    ) -> dict[str, Any]:
        """Atomically expand one Cron trigger into account/profile runs."""

        unique_accounts = {
            int(account["id"]): account
            for account in accounts
            if int(account.get("id") or 0) > 0
        }
        requested_ids = set(unique_accounts)
        if not requested_ids:
            return {
                "runIds": [],
                "createdAccountIds": [],
                "activeAccountIds": [],
                "restoreBlockedAccountIds": [],
                "registerCooldownAccountIds": [],
                "profileIds": _profile_ids(profile_ids),
            }

        now = utc_now()
        with self.database.transaction() as session:
            if session.get(ProbePlan, plan_id) is None:
                raise ValueError("Cron 探针计划不存在")
            selected_profile_ids = self._require_profiles(
                session, profile_ids, require_enabled=True
            )
            active_account_ids = set(
                session.scalars(
                    select(ProbeRun.account_id).where(
                        ProbeRun.account_id.in_(requested_ids),
                        ProbeRun.status.in_(ACTIVE_RUN_STATUSES),
                    )
                ).all()
            )
            cooldown_account_ids: set[int] = set()
            if register_cooldown_minutes > 0:
                cooldown_cutoff = now - timedelta(minutes=register_cooldown_minutes)
                cooldown_account_ids = set(
                    session.scalars(
                        select(ProbeRun.account_id).where(
                            ProbeRun.account_id.in_(requested_ids),
                            ProbeRun.trigger == "register",
                            ProbeRun.completed_at.is_not(None),
                            ProbeRun.completed_at >= cooldown_cutoff,
                        )
                    ).all()
                )
            restore_blocked_account_ids = set(
                session.scalars(
                    select(ProbeRun.account_id).where(
                        ProbeRun.account_id.in_(requested_ids),
                        (
                            ProbeRun.account_restore_status.in_(
                                BLOCKING_ACCOUNT_RESTORE_STATUSES
                            )
                            | ProbeRun.diagnostic_activation_active.is_(True)
                        ),
                    )
                ).all()
            )
            candidate_ids = sorted(
                requested_ids
                - active_account_ids
                - restore_blocked_account_ids
                - cooldown_account_ids
            )
            active_count = int(
                session.scalar(
                    select(func.count(ProbeRun.id)).where(
                        ProbeRun.status.in_(ACTIVE_RUN_STATUSES)
                    )
                )
                or 0
            )
            available = max(queue_limit - active_count, 0)
            required_capacity = len(candidate_ids) * len(selected_profile_ids)
            if required_capacity > available:
                raise QueueFullError(
                    f"队列剩余容量 {available}，本次需要 {required_capacity}；"
                    "本次未创建任务，请提高全局队列上限或等待现有任务完成"
                )

            rows: list[ProbeRun] = []
            run_ids: list[str] = []
            for account_id in candidate_ids:
                account = unique_accounts[account_id]
                for profile_id in selected_profile_ids:
                    run_id = uuid.uuid4().hex
                    run_ids.append(run_id)
                    rows.append(
                        ProbeRun(
                            id=run_id,
                            account_id=account_id,
                            account_name=str(
                                account.get("name") or f"account-{account_id}"
                            ),
                            account_email=str(account.get("email") or ""),
                            profile_id=profile_id,
                            plan_id=plan_id,
                            status="queued",
                            trigger="cron",
                            automatic=True,
                            priority=priority,
                            execution_mode=execution_mode,
                            rounds=rounds,
                            proxy_targets=proxy_targets,
                            total_steps=rounds * len(proxy_targets),
                            created_at=now,
                            queued_at=now,
                        )
                    )
            session.add_all(rows)

        return {
            "runIds": run_ids,
            "createdAccountIds": candidate_ids,
            "activeAccountIds": sorted(active_account_ids),
            "restoreBlockedAccountIds": sorted(restore_blocked_account_ids),
            "registerCooldownAccountIds": sorted(cooldown_account_ids),
            "profileIds": selected_profile_ids,
        }

    def has_active_run(self, *, account_id: int, plan_id: str | None = None) -> bool:
        with self.database.session() as session:
            statement = select(func.count(ProbeRun.id)).where(
                ProbeRun.account_id == account_id,
                ProbeRun.status.in_(ACTIVE_RUN_STATUSES),
            )
            if plan_id is not None:
                statement = statement.where(ProbeRun.plan_id == plan_id)
            return bool(session.scalar(statement))

    def has_executing_run(self, *, account_id: int, exclude_run_id: str | None = None) -> bool:
        """Return whether an account currently has an executing worker lease."""

        with self.database.session() as session:
            statement = select(func.count(ProbeRun.id)).where(
                ProbeRun.account_id == account_id,
                ProbeRun.status.in_(EXECUTING_RUN_STATUSES),
            )
            if exclude_run_id is not None:
                statement = statement.where(ProbeRun.id != exclude_run_id)
            return bool(session.scalar(statement))

    def account_settings_locked_ids(self, account_ids: set[int]) -> set[int]:
        """Return accounts whose upstream settings may still be restored by a run."""

        if not account_ids:
            return set()
        with self.database.session() as session:
            return set(
                session.scalars(
                    select(ProbeRun.account_id)
                    .where(
                        ProbeRun.account_id.in_(account_ids),
                        or_(
                            ProbeRun.status.in_(EXECUTING_RUN_STATUSES),
                            ProbeRun.account_restore_status.in_(
                                BLOCKING_ACCOUNT_RESTORE_STATUSES
                            ),
                            ProbeRun.diagnostic_activation_active.is_(True),
                        ),
                    )
                    .distinct()
                ).all()
            )

    def active_egress_references(self) -> dict[str, set[int]]:
        """Return node and current-account references that active runs still need."""

        with self.database.session() as session:
            values = session.execute(
                select(
                    ProbeRun.account_id,
                    ProbeRun.proxy_targets,
                    ProbeRun.original_egress_node_id,
                ).where(
                    or_(
                        ProbeRun.status.in_(ACTIVE_RUN_STATUSES),
                        ProbeRun.account_restore_status.in_(
                            BLOCKING_ACCOUNT_RESTORE_STATUSES
                        ),
                        ProbeRun.diagnostic_activation_active.is_(True),
                    )
                )
            ).all()

        node_ids: set[int] = set()
        current_account_ids: set[int] = set()
        for account_id, targets, original_node_id in values:
            if int(original_node_id or 0) > 0:
                node_ids.add(int(original_node_id))
            for target in targets or []:
                kind = str(target.get("kind") or "")
                if kind == "egress" and int(target.get("id") or 0) > 0:
                    node_ids.add(int(target["id"]))
                elif kind == "current" and int(account_id or 0) > 0:
                    current_account_ids.add(int(account_id))
        return {
            "nodeIds": node_ids,
            "currentAccountIds": current_account_ids,
        }

    def has_blocking_account_restore(
        self,
        *,
        account_id: int,
        exclude_run_id: str | None = None,
    ) -> bool:
        """Protect an uncertain upstream account state from later probe runs."""

        with self.database.session() as session:
            statement = select(func.count(ProbeRun.id)).where(
                ProbeRun.account_id == account_id,
                (
                    ProbeRun.account_restore_status.in_(BLOCKING_ACCOUNT_RESTORE_STATUSES)
                    | ProbeRun.diagnostic_activation_active.is_(True)
                ),
            )
            if exclude_run_id is not None:
                statement = statement.where(ProbeRun.id != exclude_run_id)
            return bool(session.scalar(statement))

    def active_plan_run_count(self, plan_id: str) -> int:
        with self.database.session() as session:
            return int(
                session.scalar(
                    select(func.count(ProbeRun.id)).where(
                        ProbeRun.plan_id == plan_id,
                        ProbeRun.status.in_(ACTIVE_RUN_STATUSES),
                    )
                )
                or 0
            )

    def claim_next(self, worker_id: str) -> RunExecutionContext | None:
        now = utc_now()
        with self.database.transaction() as session:
            executing_accounts = (
                select(ProbeRun.account_id.label("account_id"))
                .where(ProbeRun.status.in_(EXECUTING_RUN_STATUSES))
                .distinct()
                .subquery()
            )
            restore_blocked_accounts = (
                select(ProbeRun.account_id.label("account_id"))
                .where(
                    ProbeRun.account_restore_status.in_(BLOCKING_ACCOUNT_RESTORE_STATUSES)
                    | ProbeRun.diagnostic_activation_active.is_(True)
                )
                .distinct()
                .subquery()
            )
            chosen = session.scalar(
                select(ProbeRun)
                .where(
                    ProbeRun.status == "queued",
                    ProbeRun.account_id.not_in(select(executing_accounts.c.account_id)),
                    ProbeRun.account_id.not_in(
                        select(restore_blocked_accounts.c.account_id)
                    ),
                )
                .order_by(ProbeRun.priority.asc(), ProbeRun.queued_at.asc())
                .limit(1)
            )
            if chosen is None:
                return None
            chosen.status = "running"
            chosen.worker_id = worker_id
            chosen.started_at = chosen.started_at or now
            chosen.heartbeat_at = now
            profile = session.get(ProbeProfile, chosen.profile_id)
            if profile is None:
                chosen.status = "failed"
                chosen.error = "探针方案已不存在"
                chosen.completed_at = now
                return None
            return RunExecutionContext(model_dict(chosen), model_dict(profile))

    def get_run_context(self, run_id: str) -> RunExecutionContext | None:
        with self.database.session() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                return None
            profile = session.get(ProbeProfile, run.profile_id)
            if profile is None:
                return None
            return RunExecutionContext(model_dict(run), model_dict(profile))

    def set_upstream_context(
        self,
        *,
        run_id: str,
        original_node_id: int | None,
        original_mode: str,
        route_id: str,
        public_model: str,
        client_key_id: str,
    ) -> None:
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                return
            run.original_egress_node_id = original_node_id
            run.original_egress_assignment_mode = original_mode
            run.temporary_route_id = route_id
            run.temporary_public_model = public_model
            run.temporary_client_key_id = client_key_id
            run.heartbeat_at = utc_now()

    def ensure_account_settings_snapshot(
        self,
        *,
        run_id: str,
        enabled: bool,
        priority: int,
        max_concurrent: int,
        egress_node_id: int | None,
        egress_assignment_mode: str,
        diagnostic_priority: int,
        diagnostic_max_concurrent: int,
    ) -> AccountSettingsSnapshot:
        """Persist the rollback source before any upstream account mutation.

        The first snapshot wins. A recovered/requeued run therefore keeps the
        original settings captured before its first diagnostic activation.
        """

        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                raise ValueError("探针任务不存在")
            if run.account_settings_snapshot_at is None:
                run.original_account_enabled = enabled
                run.original_account_priority = priority
                run.original_account_max_concurrent = max_concurrent
                run.original_egress_node_id = egress_node_id
                run.original_egress_assignment_mode = egress_assignment_mode
                run.account_settings_snapshot_at = utc_now()
                run.diagnostic_priority = diagnostic_priority
                run.diagnostic_max_concurrent = diagnostic_max_concurrent
            run.heartbeat_at = utc_now()
            return self._account_settings_snapshot(run)

    def account_settings_snapshot(self, run_id: str) -> AccountSettingsSnapshot | None:
        with self.database.session() as session:
            run = session.get(ProbeRun, run_id)
            if run is None or run.account_settings_snapshot_at is None:
                return None
            return self._account_settings_snapshot(run)

    @staticmethod
    def _account_settings_snapshot(run: ProbeRun) -> AccountSettingsSnapshot:
        return AccountSettingsSnapshot(
            enabled=bool(run.original_account_enabled),
            priority=int(run.original_account_priority or 0),
            max_concurrent=int(run.original_account_max_concurrent or 1),
            egress_node_id=run.original_egress_node_id,
            egress_assignment_mode=str(run.original_egress_assignment_mode or ""),
            diagnostic_priority=int(run.diagnostic_priority or 0),
            diagnostic_max_concurrent=int(run.diagnostic_max_concurrent or 1),
        )

    def set_diagnostic_activation(self, run_id: str, active: bool) -> None:
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                return
            run.diagnostic_activation_active = active
            if active:
                run.account_restore_status = "pending"
                run.account_restore_source = ""
                run.account_restore_error = ""
                run.account_restored_at = None
            run.heartbeat_at = utc_now()

    def mark_account_mutation_pending(self, run_id: str) -> None:
        """Persist restore intent immediately before changing upstream account state."""

        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                raise ValueError("探针任务不存在")
            run.account_restore_status = "pending"
            run.account_restore_source = ""
            run.account_restore_error = ""
            run.account_restored_at = None
            run.heartbeat_at = utc_now()

    def begin_account_restore(self, run_id: str, source: str) -> None:
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                raise ValueError("探针任务不存在")
            run.account_restore_status = "restoring"
            run.account_restore_source = source
            run.account_restore_attempts += 1
            run.account_restore_attempted_at = utc_now()
            run.account_restore_error = ""
            run.heartbeat_at = utc_now()

    def finish_account_restore(self, run_id: str, source: str, error: str = "") -> None:
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                return
            run.account_restore_source = source
            run.account_restore_error = error[:4000]
            if error:
                run.account_restore_status = "restore_failed"
            else:
                run.account_restore_status = {
                    "manual": "manual_restored",
                    "startup": "startup_restored",
                }.get(source, "automatic_restored")
                run.diagnostic_activation_active = False
                run.account_restored_at = utc_now()
            run.heartbeat_at = utc_now()

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self.database.session() as session:
            run = session.get(ProbeRun, run_id)
            return model_dict(run) if run else None

    def clear_upstream_context(self, run_id: str) -> None:
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                return
            run.temporary_route_id = ""
            run.temporary_public_model = ""
            run.temporary_client_key_id = ""
            run.current_round = None
            run.current_target_key = None
            run.heartbeat_at = utc_now()

    def set_current_step(self, run_id: str, round_number: int, target_key: str) -> None:
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                return
            run.current_round = round_number
            run.current_target_key = target_key
            run.heartbeat_at = utc_now()

    def is_cancel_requested(self, run_id: str) -> bool:
        with self.database.session() as session:
            run = session.get(ProbeRun, run_id)
            return bool(run and run.cancel_requested)

    def completed_step_keys(self, run_id: str) -> set[tuple[int, str]]:
        with self.database.session() as session:
            return set(
                session.execute(
                    select(ProbeSample.round_number, ProbeSample.target_key).where(
                        ProbeSample.run_id == run_id
                    )
                ).all()
            )

    def add_sample(self, run_id: str, values: dict[str, Any]) -> None:
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                return
            existing = session.scalar(
                select(ProbeSample.id).where(
                    ProbeSample.run_id == run_id,
                    ProbeSample.round_number == values["round_number"],
                    ProbeSample.target_key == values["target_key"],
                )
            )
            if existing:
                return
            session.add(ProbeSample(id=uuid.uuid4().hex, run_id=run_id, account_id=run.account_id, **values))
            duration_ms = int(values.get("duration_ms") or 0)
            if duration_ms > 0:
                now = utc_now()
                statement = sqlite_insert(ProbeDurationEstimate).values(
                    profile_id=run.profile_id,
                    execution_mode=run.execution_mode,
                    sample_count=1,
                    total_duration_ms=duration_ms,
                    created_at=now,
                    updated_at=now,
                )
                session.execute(
                    statement.on_conflict_do_update(
                        index_elements=["profile_id", "execution_mode"],
                        set_={
                            "sample_count": ProbeDurationEstimate.sample_count + 1,
                            "total_duration_ms": (
                                ProbeDurationEstimate.total_duration_ms + duration_ms
                            ),
                            "updated_at": now,
                        },
                    )
                )
            run.completed_steps += 1
            if values.get("status") == "error":
                run.error_count += 1
            classification = str(values.get("classification") or "")
            summary = dict(run.summary or {})
            raw_counts = summary.get("classifications")
            counts = dict(raw_counts) if isinstance(raw_counts, dict) else {}
            if classification:
                counts[classification] = int(counts.get(classification, 0)) + 1
            tps = _finite_float(values.get("tps"))
            tps_sum = _finite_float(summary.get("tps_sum")) or 0.0
            tps_count = int(summary.get("tps_count") or 0)
            max_tps = _finite_float(summary.get("max_tps"))
            if tps is not None and tps > 0:
                tps_sum += tps
                tps_count += 1
                max_tps = max(max_tps or 0.0, tps)
            summary.update(
                {
                    "total": run.total_steps,
                    "completed": run.completed_steps,
                    "errors": run.error_count,
                    "sample_count": run.completed_steps,
                    "anomaly_count": sum(int(counts.get(name, 0)) for name in DEGRADATION_CLASSIFICATIONS),
                    "classifications": counts,
                    "max_tps": max_tps,
                    "avg_tps": (tps_sum / tps_count) if tps_count else None,
                    "tps_sum": tps_sum,
                    "tps_count": tps_count,
                }
            )
            run.summary = summary
            run.heartbeat_at = utc_now()

    @staticmethod
    def _build_run_summary(
        run: ProbeRun, sample_values: list[Any]
    ) -> dict[str, Any]:
        counts: dict[str, int] = {}
        tps_values: list[float] = []
        for classification, raw_tps in sample_values:
            name = str(classification or "").strip()
            if name:
                counts[name] = counts.get(name, 0) + 1
            tps = _finite_float(raw_tps)
            if tps is not None and tps > 0:
                tps_values.append(tps)
        return {
            "total": run.total_steps,
            # Execution progress is intentionally retained after an operator
            # removes a stored sample. It describes what the worker completed,
            # while sample_count describes the evidence that still exists.
            "completed": run.completed_steps,
            "errors": run.error_count,
            "sample_count": len(sample_values),
            "anomaly_count": sum(
                counts.get(name, 0) for name in DEGRADATION_CLASSIFICATIONS
            ),
            "classifications": counts,
            "max_tps": max(tps_values) if tps_values else None,
            "avg_tps": (sum(tps_values) / len(tps_values)) if tps_values else None,
            "tps_sum": sum(tps_values),
            "tps_count": len(tps_values),
        }

    def _refresh_run_summary(self, session: Session, run: ProbeRun) -> None:
        sample_values = session.execute(
            select(ProbeSample.classification, ProbeSample.tps).where(
                ProbeSample.run_id == run.id
            )
        ).all()
        run.summary = self._build_run_summary(run, sample_values)

    def finish_run(self, run_id: str, status: str | None = None, error: str = "") -> dict[str, Any]:
        now = utc_now()
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                raise ValueError("探针任务不存在")
            self._refresh_run_summary(session, run)
            if status is None:
                status = "completed" if run.error_count == 0 else "completed_with_errors"
            run.status = status
            run.error = error[:4000]
            run.cancel_requested = status == "cancelled"
            run.current_round = None
            run.current_target_key = None
            run.completed_at = now
            run.heartbeat_at = now
            result = model_dict(run)
        return result

    def request_cancel(self, run_id: str) -> str:
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                raise ValueError("探针任务不存在")
            if run.status in TERMINAL_RUN_STATUSES:
                return run.status
            run.cancel_requested = True
            if run.status == "queued":
                run.status = "cancelled"
                run.completed_at = utc_now()
            else:
                run.status = "cancel_requested"
                run.heartbeat_at = utc_now()
            return run.status

    def request_cancel_many(
        self, run_ids: list[str]
    ) -> tuple[dict[str, int], list[str]]:
        unique_ids = list(dict.fromkeys(run_id for run_id in run_ids if run_id))
        now = utc_now()
        summary = {
            "requested": len(unique_ids),
            "cancelled": 0,
            "cancelRequested": 0,
            "alreadyStopping": 0,
            "skipped": 0,
        }
        interrupt_ids: list[str] = []
        with self.database.transaction() as session:
            runs_by_id = {
                run.id: run
                for run in session.scalars(
                    select(ProbeRun).where(ProbeRun.id.in_(unique_ids))
                ).all()
            }
            for run_id in unique_ids:
                run = runs_by_id.get(run_id)
                if run is None or run.status in TERMINAL_RUN_STATUSES:
                    summary["skipped"] += 1
                    continue
                if run.status == "cancel_requested":
                    summary["alreadyStopping"] += 1
                    interrupt_ids.append(run.id)
                    continue
                run.cancel_requested = True
                if run.status == "queued":
                    run.status = "cancelled"
                    run.completed_at = now
                    summary["cancelled"] += 1
                else:
                    run.status = "cancel_requested"
                    run.heartbeat_at = now
                    summary["cancelRequested"] += 1
                    interrupt_ids.append(run.id)
        return summary, interrupt_ids

    def delete_run(self, run_id: str) -> int:
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                raise ValueError("探针任务不存在")
            if run.status not in TERMINAL_RUN_STATUSES:
                raise RunStateError("排队或执行中的任务需要先取消")
            self._ensure_restore_resolved(run)
            account_id = run.account_id
            session.delete(run)
            return account_id

    def delete_sample(self, sample_id: str) -> int:
        with self.database.transaction() as session:
            sample = session.get(ProbeSample, sample_id)
            if sample is None:
                raise ValueError("探针样本不存在")
            run = session.get(ProbeRun, sample.run_id)
            if run is None:
                raise ValueError("样本所属探针任务不存在")
            if run.status not in TERMINAL_RUN_STATUSES:
                raise RunStateError("任务仍在排队或执行，结束后才能删除样本")
            account_id = sample.account_id
            session.delete(sample)
            session.flush()
            self._refresh_run_summary(session, run)
            return account_id

    def delete_runs(self, run_ids: list[str]) -> tuple[int, set[int], list[str]]:
        """Delete every deletable run, skipping the ones still holding state.

        Selecting across pages regularly mixes in active runs and runs whose
        account settings are still pending restore. Those are reported back as
        skipped instead of failing the whole batch.
        """

        deleted = 0
        account_ids: set[int] = set()
        skipped: list[str] = []
        with self.database.transaction() as session:
            values = session.scalars(select(ProbeRun).where(ProbeRun.id.in_(run_ids))).all()
            for value in values:
                if value.status not in TERMINAL_RUN_STATUSES or self._restore_pending(value):
                    skipped.append(value.id)
                    continue
                account_ids.add(value.account_id)
                session.delete(value)
                deleted += 1
        return deleted, account_ids, skipped

    def retry_values(self, run_id: str) -> dict[str, Any]:
        with self.database.session() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                raise ValueError("探针任务不存在")
            if run.status not in TERMINAL_RUN_STATUSES:
                raise RunStateError("当前任务尚未结束")
            self._ensure_restore_resolved(run)
            return {
                "account_id": run.account_id,
                "account_name": run.account_name,
                "account_email": run.account_email,
                "profile_id": run.profile_id,
                "execution_mode": run.execution_mode,
                "rounds": run.rounds,
                "proxy_targets": run.proxy_targets,
                "parent_run_id": run.id,
            }

    @staticmethod
    def _restore_pending(run: ProbeRun) -> bool:
        return bool(
            run.account_restore_status in BLOCKING_ACCOUNT_RESTORE_STATUSES
            or run.diagnostic_activation_active
        )

    def _ensure_restore_resolved(self, run: ProbeRun) -> None:
        if self._restore_pending(run):
            raise RunStateError("账号原设置尚未恢复，请先在任务详情中同步原设置")

    def interrupted_runs(self) -> list[dict[str, Any]]:
        with self.database.transaction() as session:
            runs = session.scalars(
                select(ProbeRun).where(ProbeRun.status.in_({"running", "cancel_requested", "recovering"}))
            ).all()
            result = []
            for run in runs:
                run.status = "recovering"
                run.heartbeat_at = utc_now()
                result.append(model_dict(run))
            return result

    def finish_recovery(self, run_id: str, cleanup_error: str = "") -> None:
        with self.database.transaction() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                return
            run.temporary_route_id = ""
            run.temporary_public_model = ""
            run.temporary_client_key_id = ""
            run.current_round = None
            run.current_target_key = None
            run.worker_id = None
            if cleanup_error:
                # State restoration is more important than silently resuming a
                # probe. Keep the snapshot and expose the manual synchronization
                # action instead of running with uncertain upstream settings.
                run.status = "failed"
                run.completed_at = utc_now()
            elif run.cancel_requested:
                run.status = "cancelled"
                run.completed_at = utc_now()
            else:
                run.status = "queued"
                run.queued_at = utc_now()
            if cleanup_error:
                run.error = f"重启恢复清理: {cleanup_error}"[:4000]

    def _run_list_filters(
        self,
        *,
        status: str,
        search: str,
        account_id: int | None,
        plan_id: str | None,
    ) -> list[Any]:
        filters: list[Any] = []
        if status:
            filters.append(ProbeRun.status == status)
        token = search.strip().lower()
        if token:
            account_filters = [
                func.lower(ProbeRun.account_name).contains(token),
                func.lower(ProbeRun.account_email).contains(token),
            ]
            if token.isdigit():
                account_filters.append(ProbeRun.account_id == int(token))
            filters.append(or_(*account_filters))
        if account_id is not None:
            filters.append(ProbeRun.account_id == account_id)
        if plan_id is not None:
            filters.append(ProbeRun.plan_id == plan_id)
        return filters

    def select_run_ids(
        self,
        *,
        status: str = "",
        search: str = "",
        account_id: int | None = None,
        plan_id: str | None = None,
    ) -> dict[str, Any]:
        """Return every run id matching the current UI filters, split by action.

        The task centre uses this to select across pages: each bulk action then
        applies to its own subset instead of the visible page only.
        """

        filters = self._run_list_filters(
            status=status,
            search=search,
            account_id=account_id,
            plan_id=plan_id,
        )
        with self.database.session() as session:
            values = session.execute(
                select(
                    ProbeRun.id,
                    ProbeRun.account_id,
                    ProbeRun.status,
                    ProbeRun.account_restore_status,
                    ProbeRun.diagnostic_activation_active,
                ).where(*filters)
            ).all()

        items: list[dict[str, Any]] = []
        for run_id, account_id_value, run_status, restore_status, diagnostic_active in values:
            restore_pending = (
                restore_status in BLOCKING_ACCOUNT_RESTORE_STATUSES
                or bool(diagnostic_active)
            )
            if run_status in CANCELLABLE_RUN_STATUSES:
                action = "cancel"
            elif run_status in TERMINAL_RUN_STATUSES:
                action = "restore" if restore_pending else "delete"
            else:
                continue
            items.append(
                {
                    "id": run_id,
                    "accountId": int(account_id_value or 0),
                    "action": action,
                }
            )
        return {
            "items": items,
            "matched": len(values),
            "selectable": len(items),
            "excluded": len(values) - len(items),
        }

    def list_runs(
        self,
        *,
        page: int,
        page_size: int,
        status: str = "",
        search: str = "",
        account_id: int | None = None,
        plan_id: str | None = None,
    ) -> dict[str, Any]:
        filters = self._run_list_filters(
            status=status,
            search=search,
            account_id=account_id,
            plan_id=plan_id,
        )
        with self.database.session() as session:
            total, active_count = session.execute(
                select(
                    func.count(ProbeRun.id),
                    func.count(ProbeRun.id).filter(ProbeRun.status.in_(ACTIVE_RUN_STATUSES)),
                ).where(*filters)
            ).one()
            values = session.scalars(
                select(ProbeRun)
                .where(*filters)
                .order_by(ProbeRun.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            duration_estimates = self._duration_estimates_for_runs(session, values)
            executing_account_ids = set(
                session.scalars(
                    select(ProbeRun.account_id)
                    .where(ProbeRun.status.in_(EXECUTING_RUN_STATUSES))
                    .distinct()
                ).all()
            )
            restore_blocked_account_ids = set(
                session.scalars(
                    select(ProbeRun.account_id)
                    .where(
                        ProbeRun.account_restore_status.in_(
                            BLOCKING_ACCOUNT_RESTORE_STATUSES
                        )
                        | ProbeRun.diagnostic_activation_active.is_(True)
                    )
                    .distinct()
                ).all()
            )
            items = []
            for value in values:
                item = model_dict(value)
                item["duration_estimate"] = self._run_duration_estimate(
                    value,
                    duration_estimates.get((value.profile_id, value.execution_mode)),
                )
                reason = ""
                if value.status == "queued":
                    if value.account_id in executing_account_ids:
                        reason = "same_account_running"
                    elif value.account_id in restore_blocked_account_ids:
                        reason = "account_restore_blocked"
                    else:
                        reason = "worker_capacity"
                item["queue_blocked_reason"] = reason
                items.append(item)
            return {
                "items": items,
                "total": total,
                "page": page,
                "pageSize": page_size,
                "activeCount": int(active_count or 0),
            }

    def run_detail(self, run_id: str) -> dict[str, Any] | None:
        with self.database.session() as session:
            run = session.get(ProbeRun, run_id)
            if run is None:
                return None
            profile = session.get(ProbeProfile, run.profile_id)
            samples = session.scalars(
                select(ProbeSample)
                .where(ProbeSample.run_id == run_id)
                .order_by(ProbeSample.round_number.asc(), ProbeSample.target_key.asc())
            ).all()
            duration_estimates = self._duration_estimates_for_runs(session, [run])
            run_value = model_dict(run)
            run_value["duration_estimate"] = self._run_duration_estimate(
                run,
                duration_estimates.get((run.profile_id, run.execution_mode)),
            )
            return {
                "run": run_value,
                "profile": _profile_dict(profile) if profile else None,
                "samples": [model_dict(value) for value in samples],
            }

    @staticmethod
    def _duration_estimates_for_runs(
        session: Session,
        runs: list[ProbeRun],
    ) -> dict[tuple[str, str], ProbeDurationEstimate]:
        profile_ids = {
            run.profile_id for run in runs if run.status in ESTIMATED_RUN_STATUSES
        }
        if not profile_ids:
            return {}
        values = session.scalars(
            select(ProbeDurationEstimate).where(
                ProbeDurationEstimate.profile_id.in_(profile_ids)
            )
        ).all()
        return {
            (value.profile_id, value.execution_mode): value for value in values
        }

    @staticmethod
    def _run_duration_estimate(
        run: ProbeRun,
        estimate: ProbeDurationEstimate | None,
    ) -> dict[str, Any] | None:
        if (
            run.status not in ESTIMATED_RUN_STATUSES
            or estimate is None
            or estimate.sample_count <= 0
            or estimate.total_duration_ms <= 0
        ):
            return None
        average_sample_ms = max(
            1, round(estimate.total_duration_ms / estimate.sample_count)
        )
        remaining_steps = max(run.total_steps - run.completed_steps, 0)
        return {
            "average_sample_ms": average_sample_ms,
            "estimated_total_ms": average_sample_ms * run.total_steps,
            "estimated_remaining_ms": average_sample_ms * remaining_steps,
            "sample_count": estimate.sample_count,
            "updated_at": model_dict(estimate)["updated_at"],
        }

    def account_history(self, account_id: int, limit: int = 200) -> dict[str, Any]:
        with self.database.session() as session:
            samples = session.scalars(
                select(ProbeSample)
                .where(ProbeSample.account_id == account_id)
                .order_by(ProbeSample.created_at.desc())
                .limit(limit)
            ).all()
            runs = session.scalars(
                select(ProbeRun)
                .where(ProbeRun.account_id == account_id)
                .order_by(ProbeRun.created_at.desc())
                .limit(50)
            ).all()
            grouped = session.execute(
                select(
                    ProbeSample.target_key,
                    ProbeSample.target_kind,
                    ProbeSample.egress_node_id,
                    ProbeSample.egress_name,
                    func.count(ProbeSample.id).label("samples"),
                    func.sum(
                        case(
                            (
                                ProbeSample.classification.in_(
                                    DEGRADATION_CLASSIFICATIONS
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ).label("anomalies"),
                    func.avg(ProbeSample.tps).filter(ProbeSample.tps > 0).label("avg_tps"),
                    func.max(ProbeSample.tps).label("max_tps"),
                )
                .where(ProbeSample.account_id == account_id)
                .group_by(
                    ProbeSample.target_key,
                    ProbeSample.target_kind,
                    ProbeSample.egress_node_id,
                    ProbeSample.egress_name,
                )
                .order_by(func.max(ProbeSample.tps).desc())
            ).all()
            return {
                "samples": [model_dict(value) for value in samples],
                "runs": [model_dict(value) for value in runs],
                "byTarget": [
                    {
                        **dict(row._mapping),
                        "samples": int(row.samples or 0),
                        "anomalies": int(row.anomalies or 0),
                    }
                    for row in grouped
                ],
            }

    def queue_stats(self) -> dict[str, int]:
        with self.database.session() as session:
            return {
                status: int(count)
                for status, count in session.execute(
                    select(ProbeRun.status, func.count(ProbeRun.id)).group_by(ProbeRun.status)
                )
            }

    def worker_queue_stats(self) -> dict[str, int]:
        """Return queue eligibility without loading a large queued run list."""

        with self.database.session() as session:
            executing_accounts = (
                select(ProbeRun.account_id.label("account_id"))
                .where(ProbeRun.status.in_(EXECUTING_RUN_STATUSES))
                .distinct()
                .subquery()
            )
            restore_blocked_accounts = (
                select(ProbeRun.account_id.label("account_id"))
                .where(
                    ProbeRun.account_restore_status.in_(BLOCKING_ACCOUNT_RESTORE_STATUSES)
                    | ProbeRun.diagnostic_activation_active.is_(True)
                )
                .distinct()
                .subquery()
            )
            queued = int(
                session.scalar(
                    select(func.count(ProbeRun.id)).where(ProbeRun.status == "queued")
                )
                or 0
            )
            blocked_same_account = int(
                session.scalar(
                    select(func.count(ProbeRun.id)).where(
                        ProbeRun.status == "queued",
                        ProbeRun.account_id.in_(select(executing_accounts.c.account_id)),
                    )
                )
                or 0
            )
            blocked_restore = int(
                session.scalar(
                    select(func.count(ProbeRun.id)).where(
                        ProbeRun.status == "queued",
                        ProbeRun.account_id.not_in(
                            select(executing_accounts.c.account_id)
                        ),
                        ProbeRun.account_id.in_(
                            select(restore_blocked_accounts.c.account_id)
                        ),
                    )
                )
                or 0
            )
            running = int(
                session.scalar(
                    select(func.count(ProbeRun.id)).where(
                        ProbeRun.status.in_(EXECUTING_RUN_STATUSES)
                    )
                )
                or 0
            )
            return {
                "queued": queued,
                "running": running,
                "eligible": max(0, queued - blocked_same_account - blocked_restore),
                "blockedSameAccount": blocked_same_account,
                "blockedRestore": blocked_restore,
            }

    # Scheduler execution history ----------------------------------------------
    def start_schedule_execution(self, schedule_key: str) -> str:
        execution_id = uuid.uuid4().hex
        with self.database.transaction() as session:
            session.add(ScheduleExecution(id=execution_id, schedule_key=schedule_key, status="running"))
        return execution_id

    def finish_schedule_execution(
        self,
        execution_id: str,
        *,
        status: str,
        message: str = "",
        detail: dict[str, Any] | None = None,
    ) -> None:
        with self.database.transaction() as session:
            execution = session.get(ScheduleExecution, execution_id)
            if execution is None:
                return
            execution.status = status
            execution.message = message[:500]
            execution.detail = detail or {}
            execution.completed_at = utc_now()

    def list_schedule_executions(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.database.session() as session:
            values = session.scalars(
                select(ScheduleExecution).order_by(ScheduleExecution.started_at.desc()).limit(limit)
            ).all()
            return [model_dict(value) for value in values]

    def delete_schedule_execution(self, execution_id: str) -> None:
        with self.database.transaction() as session:
            execution = session.get(ScheduleExecution, execution_id)
            if execution is None:
                raise ValueError("调度执行记录不存在")
            if execution.status == "running":
                raise RunStateError("执行中的调度记录不能删除")
            session.delete(execution)

    def delete_schedule_executions(
        self, execution_ids: list[str]
    ) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(value for value in execution_ids if value))
        with self.database.transaction() as session:
            executions_by_id = {
                execution.id: execution
                for execution in session.scalars(
                    select(ScheduleExecution).where(
                        ScheduleExecution.id.in_(unique_ids)
                    )
                ).all()
            }
            running_ids = {
                execution_id
                for execution_id, execution in executions_by_id.items()
                if execution.status == "running"
            }
            deleted_ids = [
                execution_id
                for execution_id in unique_ids
                if execution_id in executions_by_id
                and execution_id not in running_ids
            ]
            for execution_id in deleted_ids:
                session.delete(executions_by_id[execution_id])

        missing_ids = [
            execution_id
            for execution_id in unique_ids
            if execution_id not in executions_by_id
        ]
        running_in_request = [
            execution_id
            for execution_id in unique_ids
            if execution_id in running_ids
        ]
        return {
            "requested": len(unique_ids),
            "deleted": len(deleted_ids),
            "skipped": len(missing_ids) + len(running_in_request),
            "running": len(running_in_request),
            "missing": len(missing_ids),
            "runningIds": running_in_request,
            "missingIds": missing_ids,
        }
