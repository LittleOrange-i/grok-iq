from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.core.clock import to_app_timezone, utc_now

from .sql_types import AppDateTime


class Base(DeclarativeBase):
    """Declarative root for data owned by this monitor."""


class MetadataRow(Base):
    __tablename__ = "metadata"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="", nullable=False)


class AdminUser(Base):
    """The single local administrator for this independent monitor."""

    __tablename__ = "admin_users"
    __table_args__ = (CheckConstraint("id = 1", name="ck_admin_users_singleton"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    password_salt: Mapped[str] = mapped_column(String(128), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    password_iterations: Mapped[int] = mapped_column(Integer, default=310_000, nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, onupdate=utc_now, nullable=False
    )


class AccountAssessment(Base):
    """Monitor-owned verdict keyed by an upstream account ID.

    Account credentials and account-list fields stay in grok2api. This table
    contains only the monitor's result, operator action, and quarantine state.
    """

    __tablename__ = "account_assessments"

    account_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    monitor_status: Mapped[str] = mapped_column(String(24), default="healthy", nullable=False, index=True)
    risk_score: Mapped[float] = mapped_column(Float, default=0, nullable=False, index=True)
    sample_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    anomaly_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    hard_anomaly_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    fast_risk_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    marker_miss_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    distinct_egress_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    anomaly_streak: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    avg_tps: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    max_tps: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    latest_tps: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    latest_classification: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    latest_sample_at: Mapped[datetime | None] = mapped_column(AppDateTime())
    last_anomaly_at: Mapped[datetime | None] = mapped_column(AppDateTime())
    risk_reasons: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    quarantine_until: Mapped[datetime | None] = mapped_column(AppDateTime(), index=True)
    disabled_by_monitor: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    previous_upstream_enabled: Mapped[bool | None] = mapped_column(Boolean)
    recovery_guarded: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, index=True
    )
    manual_note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(AppDateTime(), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, onupdate=utc_now, nullable=False
    )


class ProbeProfile(Base):
    __tablename__ = "probe_profiles"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    model: Mapped[str] = mapped_column(String(160), nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # A compact marker used by the automatic contains-check. The richer
    # human-facing reference output is stored separately so it can contain
    # Markdown, HTML, or long-form plain text without affecting classification.
    expected_text: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    expected_output: Mapped[str] = mapped_column(Text, default="", nullable=False)
    expected_image_url: Mapped[str] = mapped_column(String(4000), default="", nullable=False)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    temperature: Mapped[float | None] = mapped_column(Float)
    extra_body: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(AppDateTime(), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, onupdate=utc_now, nullable=False
    )
    runs: Mapped[list[ProbeRun]] = relationship(back_populates="profile")
    plans: Mapped[list[ProbePlan]] = relationship(back_populates="profile")


class ProbeDurationEstimate(Base):
    """Incremental historical sample timing for one profile and execution mode."""

    __tablename__ = "probe_duration_estimates"

    profile_id: Mapped[str] = mapped_column(
        ForeignKey("probe_profiles.id", ondelete="CASCADE"), primary_key=True
    )
    execution_mode: Mapped[str] = mapped_column(String(24), primary_key=True)
    sample_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_duration_ms: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(AppDateTime(), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, onupdate=utc_now, nullable=False
    )


class ProbePlan(Base):
    """A user-managed Cron plan selecting concrete upstream accounts/proxies."""

    __tablename__ = "probe_plans"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    # ``profile_id`` remains the compatibility/primary profile while
    # ``profile_ids`` contains the complete ordered selection. Each scheduled
    # run still references exactly one profile so evidence never mixes schemes.
    profile_id: Mapped[str] = mapped_column(ForeignKey("probe_profiles.id"), nullable=False)
    profile_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    account_ids: Mapped[list[int]] = mapped_column(JSON, nullable=False)
    # Each target is {kind: "current"|"direct"|"egress", id?: int, name?: str}.
    proxy_targets: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    execution_mode: Mapped[str] = mapped_column(String(24), default="chat", nullable=False)
    rounds: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    cron_expression: Mapped[str] = mapped_column(String(120), nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), default="UTC", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    overlap_policy: Mapped[str] = mapped_column(String(16), default="skip", nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=200, nullable=False)
    created_at: Mapped[datetime] = mapped_column(AppDateTime(), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, onupdate=utc_now, nullable=False
    )

    profile: Mapped[ProbeProfile] = relationship(back_populates="plans")


class ProbeRun(Base):
    __tablename__ = "probe_runs"
    __table_args__ = (
        Index("ix_probe_run_status_priority", "status", "priority", "created_at"),
        Index("ix_probe_run_status_created", "status", "created_at"),
        Index("ix_probe_run_created_at", "created_at"),
        Index("ix_probe_run_account_created", "account_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # Labels are captured as run evidence, not synchronized account mirrors.
    account_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    account_email: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    profile_id: Mapped[str] = mapped_column(ForeignKey("probe_profiles.id"), nullable=False)
    plan_id: Mapped[str | None] = mapped_column(ForeignKey("probe_plans.id", ondelete="SET NULL"), index=True)
    parent_run_id: Mapped[str | None] = mapped_column(ForeignKey("probe_runs.id", ondelete="SET NULL"))
    source_event_id: Mapped[str | None] = mapped_column(String(120), index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    trigger: Mapped[str] = mapped_column(String(24), default="manual", nullable=False)
    automatic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    execution_mode: Mapped[str] = mapped_column(String(24), default="chat", nullable=False)
    rounds: Mapped[int] = mapped_column(Integer, nullable=False)
    proxy_targets: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    total_steps: Mapped[int] = mapped_column(Integer, nullable=False)
    completed_steps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    current_round: Mapped[int | None] = mapped_column(Integer)
    current_target_key: Mapped[str | None] = mapped_column(String(100))
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    worker_id: Mapped[str | None] = mapped_column(String(100))
    summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    error: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Persisted cleanup context protects upstream state across a hard restart.
    original_egress_node_id: Mapped[int | None] = mapped_column(Integer)
    original_egress_assignment_mode: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    # A run keeps the complete account routing snapshot permanently. Besides
    # automatic rollback, operators can replay this snapshot from the task
    # detail page when an upstream request or process crash interrupted cleanup.
    original_account_enabled: Mapped[bool | None] = mapped_column(Boolean)
    original_account_priority: Mapped[int | None] = mapped_column(Integer)
    original_account_max_concurrent: Mapped[int | None] = mapped_column(Integer)
    account_settings_snapshot_at: Mapped[datetime | None] = mapped_column(AppDateTime())
    diagnostic_priority: Mapped[int | None] = mapped_column(Integer)
    diagnostic_max_concurrent: Mapped[int | None] = mapped_column(Integer)
    diagnostic_activation_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    account_restore_status: Mapped[str] = mapped_column(String(32), default="not_recorded", nullable=False)
    account_restore_source: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    account_restore_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    account_restore_error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    account_restore_attempted_at: Mapped[datetime | None] = mapped_column(AppDateTime())
    account_restored_at: Mapped[datetime | None] = mapped_column(AppDateTime())
    temporary_route_id: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    temporary_public_model: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    temporary_client_key_id: Mapped[str] = mapped_column(String(64), default="", nullable=False)

    created_at: Mapped[datetime] = mapped_column(AppDateTime(), default=utc_now, nullable=False)
    queued_at: Mapped[datetime] = mapped_column(AppDateTime(), default=utc_now, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(AppDateTime())
    heartbeat_at: Mapped[datetime | None] = mapped_column(AppDateTime())
    completed_at: Mapped[datetime | None] = mapped_column(AppDateTime())

    profile: Mapped[ProbeProfile] = relationship(back_populates="runs")
    samples: Mapped[list[ProbeSample]] = relationship(
        back_populates="run", cascade="all, delete-orphan", passive_deletes=True
    )


class ProbeSample(Base):
    __tablename__ = "probe_samples"
    __table_args__ = (
        UniqueConstraint("run_id", "round_number", "target_key", name="uq_probe_step"),
        Index("ix_probe_sample_account_created", "account_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("probe_runs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    account_id: Mapped[int] = mapped_column(Integer, nullable=False)
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    target_key: Mapped[str] = mapped_column(String(100), nullable=False)
    target_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    egress_node_id: Mapped[int | None] = mapped_column(Integer)
    egress_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    request_id: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    audit_id: Mapped[int | None] = mapped_column(Integer)
    verified_account_id: Mapped[int | None] = mapped_column(Integer)
    verified_egress_node_id: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Structured upstream failure metadata.  Keeping these separate from the
    # human-readable ``error`` text lets the UI distinguish a short scheduler
    # cooldown from quota/auth failures without parsing localized strings.
    error_code: Mapped[str] = mapped_column(String(100), default="", nullable=False, index=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    retry_after_seconds: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reasoning_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    visible_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_token_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    generation_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_token_share: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    tps: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    expected_matched: Mapped[bool | None] = mapped_column(Boolean)
    response_sha256: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    response_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    usage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    classification: Mapped[str] = mapped_column(String(32), default="", nullable=False, index=True)
    severity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(AppDateTime(), default=utc_now, nullable=False)
    run: Mapped[ProbeRun] = relationship(back_populates="samples")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(48), nullable=False)
    severity: Mapped[str] = mapped_column(String(24), nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, index=True, nullable=False
    )


class ScheduleExecution(Base):
    __tablename__ = "schedule_executions"
    __table_args__ = (Index("ix_schedule_execution_key_started", "schedule_key", "started_at"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    schedule_key: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    message: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    started_at: Mapped[datetime] = mapped_column(AppDateTime(), default=utc_now, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(AppDateTime())


class ChatProvider(Base):
    """OpenAI-compatible model provider used by the browser playground."""

    __tablename__ = "chat_providers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    base_url: Mapped[str] = mapped_column(String(2000), nullable=False)
    api_key_ciphertext: Mapped[str] = mapped_column(Text, default="", nullable=False)
    models: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, onupdate=utc_now, nullable=False
    )


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, onupdate=utc_now, nullable=False
    )


class RegisterWebhookEvent(Base):
    """Durable inbox for at-least-once grok-register notifications."""

    __tablename__ = "register_webhook_events"
    __table_args__ = (
        Index("ix_register_webhook_due", "status", "next_attempt_at"),
    )

    event_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    registration_id: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    grok2api_account_id: Mapped[int | None] = mapped_column(Integer)
    bot_risk: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    bfs: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    occurred_at: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    resolved_account_id: Mapped[int | None] = mapped_column(Integer)
    run_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(AppDateTime(), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        AppDateTime(), default=utc_now, onupdate=utc_now, nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(AppDateTime())


def model_dict(value: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for column in value.__table__.columns:
        item = getattr(value, column.name)
        result[column.name] = (
            to_app_timezone(item) if isinstance(item, datetime) else item
        )
    return result
