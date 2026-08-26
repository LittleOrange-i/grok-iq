from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest

from app.core.clock import utc_now
from app.core.config import Settings
from app.services.register_integration import RegisterIntegrationService


class RegisterRepository:
    def __init__(self) -> None:
        self.completed: tuple[str, int, list[str]] | None = None
        self.retried: tuple[str, str, float] | None = None
        self.failed: tuple[str, str] | None = None
        self.bound: tuple[str, int] | None = None

    def bind_account(self, event_id: str, account_id: int) -> None:
        self.bound = (event_id, account_id)

    def complete(self, event_id: str, account_id: int, run_ids: list[str]) -> None:
        self.completed = (event_id, account_id, run_ids)

    def retry(self, event_id: str, error: str, delay_seconds: float) -> None:
        self.retried = (event_id, error, delay_seconds)

    def fail(self, event_id: str, error: str) -> None:
        self.failed = (event_id, error)


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
    assert probes.values["rounds"] == 9
    assert probes.values["proxy_targets"] == [{"kind": "current", "id": None}]
    assert repository.completed == ("event-1", 17, ["run-1"])
    assert repository.bound == ("event-1", 17)


@pytest.mark.asyncio
async def test_webhook_defers_probe_during_new_account_stabilization():
    stabilization_seconds = 15
    settings = Settings(
        initial_probe_on_register=True,
        register_probe_stabilization_seconds=stabilization_seconds,
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
            "event_id": "event-new-account",
            "attempts": 1,
            "created_at": utc_now(),
            "grok2api_account_id": 17,
            "email": "new@example.test",
            "bot_risk": False,
        }
    )

    assert repository.completed is None
    assert repository.failed is None
    assert repository.retried is not None
    assert repository.retried[0] == "event-new-account"
    assert "模型权限传播" in repository.retried[1]
    assert 1 <= repository.retried[2] <= stabilization_seconds
    assert account_service.auto_bound is False
    assert probes.values is None
    assert repository.bound == ("event-new-account", 17)


@pytest.mark.asyncio
async def test_webhook_can_disable_new_account_stabilization():
    settings = Settings(
        initial_probe_on_register=True,
        register_probe_stabilization_seconds=0,
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
            "event_id": "event-no-stabilization",
            "attempts": 1,
            "created_at": utc_now(),
            "grok2api_account_id": 17,
            "email": "new@example.test",
            "bot_risk": False,
        }
    )

    assert repository.retried is None
    assert repository.completed == ("event-no-stabilization", 17, ["run-1"])


@pytest.mark.asyncio
async def test_webhook_uses_longest_initial_readiness_delay():
    settings = Settings(
        initial_probe_on_register=True,
        register_probe_stabilization_seconds=15,
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

    original_find = account_service.find_registered_account

    async def cooling_account(account_id: int | None, email: str) -> dict[str, Any]:
        account = await original_find(account_id, email)
        return {
            **account,
            "cooldownUntil": (utc_now() + timedelta(seconds=40)).isoformat(),
        }

    account_service.find_registered_account = cooling_account  # type: ignore[method-assign]
    await service._process_claimed(
        {
            "event_id": "event-longest-readiness-delay",
            "attempts": 1,
            "created_at": utc_now(),
            "grok2api_account_id": 17,
            "email": "new@example.test",
            "bot_risk": False,
        }
    )

    assert repository.retried is not None
    assert "冷却" in repository.retried[1]
    assert 39 <= repository.retried[2] <= 40


@pytest.mark.asyncio
async def test_webhook_defers_probe_until_existing_account_cooldown_ends():
    settings = Settings(initial_probe_on_register=True)
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

    original_find = account_service.find_registered_account

    async def cooling_account(account_id: int | None, email: str) -> dict[str, Any]:
        account = await original_find(account_id, email)
        return {
            **account,
            "cooldownUntil": (utc_now() + timedelta(seconds=40)).isoformat(),
        }

    account_service.find_registered_account = cooling_account  # type: ignore[method-assign]
    await service._process_claimed(
        {
            "event_id": "event-cooling-account",
            "attempts": 2,
            "grok2api_account_id": 17,
            "email": "new@example.test",
            "bot_risk": False,
        }
    )

    assert repository.retried is not None
    assert repository.retried[0] == "event-cooling-account"
    assert "冷却" in repository.retried[1]
    assert 39 <= repository.retried[2] <= 40
    assert probes.values is None
