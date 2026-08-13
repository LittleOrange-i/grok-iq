from __future__ import annotations

from typing import Any

from app.core.config import (
    DEFAULT_REGISTER_PROBE_PROFILE_IDS,
    REGISTER_PROBE_EXECUTION_MODE,
    REGISTER_PROBE_PROXY_TARGETS,
    REGISTER_PROBE_ROUNDS,
    Settings,
)
from app.persistence.settings_repository import SettingsRepository
from app.services.runtime_settings_validator import RuntimeSettingsValidator

REGISTER_FIXED_STRATEGY_MIGRATION_KEY = "register_probe_fixed_strategy_v2"
INITIAL_ONBOARDING_COMPLETED_KEY = "initial_onboarding_completed_v1"


def fixed_register_probe_strategy() -> dict[str, Any]:
    return {
        "register_probe_execution_mode": REGISTER_PROBE_EXECUTION_MODE,
        "register_probe_rounds": REGISTER_PROBE_ROUNDS,
        "register_probe_proxy_targets": [
            dict(target) for target in REGISTER_PROBE_PROXY_TARGETS
        ],
    }


class RuntimeSettingsService:
    """Validates, persists, masks, and hot-applies operator settings."""

    _validator = RuntimeSettingsValidator()

    def __init__(self, settings: Settings, repository: SettingsRepository):
        self.settings = settings
        self.repository = repository

    def load(self) -> None:
        overrides = self.repository.load()
        if not self.repository.migration_applied(
            REGISTER_FIXED_STRATEGY_MIGRATION_KEY
        ):
            migrated = {
                "initial_probe_on_register": True,
                **fixed_register_probe_strategy(),
            }
            profiles = overrides.get("register_probe_profile_ids")
            if not isinstance(profiles, list) or not any(
                str(profile or "").strip() for profile in profiles
            ):
                migrated["register_probe_profile_ids"] = list(
                    DEFAULT_REGISTER_PROBE_PROFILE_IDS
                )
            overrides.update(migrated)
            self.repository.save(migrated)
            self.repository.mark_migration_applied(
                REGISTER_FIXED_STRATEGY_MIGRATION_KEY
            )
        if not overrides:
            return
        candidate = self._validate(self.settings.model_dump() | overrides)
        self.settings.apply_runtime(candidate)

    def update(self, values: dict[str, Any]) -> list[str]:
        changes = {
            key: value for key, value in values.items() if key in Settings.RUNTIME_FIELDS
        }
        if not changes:
            return []
        candidate = self._validate(self.settings.model_dump() | changes)
        normalized = {key: getattr(candidate, key) for key in changes}
        self.repository.save(normalized)
        self.settings.apply_runtime(candidate)
        return sorted(normalized)

    @classmethod
    def _validate(cls, values: dict[str, Any]) -> Settings:
        return cls._validator.validate(values, fixed_register_probe_strategy())

    def public_view(self) -> dict[str, Any]:
        s = self.settings
        return {
            "grok2apiBaseUrl": s.grok2api_base_url,
            "grok2apiAdminUsername": s.grok2api_admin_username,
            "grok2apiAdminPasswordConfigured": bool(s.grok2api_admin_password),
            "grok2apiHttpImpersonate": s.grok2api_http_impersonate,
            "grokRegisterWebhookTokenConfigured": bool(s.grok_register_webhook_token),
            "initialProbeOnRegister": s.initial_probe_on_register,
            "registerProbeStabilizationSeconds": (
                s.register_probe_stabilization_seconds
            ),
            "registerProbeProfileIds": s.register_probe_profile_ids,
            "registerProbeExecutionMode": s.register_probe_execution_mode,
            "registerProbeRounds": s.register_probe_rounds,
            "registerProbeProxyTargets": s.register_probe_proxy_targets,
            "wechatNotificationEnabled": s.wechat_notification_enabled,
            "wechatAppId": s.wechat_app_id,
            "wechatAppSecretConfigured": bool(s.wechat_app_secret),
            "wechatOpenid": s.wechat_openid,
            "wechatTemplateId": s.wechat_template_id,
            "schedulerEnabled": s.scheduler_enabled,
            "quarantineRecoveryEnabled": s.quarantine_recovery_enabled,
            "schedulerTimezone": s.scheduler_timezone,
            "schedulerMisfireGraceSeconds": s.scheduler_misfire_grace_seconds,
            "recoveryCron": s.recovery_cron,
            "scheduledProbeRegisterCooldownMinutes": (
                s.scheduled_probe_register_cooldown_minutes
            ),
            "probeWorkerConcurrency": s.probe_worker_concurrency,
            "probeQueueLimit": s.probe_queue_limit,
            "probeStepDelaySeconds": s.probe_step_delay_seconds,
            "probeCurrentEgressIntervalSeconds": s.probe_current_egress_interval_seconds,
            "probeTransientRetryAttempts": s.probe_transient_retry_attempts,
            "probeTransientRetryBaseSeconds": s.probe_transient_retry_base_seconds,
            "probeTransientRetryMaxSeconds": s.probe_transient_retry_max_seconds,
            "probeRoutePrefix": s.probe_route_prefix,
            "probeDiagnosticPriority": s.probe_diagnostic_priority,
            "analysisWindowHours": s.analysis_window_hours,
            "degradationTps": s.degradation_tps,
            "strongDegradationTps": s.strong_degradation_tps,
            "consecutiveAnomalies": s.consecutive_anomalies,
            "cumulativeAnomalyRate": s.cumulative_anomaly_rate,
            "highRiskHardCount": s.high_risk_hard_count,
            "riskAnomalyRateWeight": s.risk_anomaly_rate_weight,
            "riskHardWeight": s.risk_hard_weight,
            "riskHardCap": s.risk_hard_cap,
            "riskFastWeight": s.risk_fast_weight,
            "riskFastCap": s.risk_fast_cap,
            "riskMarkerMissWeight": s.risk_marker_miss_weight,
            "riskMarkerMissCap": s.risk_marker_miss_cap,
            "riskStreakWeight": s.risk_streak_weight,
            "riskStreakCap": s.risk_streak_cap,
            "riskScoreCap": s.risk_score_cap,
            "riskWatchFloor": s.risk_watch_floor,
            "riskSuspectFloor": s.risk_suspect_floor,
            "riskHighFloor": s.risk_high_floor,
            "bufferFirstTokenShare": s.buffer_first_token_share,
            "minGenerationMs": s.min_generation_ms,
            "minimumOutputTokens": s.minimum_output_tokens,
            "autoQuarantine": s.auto_quarantine,
            "quarantineMinutes": s.quarantine_minutes,
            "bootstrap": {
                "host": s.host,
                "port": s.port,
                "databasePath": str(s.database_path),
                "corsOrigins": s.cors_origin_list,
            },
        }

    def onboarding_view(self) -> dict[str, Any]:
        requirements = {
            "grok2apiBaseUrl": bool(self.settings.grok2api_base_url.strip()),
            "grok2apiAdminUsername": bool(
                self.settings.grok2api_admin_username.strip()
            ),
            "grok2apiAdminPassword": bool(self.settings.grok2api_admin_password),
        }
        return {
            "completed": self.repository.flag_exists(
                INITIAL_ONBOARDING_COMPLETED_KEY
            ),
            "ready": all(requirements.values()),
            "requirements": requirements,
        }

    def complete_onboarding(self) -> dict[str, Any]:
        state = self.onboarding_view()
        if not state["ready"]:
            raise ValueError("请先补全 grok2api 地址、管理员用户名和密码")
        self.repository.set_flag(INITIAL_ONBOARDING_COMPLETED_KEY)
        return self.onboarding_view()

    def reveal_secret(self, name: str) -> str:
        """Return one persisted runtime secret for the authenticated settings UI."""

        secrets = {
            "grok2apiAdminPassword": self.settings.grok2api_admin_password,
            "grokRegisterWebhookToken": self.settings.grok_register_webhook_token,
            "wechatAppSecret": self.settings.wechat_app_secret,
        }
        if name not in secrets:
            raise ValueError("不支持读取该敏感设置")
        return secrets[name]
