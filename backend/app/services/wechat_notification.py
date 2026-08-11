from __future__ import annotations

from datetime import datetime
from typing import Any

from app.core.clock import app_now, to_app_timezone
from app.core.config import Settings
from app.integrations.wechat.client import WeChatTestAccountClient

ABNORMAL_STATUS_RANK = {
    "watch": 1,
    "suspect": 2,
    "high_risk": 3,
    "quarantined": 4,
}
STATUS_LABELS = {
    "watch": "观察中",
    "suspect": "疑似异常",
    "high_risk": "高风险",
    "quarantined": "已隔离",
}
STATUS_COLORS = {
    "watch": "#D97706",
    "suspect": "#EA580C",
    "high_risk": "#DC2626",
    "quarantined": "#991B1B",
}
SOURCE_LABELS = {
    "probe": "自动探针",
    "grok-register": "grok-register",
    "test": "配置测试",
}
DEFAULT_NOTIFICATION_TITLE = "账号异常提醒"
DEFAULT_NOTIFICATION_REMARK = "请登录监控后台查看样本证据并及时处理。"


def _compact(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


def _field(value: Any, color: str = "") -> dict[str, str]:
    result = {"value": str(value)}
    if color:
        result["color"] = color
    return result


class WeChatAccountNotificationService:
    """Build and send one message when an account enters or escalates risk."""

    def __init__(self, settings: Settings, client: WeChatTestAccountClient):
        self.settings = settings
        self.client = client

    def reset_credentials(self) -> None:
        self.client.reset_credentials()

    @staticmethod
    def should_notify(
        previous: dict[str, Any] | None,
        current: dict[str, Any],
    ) -> bool:
        current_rank = ABNORMAL_STATUS_RANK.get(
            str(current.get("monitor_status") or ""), 0
        )
        previous_rank = ABNORMAL_STATUS_RANK.get(
            str((previous or {}).get("monitor_status") or ""), 0
        )
        return current_rank > 0 and current_rank > previous_rank

    @staticmethod
    def _account_text(account: dict[str, Any]) -> str:
        account_id = int(account.get("id") or account.get("account_id") or 0)
        name = _compact(account.get("name"), 60)
        email = _compact(account.get("email"), 80)
        label = name or email or "未命名账号"
        if name and email:
            label = f"{name} ({email})"
        return _compact(f"{label} · #{account_id}", 150)

    @staticmethod
    def _message_time(current: dict[str, Any]) -> str:
        value = current.get("updated_at") or current.get("latest_sample_at")
        if isinstance(value, datetime):
            timestamp = to_app_timezone(value) or app_now()
        else:
            timestamp = app_now()
        return timestamp.strftime("%Y-%m-%d %H:%M:%S")

    def build_template_data(
        self,
        *,
        account: dict[str, Any],
        current: dict[str, Any],
        source: str,
    ) -> dict[str, dict[str, str]]:
        status = str(current.get("monitor_status") or "watch")
        reasons = [
            _compact(value, 100)
            for value in (current.get("risk_reasons") or [])
            if _compact(value, 100)
        ]
        reason = "；".join(reasons) or _compact(
            current.get("latest_classification") or "检测到异常样本", 180
        )
        latest_tps = float(current.get("latest_tps") or 0)
        average_tps = float(current.get("avg_tps") or 0)
        source_label = SOURCE_LABELS.get(source, source or "系统")
        remark = _compact(
            f"{DEFAULT_NOTIFICATION_REMARK} 来源：{source_label}",
            220,
        )
        return {
            "first": _field(
                DEFAULT_NOTIFICATION_TITLE,
                STATUS_COLORS.get(status, "#D97706"),
            ),
            "account": _field(self._account_text(account)),
            "status": _field(
                f"{STATUS_LABELS.get(status, status)}（{status}）",
                STATUS_COLORS.get(status, "#D97706"),
            ),
            "score": _field(f"{float(current.get('risk_score') or 0):.1f}"),
            "tps": _field(f"最新 {latest_tps:.1f} · 平均 {average_tps:.1f}"),
            "reason": _field(_compact(reason, 200)),
            "time": _field(self._message_time(current)),
            "remark": _field(remark),
        }

    async def notify_account_transition(
        self,
        *,
        account: dict[str, Any],
        previous: dict[str, Any] | None,
        current: dict[str, Any],
        source: str,
    ) -> dict[str, Any]:
        if not self.settings.wechat_notification_enabled:
            return {"sent": 0, "skipped": "disabled"}
        if not self.should_notify(previous, current):
            return {"sent": 0, "skipped": "unchanged"}
        return await self.client.send_to_recipient(
            template_data=self.build_template_data(
                account=account,
                current=current,
                source=source,
            ),
        )

    async def send_test(self) -> dict[str, Any]:
        if not self.settings.wechat_notification_enabled:
            raise ValueError("请先开启微信异常账号推送并保存设置")
        account = {
            "id": 10001,
            "name": "测试账号",
            "email": "test@example.com",
        }
        current = {
            "monitor_status": "high_risk",
            "risk_score": 86.5,
            "latest_tps": 628.4,
            "avg_tps": 412.7,
            "risk_reasons": ["连续异常达到阈值", "异常覆盖多个出口"],
            "updated_at": app_now(),
        }
        result = await self.client.send_to_recipient(
            template_data=self.build_template_data(
                account=account,
                current=current,
                source="test",
            ),
        )
        return {**result, "templateId": self.settings.wechat_template_id}
