from __future__ import annotations

import re
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.triggers.cron import CronTrigger

from app.core.config import Settings
from app.integrations.sso import normalize_proxy


class RuntimeSettingsValidator:
    """Applies cross-field validation and normalization to runtime settings."""

    def validate(self, values: dict[str, object], fixed_strategy: dict[str, object]) -> Settings:
        candidate = Settings.model_validate(values | fixed_strategy)
        self._validate_risk(candidate)
        self._validate_request_audit(candidate)
        self._validate_retry(candidate)
        self._validate_connection(candidate)
        self._validate_scheduler(candidate)
        self._validate_route_prefix(candidate)
        self._normalize_register_strategy(candidate)
        self._normalize_wechat(candidate)
        self._normalize_sso_proxy(candidate)
        return candidate

    @staticmethod
    def _validate_risk(candidate: Settings) -> None:
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

    @staticmethod
    def _validate_retry(candidate: Settings) -> None:
        if candidate.probe_transient_retry_base_seconds > candidate.probe_transient_retry_max_seconds:
            raise ValueError("探针重试基础等待不能大于最大等待")

    @staticmethod
    def _validate_request_audit(candidate: Settings) -> None:
        if not (
            candidate.request_audit_busy_scan_interval_seconds
            <= candidate.request_audit_normal_scan_interval_seconds
            <= candidate.request_audit_idle_scan_interval_seconds
        ):
            raise ValueError("请求审计间隔必须满足忙时 ≤ 常态 ≤ 闲时")

    @staticmethod
    def _validate_connection(candidate: Settings) -> None:
        parsed = urlsplit(candidate.grok2api_base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("grok2api 地址必须是有效的 HTTP(S) URL")

    @staticmethod
    def _validate_scheduler(candidate: Settings) -> None:
        try:
            zone = ZoneInfo(candidate.scheduler_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("调度时区名称无效") from exc
        try:
            CronTrigger.from_crontab(candidate.recovery_cron, timezone=zone)
        except ValueError as exc:
            raise ValueError(f"隔离恢复 Cron 表达式无效: {exc}") from exc

    @staticmethod
    def _validate_route_prefix(candidate: Settings) -> None:
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{1,47}", candidate.probe_route_prefix):
            raise ValueError("临时资源前缀需为 2-48 位字母、数字、下划线或连字符")

    def _normalize_register_strategy(self, candidate: Settings) -> None:
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
        targets = self._normalize_register_targets(candidate.register_probe_proxy_targets)
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

    @staticmethod
    def _normalize_register_targets(
        raw_targets: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        targets: list[dict[str, object]] = []
        seen_targets: set[tuple[str, int | None]] = set()
        for raw in raw_targets:
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
        return targets

    @staticmethod
    def _normalize_wechat(candidate: Settings) -> None:
        candidate.wechat_app_id = candidate.wechat_app_id.strip()
        candidate.wechat_app_secret = candidate.wechat_app_secret.strip()
        candidate.wechat_openid = candidate.wechat_openid.strip()
        candidate.wechat_template_id = candidate.wechat_template_id.strip()
        if not candidate.wechat_notification_enabled:
            return
        required = {
            "AppID": candidate.wechat_app_id,
            "AppSecret": candidate.wechat_app_secret,
            "OpenID": candidate.wechat_openid,
            "模板 ID": candidate.wechat_template_id,
        }
        missing = [label for label, value in required.items() if not value]
        if missing:
            raise ValueError(f"开启微信异常推送前请填写：{'、'.join(missing)}")

    @staticmethod
    def _normalize_sso_proxy(candidate: Settings) -> None:
        raw = (candidate.sso_proxy or "").strip()
        if not raw:
            candidate.sso_proxy = ""
            return
        candidate.sso_proxy = normalize_proxy(raw)
