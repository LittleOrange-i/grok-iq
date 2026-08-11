from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, ClassVar

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_DATABASE_PATH = Path(__file__).resolve().parents[2] / "data" / "monitor.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GAM_", env_file=".env", extra="ignore")

    app_name: str = "Grok Account Monitor"
    host: str = "0.0.0.0"
    port: int = 8090
    debug: bool = False
    # Resolve the source-tree default from this module instead of the process
    # working directory. Starting ``python -m app.main`` from the repository
    # root and from ``backend/`` must address the same local database.
    database_path: Path = DEFAULT_DATABASE_PATH
    # Only bootstrap settings stay environment-backed. Runtime secrets saved
    # from the admin UI are encrypted with this Fernet key. When it is empty,
    # the application creates a mode-0600 key beside the SQLite database.
    runtime_secret_key: str = ""
    # JWT signing is bootstrap-only. When omitted, a mode-0600 key is generated
    # next to the monitor database and therefore persists with the Docker volume.
    jwt_secret_key: str = ""
    jwt_ttl_seconds: int = Field(
        default=7 * 24 * 60 * 60,
        ge=7 * 24 * 60 * 60,
    )

    # grok2api remains the account source of truth. Lists are queried live and
    # credentials are never copied into this service.
    grok2api_base_url: str = "http://127.0.0.1:8000"
    grok2api_admin_username: str = ""
    grok2api_admin_password: str = ""
    grok2api_http_impersonate: str = "chrome"

    grok_register_webhook_token: str = ""
    initial_probe_on_register: bool = False
    register_probe_profile_ids: list[str] = Field(
        default_factory=lambda: ["quality-marker"]
    )
    register_probe_execution_mode: str = "chat"
    register_probe_rounds: int = Field(default=3, ge=1, le=20)
    register_probe_proxy_targets: list[dict[str, Any]] = Field(
        default_factory=lambda: [{"kind": "direct", "id": None}]
    )

    # Every user-created probe plan has its own Cron expression. This system
    # Cron only handles monitor-owned quarantine recovery.
    scheduler_enabled: bool = True
    scheduler_timezone: str = "UTC"
    scheduler_misfire_grace_seconds: int = Field(default=300, ge=1, le=86_400)
    recovery_cron: str = "*/5 * * * *"

    # Persistent probe queue. A short Cron interval therefore cannot create
    # unbounded asyncio tasks.
    probe_worker_concurrency: int = Field(default=2, ge=1, le=32)
    probe_queue_limit: int = Field(default=10_000, ge=1, le=100_000)
    probe_step_delay_seconds: float = Field(default=0.6, ge=0, le=60)
    # A failed proxy can put the pinned account into grok2api's short health
    # cooldown.  Probe retries are bounded and independently configurable so a
    # short Cron interval cannot create a retry storm.
    probe_transient_retry_attempts: int = Field(default=2, ge=0, le=5)
    probe_transient_retry_base_seconds: float = Field(default=5.0, ge=0.1, le=60)
    probe_transient_retry_max_seconds: float = Field(default=30.0, ge=0.1, le=300)
    probe_route_prefix: str = "gam-probe"
    probe_diagnostic_priority: int = Field(default=-1_000_000, ge=-2_000_000_000, le=0)

    analysis_window_hours: int = Field(default=168, ge=1, le=24 * 365)
    degradation_tps: float = Field(default=500, gt=0)
    strong_degradation_tps: float = Field(default=1000, gt=0)
    consecutive_anomalies: int = Field(default=3, ge=2, le=20)
    cross_egress_min: int = Field(default=2, ge=1, le=20)
    buffer_first_token_share: float = Field(default=0.85, ge=0.5, le=0.99)
    min_generation_ms: int = Field(default=250, ge=1, le=60_000)
    minimum_output_tokens: int = Field(default=32, ge=1, le=4096)
    auto_quarantine: bool = False
    quarantine_minutes: int = Field(default=30, ge=1, le=7 * 24 * 60)

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    RUNTIME_FIELDS: ClassVar[tuple[str, ...]] = (
        "grok2api_base_url",
        "grok2api_admin_username",
        "grok2api_admin_password",
        "grok2api_http_impersonate",
        "grok_register_webhook_token",
        "initial_probe_on_register",
        "register_probe_profile_ids",
        "register_probe_execution_mode",
        "register_probe_rounds",
        "register_probe_proxy_targets",
        "scheduler_enabled",
        "scheduler_timezone",
        "scheduler_misfire_grace_seconds",
        "recovery_cron",
        "probe_worker_concurrency",
        "probe_queue_limit",
        "probe_step_delay_seconds",
        "probe_transient_retry_attempts",
        "probe_transient_retry_base_seconds",
        "probe_transient_retry_max_seconds",
        "probe_route_prefix",
        "probe_diagnostic_priority",
        "analysis_window_hours",
        "degradation_tps",
        "strong_degradation_tps",
        "consecutive_anomalies",
        "cross_egress_min",
        "buffer_first_token_share",
        "min_generation_ms",
        "minimum_output_tokens",
        "auto_quarantine",
        "quarantine_minutes",
    )
    SECRET_RUNTIME_FIELDS: ClassVar[frozenset[str]] = frozenset(
        {
            "grok2api_admin_password",
            "grok_register_webhook_token",
        }
    )

    @property
    def normalized_gateway_base_url(self) -> str:
        return self.grok2api_base_url.rstrip("/")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    def apply_runtime(self, validated: Settings) -> None:
        """Update the shared settings object after a validated ORM write."""

        for field in self.RUNTIME_FIELDS:
            setattr(self, field, getattr(validated, field))

    def runtime_values(self) -> dict[str, object]:
        return {field: getattr(self, field) for field in self.RUNTIME_FIELDS}


@lru_cache
def get_settings() -> Settings:
    return Settings()
