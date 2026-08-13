from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utc_now

from .database import Database
from .models import ProbePlan, ProbeProfile, ProbeRun


@dataclass(slots=True, frozen=True)
class QueuePolicy:
    active_statuses: set[str]
    restore_statuses: set[str]


class ProbeQueueWriter:
    """Creates individual and batched probe queue rows."""

    def __init__(
        self,
        database: Database,
        policy: QueuePolicy,
        *,
        profile_ids: Callable[[Any, Any], list[str]],
        require_profiles: Callable[[Session, list[str]], list[str]],
        queue_full_error: type[ValueError],
        run_state_error: type[ValueError],
    ):
        self.database = database
        self.policy = policy
        self.profile_ids = profile_ids
        self.require_profiles = require_profiles
        self.queue_full_error = queue_full_error
        self.run_state_error = run_state_error

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
            self._ensure_capacity(session, queue_limit, 1)
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
        unique_accounts = self._unique_accounts(accounts)
        requested_profile_ids = self.profile_ids(profile_ids, profile_id)
        requested_ids = set(unique_accounts)
        if not requested_ids:
            return self._empty_batch(requested_profile_ids)
        now = utc_now()
        with self.database.transaction() as session:
            selected_profile_ids = self.require_profiles(session, requested_profile_ids)
            active_account_ids = self._active_account_ids(session, requested_ids)
            restore_blocked_account_ids = self._restore_blocked_account_ids(session, requested_ids)
            candidate_ids = sorted(requested_ids - active_account_ids - restore_blocked_account_ids)
            self._ensure_batch_capacity(
                session, queue_limit, len(candidate_ids) * len(selected_profile_ids)
            )
            rows = self._build_rows(
                accounts=unique_accounts,
                account_ids=candidate_ids,
                profile_ids=selected_profile_ids,
                rounds=rounds,
                proxy_targets=proxy_targets,
                execution_mode=execution_mode,
                priority=priority,
                trigger="manual",
                now=now,
            )
            session.add_all(rows)
        return {
            "runIds": [run.id for run in rows],
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
            selected_profile_ids = self.require_profiles(session, profile_ids)
            if self._active_account_ids(session, {account_id}):
                raise self.run_state_error("账号已有未完成探针，注册探针将在其结束后重试")
            if self._restore_blocked_account_ids(session, {account_id}):
                raise self.run_state_error("账号存在未完成的原设置恢复，注册探针稍后重试")
            self._ensure_capacity(session, queue_limit, len(selected_profile_ids))
            rows = self._build_rows(
                accounts={account_id: account},
                account_ids=[account_id],
                profile_ids=selected_profile_ids,
                rounds=rounds,
                proxy_targets=proxy_targets,
                execution_mode=execution_mode,
                priority=priority,
                trigger="register",
                now=now,
                source_event_id=event_id,
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
        unique_accounts = self._unique_accounts(accounts)
        requested_ids = set(unique_accounts)
        if not requested_ids:
            return self._empty_batch(
                self.profile_ids(profile_ids, ""), include_register_cooldown=True
            )
        now = utc_now()
        with self.database.transaction() as session:
            if session.get(ProbePlan, plan_id) is None:
                raise ValueError("Cron 探针计划不存在")
            selected_profile_ids = self.require_profiles(session, profile_ids)
            active_account_ids = self._active_account_ids(session, requested_ids)
            cooldown_account_ids = self._register_cooldown_account_ids(
                session, requested_ids, now, register_cooldown_minutes
            )
            restore_blocked_account_ids = self._restore_blocked_account_ids(session, requested_ids)
            candidate_ids = sorted(
                requested_ids
                - active_account_ids
                - restore_blocked_account_ids
                - cooldown_account_ids
            )
            self._ensure_batch_capacity(
                session, queue_limit, len(candidate_ids) * len(selected_profile_ids)
            )
            rows = self._build_rows(
                accounts=unique_accounts,
                account_ids=candidate_ids,
                profile_ids=selected_profile_ids,
                rounds=rounds,
                proxy_targets=proxy_targets,
                execution_mode=execution_mode,
                priority=priority,
                trigger="cron",
                now=now,
                plan_id=plan_id,
            )
            session.add_all(rows)
        return {
            "runIds": [run.id for run in rows],
            "createdAccountIds": candidate_ids,
            "activeAccountIds": sorted(active_account_ids),
            "restoreBlockedAccountIds": sorted(restore_blocked_account_ids),
            "registerCooldownAccountIds": sorted(cooldown_account_ids),
            "profileIds": selected_profile_ids,
        }

    @staticmethod
    def _unique_accounts(accounts: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
        return {
            int(account["id"]): account
            for account in accounts
            if int(account.get("id") or 0) > 0
        }

    def _active_account_ids(self, session: Session, account_ids: set[int]) -> set[int]:
        return set(
            session.scalars(
                select(ProbeRun.account_id).where(
                    ProbeRun.account_id.in_(account_ids),
                    ProbeRun.status.in_(self.policy.active_statuses),
                )
            ).all()
        )

    def _restore_blocked_account_ids(
        self, session: Session, account_ids: set[int]
    ) -> set[int]:
        return set(
            session.scalars(
                select(ProbeRun.account_id).where(
                    ProbeRun.account_id.in_(account_ids),
                    (
                        ProbeRun.account_restore_status.in_(self.policy.restore_statuses)
                        | ProbeRun.diagnostic_activation_active.is_(True)
                    ),
                )
            ).all()
        )

    @staticmethod
    def _register_cooldown_account_ids(
        session: Session,
        account_ids: set[int],
        now: Any,
        register_cooldown_minutes: int,
    ) -> set[int]:
        if register_cooldown_minutes <= 0:
            return set()
        cooldown_cutoff = now - timedelta(minutes=register_cooldown_minutes)
        return set(
            session.scalars(
                select(ProbeRun.account_id).where(
                    ProbeRun.account_id.in_(account_ids),
                    ProbeRun.trigger == "register",
                    ProbeRun.completed_at.is_not(None),
                    ProbeRun.completed_at >= cooldown_cutoff,
                )
            ).all()
        )

    def _ensure_capacity(self, session: Session, queue_limit: int, required: int) -> None:
        active_count = int(
            session.scalar(
                select(func.count(ProbeRun.id)).where(
                    ProbeRun.status.in_(self.policy.active_statuses)
                )
            )
            or 0
        )
        if active_count + required > queue_limit:
            raise self.queue_full_error(f"探针队列已达到上限 {queue_limit}")

    def _ensure_batch_capacity(
        self, session: Session, queue_limit: int, required: int
    ) -> None:
        active_count = int(
            session.scalar(
                select(func.count(ProbeRun.id)).where(
                    ProbeRun.status.in_(self.policy.active_statuses)
                )
            )
            or 0
        )
        available = max(queue_limit - active_count, 0)
        if required > available:
            raise self.queue_full_error(
                f"队列剩余容量 {available}，本次需要 {required}；"
                "本次未创建任务，请提高全局队列上限或等待现有任务完成"
            )

    @staticmethod
    def _build_rows(
        *,
        accounts: dict[int, dict[str, Any]],
        account_ids: list[int],
        profile_ids: list[str],
        rounds: int,
        proxy_targets: list[dict[str, Any]],
        execution_mode: str,
        priority: int,
        trigger: str,
        now: Any,
        plan_id: str | None = None,
        source_event_id: str | None = None,
    ) -> list[ProbeRun]:
        rows: list[ProbeRun] = []
        for account_id in account_ids:
            account = accounts[account_id]
            for profile_id in profile_ids:
                rows.append(
                    ProbeRun(
                        id=uuid.uuid4().hex,
                        account_id=account_id,
                        account_name=str(account.get("name") or f"account-{account_id}"),
                        account_email=str(account.get("email") or ""),
                        profile_id=profile_id,
                        plan_id=plan_id,
                        source_event_id=source_event_id,
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
        return rows

    @staticmethod
    def _empty_batch(
        profile_ids: list[str], *, include_register_cooldown: bool = False
    ) -> dict[str, Any]:
        result = {
            "runIds": [],
            "createdAccountIds": [],
            "activeAccountIds": [],
            "restoreBlockedAccountIds": [],
            "profileIds": profile_ids,
        }
        if include_register_cooldown:
            result["registerCooldownAccountIds"] = []
        return result
