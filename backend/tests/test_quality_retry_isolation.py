from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.core.config import Settings
from app.integrations.grok2api.client import IntegrationError
from app.persistence.account_repository import AccountRepository
from app.persistence.database import Database
from app.persistence.probe_repository import ProbeRepository
from app.services.account_service import AccountService
from app.services.quality_retry_isolation import (
    MISSING_THINKING_DISABLED,
    QUALITY_RETRY_NOTE,
    QualityRetryIsolationService,
)


class FakeClient:
    def __init__(self, accounts: list[dict[str, Any]]) -> None:
        self.accounts = {int(item["id"]): dict(item) for item in accounts}
        self.enabled_calls: list[tuple[int, bool]] = []
        self.list_calls: list[dict[str, Any]] = []

    async def list_all_accounts(self, **params: Any) -> list[dict[str, Any]]:
        self.list_calls.append(params)
        return [dict(item) for item in self.accounts.values()]

    async def get_account(self, account_id: int) -> dict[str, Any]:
        return dict(self.accounts[account_id])

    async def get_accounts_by_ids(self, account_ids: set[int]) -> list[dict[str, Any]]:
        return [
            dict(self.accounts[account_id])
            for account_id in sorted(account_ids)
            if account_id in self.accounts
        ]

    async def set_account_enabled(self, account_id: int, enabled: bool) -> dict[str, Any]:
        self.enabled_calls.append((account_id, enabled))
        account = self.accounts[account_id]
        account["enabled"] = enabled
        return dict(account)


def _service(
    tmp_path: Path,
    *,
    enabled: bool = True,
    auto_isolation_enabled: bool = False,
    accounts: list[dict[str, Any]] | None = None,
) -> tuple[FakeClient, AccountRepository, QualityRetryIsolationService]:
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    repo = AccountRepository(database)
    probes = ProbeRepository(database)
    client = FakeClient(
        accounts
        or [
            {
                "id": "11",
                "name": "Degraded",
                "email": "degraded@example.test",
                "enabled": False,
                "lastError": MISSING_THINKING_DISABLED,
            },
            {
                "id": "12",
                "name": "Cooldown",
                "email": "cooldown@example.test",
                "enabled": False,
                "lastError": "missing_thinking",
            },
            {
                "id": "13",
                "name": "Other",
                "email": "other@example.test",
                "enabled": False,
                "lastError": "auth_failed",
            },
        ]
    )
    settings = Settings(
        database_path=tmp_path / "grokiq.db",
        auto_isolation_enabled=auto_isolation_enabled,
        quality_retry_isolation_enabled=enabled,
    )
    accounts_service = AccountService(
        settings=settings,
        client=client,  # type: ignore[arg-type]
        accounts=repo,
        probes=probes,
    )
    scanner = QualityRetryIsolationService(
        settings=settings,
        client=client,  # type: ignore[arg-type]
        account_service=accounts_service,
    )
    return client, repo, scanner


@pytest.mark.asyncio
async def test_scan_skips_when_switch_is_off(tmp_path: Path):
    client, _repo, scanner = _service(tmp_path, enabled=False)

    result = await scanner.scan()

    assert result["ok"] is True
    assert result["skipped"] is True
    assert result["reason"] == "disabled"
    assert client.list_calls == []
    assert client.enabled_calls == []


@pytest.mark.asyncio
async def test_scan_isolates_missing_thinking_disabled_without_redisable(
    tmp_path: Path,
):
    client, repo, scanner = _service(tmp_path, auto_isolation_enabled=False)

    result = await scanner.scan()

    assert result["ok"] is True
    assert result["skipped"] is False
    assert result["scanned"] == 3
    assert result["matched"] == 1
    assert result["isolated"] == 1
    assert result["alreadyIsolated"] == 0
    assert result["failed"] == 0
    assert client.list_calls == [{"status": "disabled"}]
    assert client.enabled_calls == []
    stored = repo.get_assessment(11)
    assert stored is not None
    assert stored["monitor_status"] == "quarantined"
    assert stored["quarantine_until"] is None
    assert stored["disposition"]["source"] == "quality_retry"
    assert stored["disposition"]["sourceLabel"] == "grok2api 降智停用"
    assert stored["disposition"]["origin"] == "grok2api"
    assert stored["disposition"]["originLabel"] == "grok2api"
    assert stored["disposition"]["reason"] == QUALITY_RETRY_NOTE
    assert stored["disposition"]["evidence"] == [MISSING_THINKING_DISABLED]
    assert repo.get_assessment(12) is None
    assert repo.get_assessment(13) is None


@pytest.mark.asyncio
async def test_scan_accepts_snake_case_last_error(tmp_path: Path):
    client, repo, scanner = _service(
        tmp_path,
        accounts=[
            {
                "id": 21,
                "name": "Snake",
                "email": "snake@example.test",
                "enabled": False,
                "last_error": MISSING_THINKING_DISABLED,
            }
        ],
    )

    result = await scanner.scan()

    assert result["isolated"] == 1
    assert client.enabled_calls == []
    stored = repo.get_assessment(21)
    assert stored is not None
    assert stored["disposition"]["source"] == "quality_retry"


@pytest.mark.asyncio
async def test_scan_counts_already_isolated_without_force(tmp_path: Path):
    client, repo, scanner = _service(
        tmp_path,
        accounts=[
            {
                "id": 31,
                "name": "Existing",
                "email": "existing@example.test",
                "enabled": False,
                "lastError": MISSING_THINKING_DISABLED,
            }
        ],
    )
    repo.set_manual_status(
        account_id=31,
        status="quarantined",
        note="账号探针发现异常后自动隔离",
        quarantine_until=None,
        previous_upstream_enabled=True,
        disabled_by_monitor=True,
        source="probe",
        disposition_action="isolate",
    )

    result = await scanner.scan()

    assert result["isolated"] == 0
    assert result["alreadyIsolated"] == 1
    assert client.enabled_calls == []
    stored = repo.get_assessment(31)
    assert stored is not None
    assert stored["disposition"]["source"] == "probe"


@pytest.mark.asyncio
async def test_scan_reports_upstream_errors(tmp_path: Path):
    _client, _repo, scanner = _service(tmp_path)

    async def boom(**_params: Any) -> list[dict[str, Any]]:
        raise IntegrationError("grok2api 请求失败")

    scanner.client.list_all_accounts = boom  # type: ignore[method-assign]

    result = await scanner.scan()

    assert result["ok"] is False
    assert result["reason"] == "upstream_error"
    assert "grok2api" in result["error"]
