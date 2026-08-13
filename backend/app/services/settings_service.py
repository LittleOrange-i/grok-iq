from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.triggers.cron import CronTrigger

from app.core.config import (
    DEFAULT_REGISTER_PROBE_PROFILE_IDS,
    REGISTER_PROBE_EXECUTION_MODE,
    REGISTER_PROBE_PROXY_TARGETS,
    REGISTER_PROBE_ROUNDS,
    Settings,
)
from app.persistence.settings_repository import SettingsRepository

REGISTER_FIXED_STRATEGY_MIGRATION_KEY = "register_probe_fixed_strategy_v2"


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

    @staticmethod
    def _validate(values: dict[str, Any]) -> Settings:
        candidate = Settings.model_validate(values | fixed_register_probe_strategy())
        if candidate.degradation_tps >= candidate.strong_degradation_tps:
            raise ValueError("降智信号 TPS 下限必须小于强降智信号 TPS 下限")
        if not (
            candidate.risk_watch_floor
            <= candidate.risk_suspect_floor
            <= candidate.risk_high_floor
            <= candidate.risk_score_cap
        ):
            raise ValueError("风险状态保底分必须满足观察 ≤ 疑似 ≤ 高风险 ≤ 总分上限")
        for label, weight, cap in (
            ("强信号", candidate.risk_hard_weight, candidate.risk_hard_cap),
            ("持续高速", candidate.risk_fast_weight, candidate.risk_fast_cap),
            (
                "标记缺失",
                candidate.risk_marker_miss_weight,
                candidate.risk_marker_miss_cap,
            ),
            ("连续信号", candidate.risk_streak_weight, candidate.risk_streak_cap),
        ):
            if weight > 0 and cap <= 0:
                raise ValueError(f"{label}权重大于 0 时封顶分必须大于 0")
        if candidate.probe_transient_retry_base_seconds > candidate.probe_transient_retry_max_seconds:
            raise ValueError("探针重试基础等待不能大于最大等待")
        parsed = urlsplit(candidate.grok2api_base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("grok2api 地址必须是有效的 HTTP(S) URL")
        try:
            zone = ZoneInfo(candidate.scheduler_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("调度时区名称无效") from exc
        try:
            CronTrigger.from_crontab(candidate.recovery_cron, timezone=zone)
        except ValueError as exc:
            raise ValueError(f"隔离恢复 Cron 表达式无效: {exc}") from exc
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{1,47}", candidate.probe_route_prefix):
            raise ValueError("临时资源前缀需为 2-48 位字母、数字、下划线或连字符")
        profile_ids = list(
            dict.fromkeys(
                str(value or "").strip()
                for value in candidate.register_probe_profile_ids
                if str(value or "").strip()
            )
        )
        if candidate.initial_probe_on_register and not profile_ids:
            raise ValueError("注册后探针至少选择一个探针方案")
        if candidate.register_probe_execution_mode not in {"chat", "quality_test"}:
            raise ValueError("注册探针执行模式无效")
        targets: list[dict[str, Any]] = []
        seen_targets: set[tuple[str, int | None]] = set()
        for raw in candidate.register_probe_proxy_targets:
            kind = str(raw.get("kind") or "").strip()
            raw_id = raw.get("id")
            if kind in {"current", "direct"}:
                target_id = None
            elif kind == "egress":
                try:
                    target_id = int(raw_id)
                except (TypeError, ValueError) as exc:
                    raise ValueError("注册探针出口节点 ID 无效") from exc
                if target_id <= 0:
                    raise ValueError("注册探针出口节点 ID 必须大于 0")
            else:
                raise ValueError("注册探针出口目标类型无效")
            key = (kind, target_id)
            if key not in seen_targets:
                targets.append({"kind": kind, "id": target_id})
                seen_targets.add(key)
        if candidate.initial_probe_on_register and not targets:
            raise ValueError("注册后探针至少选择一个出口目标")
        if candidate.register_probe_execution_mode == "quality_test" and any(
            target["kind"] != "egress" for target in targets
        ):
            raise ValueError("快速出口质量探针仅支持 grok_build 出口节点")
        if any(target["kind"] == "current" for target in targets) and any(
            target["kind"] != "current" for target in targets
        ):
            raise ValueError("账号当前出口不能与诊断出口混用")
        candidate.register_probe_profile_ids = profile_ids
        candidate.register_probe_proxy_targets = targets

        candidate.wechat_app_id = candidate.wechat_app_id.strip()
        candidate.wechat_app_secret = candidate.wechat_app_secret.strip()
        candidate.wechat_openid = candidate.wechat_openid.strip()
        candidate.wechat_template_id = candidate.wechat_template_id.strip()
        if candidate.wechat_notification_enabled:
            required = {
                "AppID": candidate.wechat_app_id,
                "AppSecret": candidate.wechat_app_secret,
                "OpenID": candidate.wechat_openid,
                "模板 ID": candidate.wechat_template_id,
            }
            missing = [label for label, value in required.items() if not value]
            if missing:
                raise ValueError(f"开启微信异常推送前请填写：{'、'.join(missing)}")
        return candidate

    def public_view(self) -> dict[str, Any]:
        s = self.settings
        return {
            "grok2apiBaseUrl": s.grok2api_base_url,
            "grok2apiAdminUsername": s.grok2api_admin_username,
            "grok2apiAdminPasswordConfigured": bool(s.grok2api_admin_password),
            "grok2apiHttpImpersonate": s.grok2api_http_impersonate,
            "grokRegisterWebhookTokenConfigured": bool(s.grok_register_webhook_token),
            "initialProbeOnRegister": s.initial_probe_on_register,
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
