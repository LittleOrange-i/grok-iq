from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from app.persistence.probe_repository import AccountSettingsSnapshot
from app.services.probe_cleanup import ProbeCleanupCoordinator


def _snapshot(*, enabled: bool) -> AccountSettingsSnapshot:
    return AccountSettingsSnapshot(
        enabled=enabled,
        priority=7,
        max_concurrent=4,
        egress_node_id=None,
        egress_assignment_mode="",
        diagnostic_priority=-1_000_000,
        diagnostic_max_concurrent=1,
    )


def _coordinator(
    *,
    isolated: bool = False,
    monitor_status: str = "healthy",
) -> tuple[ProbeCleanupCoordinator, AsyncMock, MagicMock]:
    repository = MagicMock()
    client = AsyncMock()
    accounts = MagicMock()
    if isolated:
        accounts.get_assessment.return_value = {
            "monitor_status": monitor_status,
            "disabled_by_monitor": True,
        }
    else:
        accounts.get_assessment.return_value = {
            "monitor_status": monitor_status,
            "disabled_by_monitor": False,
        }
    coordinator = ProbeCleanupCoordinator(repository, client, accounts)
    return coordinator, client, repository


async def test_diagnostic_restore_keeps_isolated_account_disabled():
    coordinator, client, repository = _coordinator(
        isolated=True, monitor_status="quarantined"
    )

    await coordinator.restore_diagnostic_activation(
        run_id="run-1",
        account_id=11,
        snapshot=_snapshot(enabled=True),
    )

    client.set_account_routing_settings.assert_awaited_once()
    assert client.set_account_routing_settings.await_args.kwargs["enabled"] is False
    repository.set_diagnostic_activation.assert_called_once_with("run-1", False)


async def test_diagnostic_restore_reenable_healthy_snapshot():
    coordinator, client, _repository = _coordinator(isolated=False)

    await coordinator.restore_diagnostic_activation(
        run_id="run-1",
        account_id=11,
        snapshot=_snapshot(enabled=True),
    )

    assert client.set_account_routing_settings.await_args.kwargs["enabled"] is True


async def test_cleanup_force_disables_isolated_account_after_enabled_probe():
    coordinator, client, repository = _coordinator(
        isolated=True, monitor_status="quarantined"
    )
    repository.get_run.return_value = {
        "diagnostic_activation_active": False,
        "account_restore_status": "",
    }

    result = await coordinator.cleanup(
        run_id="run-1",
        account_id=11,
        snapshot=_snapshot(enabled=True),
        legacy_original_node_id=None,
        legacy_original_mode="",
        route_id="route-1",
        client_key_id="key-1",
        restore_egress=False,
        source="automatic",
    )

    assert result.account_errors == []
    client.set_account_enabled.assert_awaited_once_with(11, False)
    client.set_account_routing_settings.assert_not_called()


async def test_cleanup_does_not_touch_enabled_when_account_is_healthy():
    coordinator, client, repository = _coordinator(isolated=False)
    repository.get_run.return_value = {
        "diagnostic_activation_active": False,
        "account_restore_status": "",
    }

    await coordinator.cleanup(
        run_id="run-1",
        account_id=11,
        snapshot=_snapshot(enabled=True),
        legacy_original_node_id=None,
        legacy_original_mode="",
        route_id="route-1",
        client_key_id="key-1",
        restore_egress=False,
        source="automatic",
    )

    client.set_account_enabled.assert_not_called()
    client.set_account_routing_settings.assert_not_called()
