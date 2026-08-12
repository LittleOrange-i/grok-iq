from __future__ import annotations

from typing import Any

import pytest

from app.core.config import Settings
from app.services.register_integration import RegisterIntegrationService


class RegisterRepository:
    def __init__(self) -> None:
        self.completed: tuple[str, int, list[str]] | None = None

    def complete(self, event_id: str, account_id: int, run_ids: list[str]) -> None:
        self.completed = (event_id, account_id, run_ids)


class RegisterAccountService:
    def __init__(self) -> None:
        self.auto_bound = False

    async def find_registered_account(
        self,
        account_id: int | None,
        email: str,
    ) -> dict[str, Any]:
        return {
            "id": str(account_id or 17),
            "email": email,
            "enabled": True,
            "authStatus": "active",
            "egressNodeId": None,
        }

    async def ensure_account_egress(self, account: dict[str, Any]) -> dict[str, Any]:
        self.auto_bound = True
        return {
            **account,
            "egressNodeId": "3",
            "egressAssignmentMode": "auto",
        }


class RegisterProbeManager:
    def __init__(self) -> None:
        self.account: dict[str, Any] | None = None
        self.values: dict[str, Any] | None = None

    async def enqueue_register_event(self, **values: Any) -> dict[str, Any]:
        self.values = values
        self.account = values["account"]
        return {"runIds": ["run-1"]}


class UnusedAccountRepository:
    pass


@pytest.mark.asyncio
async def test_webhook_auto_binds_before_enqueue():
    settings = Settings(
        initial_probe_on_register=True,
        register_probe_profile_ids=["profile-a", "profile-b"],
        register_probe_execution_mode="quality_test",
        register_probe_rounds=9,
        register_probe_proxy_targets=[{"kind": "egress", "id": 7}],
    )
    repository = RegisterRepository()
    account_service = RegisterAccountService()
    probes = RegisterProbeManager()
    service = RegisterIntegrationService(
        settings=settings,
        repository=repository,  # type: ignore[arg-type]
        accounts=UnusedAccountRepository(),  # type: ignore[arg-type]
        account_service=account_service,  # type: ignore[arg-type]
        probes=probes,  # type: ignore[arg-type]
    )

    await service._process_claimed(
        {
            "event_id": "event-1",
            "attempts": 1,
            "grok2api_account_id": 17,
            "email": "new@example.test",
            "bot_risk": False,
        }
    )

    assert account_service.auto_bound is True
    assert probes.account is not None
    assert probes.account["egressNodeId"] == "3"
    assert probes.values is not None
    assert probes.values["profile_ids"] == ["profile-a", "profile-b"]
    assert probes.values["execution_mode"] == "chat"
    assert probes.values["rounds"] == 3
    assert probes.values["proxy_targets"] == [{"kind": "current", "id": None}]
    assert repository.completed == ("event-1", 17, ["run-1"])
