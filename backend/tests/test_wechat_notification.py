from __future__ import annotations

from typing import Any

import pytest

from app.core.config import Settings
from app.services.wechat_notification import WeChatAccountNotificationService


class StubWeChatClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def reset_credentials(self) -> None:
        return None

    async def send_to_recipient(
        self,
        *,
        template_data: dict[str, dict[str, str]],
    ) -> dict[str, Any]:
        self.calls.append(template_data)
        return {
            "sent": 1,
            "messages": [{"openId": "openid-test", "messageId": "message-1"}],
        }


def build_service(
    *, enabled: bool = True
) -> tuple[Settings, StubWeChatClient, WeChatAccountNotificationService]:
    settings = Settings(
        _env_file=None,
        wechat_notification_enabled=enabled,
        wechat_app_id="wx-test",
        wechat_app_secret="secret-test",
        wechat_openid="openid-test",
        wechat_template_id="template-test",
    )
    client = StubWeChatClient()
    service = WeChatAccountNotificationService(settings, client)  # type: ignore[arg-type]
    return settings, client, service


@pytest.mark.asyncio
async def test_disabled_notification_does_not_send():
    _, client, service = build_service(enabled=False)

    result = await service.notify_account_transition(
        account={"id": 7, "name": "demo"},
        previous=None,
        current={"monitor_status": "watch", "risk_score": 20},
        source="probe",
    )

    assert result == {"sent": 0, "skipped": "disabled"}
    assert client.calls == []


@pytest.mark.asyncio
async def test_status_transition_sends_compact_template_payload():
    _, client, service = build_service()

    result = await service.notify_account_transition(
        account={"id": 7, "name": "demo", "email": "demo@example.com"},
        previous={"monitor_status": "watch"},
        current={
            "monitor_status": "high_risk",
            "risk_score": 86.5,
            "latest_tps": 628.4,
            "avg_tps": 412.7,
            "risk_reasons": ["连续异常达到阈值"],
        },
        source="probe",
    )

    assert result["sent"] == 1
    assert len(client.calls) == 1
    payload = client.calls[0]
    assert payload["first"]["value"] == "账号异常提醒"
    assert payload["account"]["value"] == "demo (demo@example.com) · #7"
    assert payload["status"]["value"] == "高风险（high_risk）"
    assert payload["score"]["value"] == "86.5"
    assert payload["tps"]["value"] == "最新 628.4 · 平均 412.7"
    assert "连续异常达到阈值" in payload["reason"]["value"]


@pytest.mark.asyncio
async def test_same_status_does_not_repeat_notification():
    _, client, service = build_service()

    result = await service.notify_account_transition(
        account={"id": 7},
        previous={"monitor_status": "high_risk"},
        current={"monitor_status": "high_risk"},
        source="probe",
    )

    assert result == {"sent": 0, "skipped": "unchanged"}
    assert client.calls == []
