from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.config import DEFAULT_DATABASE_PATH, Settings
from app.persistence.database import Database
from app.persistence.models import AppSetting
from app.persistence.settings_repository import SettingsRepository
from app.services.settings_service import RuntimeSettingsService
from app.web.schemas import RuntimeSettingsInput


def build_service(tmp_path: Path) -> tuple[Database, Settings, RuntimeSettingsService]:
    settings = Settings(database_path=tmp_path / "monitor.db")
    database = Database(settings.database_path)
    database.initialize()
    repository = SettingsRepository(database, settings)
    return database, settings, RuntimeSettingsService(settings, repository)


def test_default_database_path_is_independent_of_working_directory():
    settings = Settings(_env_file=None)

    assert settings.database_path == DEFAULT_DATABASE_PATH
    assert settings.database_path == Path(__file__).resolve().parents[1] / "data" / "monitor.db"


def test_runtime_settings_are_encrypted_masked_and_reloadable(tmp_path: Path):
    database, settings, service = build_service(tmp_path)
    changed = service.update(
        {
            "grok2api_base_url": "http://grok2api.test:8000",
            "grok2api_admin_password": "secret-password",
            "probe_worker_concurrency": 4,
        }
    )
    assert changed == [
        "grok2api_admin_password",
        "grok2api_base_url",
        "probe_worker_concurrency",
    ]
    assert settings.probe_worker_concurrency == 4
    public = service.public_view()
    assert public["grok2apiAdminPasswordConfigured"] is True
    assert "secret-password" not in json.dumps(public)

    with database.session() as session:
        stored = session.scalar(select(AppSetting).where(AppSetting.key == "grok2api_admin_password"))
        assert stored is not None
        assert "secret-password" not in json.dumps(stored.value)

    reloaded_settings = Settings(database_path=tmp_path / "monitor.db")
    reloaded = RuntimeSettingsService(reloaded_settings, SettingsRepository(database, reloaded_settings))
    reloaded.load()
    assert reloaded_settings.grok2api_admin_password == "secret-password"
    assert reloaded_settings.grok2api_base_url == "http://grok2api.test:8000"


def test_blank_secret_preserves_value_and_explicit_clear_removes_it():
    keep = RuntimeSettingsInput(grok2apiAdminPassword="")
    assert "grok2api_admin_password" not in keep.runtime_changes()

    clear = RuntimeSettingsInput(clearSecrets=["grok2apiAdminPassword"])
    assert clear.runtime_changes()["grok2api_admin_password"] == ""


def test_runtime_settings_reject_invalid_threshold_order(tmp_path: Path):
    _, _, service = build_service(tmp_path)
    with pytest.raises(ValueError, match="降智信号 TPS 下限"):
        service.update({"degradation_tps": 1000, "strong_degradation_tps": 500})


def test_runtime_settings_reject_retry_wait_order(tmp_path: Path):
    _, _, service = build_service(tmp_path)
    with pytest.raises(ValueError, match="重试基础等待"):
        service.update(
            {
                "probe_transient_retry_base_seconds": 20,
                "probe_transient_retry_max_seconds": 10,
            }
        )


def test_legacy_registration_target_migrates_to_current_egress(tmp_path: Path):
    database, settings, service = build_service(tmp_path)
    repository = SettingsRepository(database, settings)
    repository.save(
        {
            "register_probe_execution_mode": "chat",
            "register_probe_proxy_targets": [{"kind": "direct", "id": None}],
        }
    )

    service.load()

    assert settings.register_probe_proxy_targets == [
        {"kind": "current", "id": None}
    ]
    assert repository.load()["register_probe_proxy_targets"] == [
        {"kind": "current", "id": None}
    ]

    service.update(
        {"register_probe_proxy_targets": [{"kind": "direct", "id": None}]}
    )
    reloaded_settings = Settings(database_path=tmp_path / "monitor.db")
    reloaded = RuntimeSettingsService(
        reloaded_settings, SettingsRepository(database, reloaded_settings)
    )
    reloaded.load()
    assert reloaded_settings.register_probe_proxy_targets == [
        {"kind": "direct", "id": None}
    ]


def test_runtime_settings_reject_mixed_current_and_diagnostic_targets(tmp_path: Path):
    _, _, service = build_service(tmp_path)
    with pytest.raises(ValueError, match="不能与诊断出口混用"):
        service.update(
            {
                "register_probe_proxy_targets": [
                    {"kind": "current", "id": None},
                    {"kind": "egress", "id": 7},
                ]
            }
        )


def test_wechat_notifications_require_the_four_test_account_values(tmp_path: Path):
    database, settings, service = build_service(tmp_path)
    with pytest.raises(ValueError, match="AppID、AppSecret、OpenID"):
        service.update({"wechat_notification_enabled": True})

    changed = service.update(
        {
            "wechat_notification_enabled": True,
            "wechat_app_id": "wx-test",
            "wechat_app_secret": "wechat-secret",
            "wechat_openid": "openid-test",
            "wechat_template_id": "template-test",
        }
    )
    assert changed == [
        "wechat_app_id",
        "wechat_app_secret",
        "wechat_notification_enabled",
        "wechat_openid",
        "wechat_template_id",
    ]
    assert settings.wechat_notification_enabled is True
    assert service.public_view()["wechatAppSecretConfigured"] is True

    with database.session() as session:
        stored = session.scalar(
            select(AppSetting).where(AppSetting.key == "wechat_app_secret")
        )
        assert stored is not None
        assert "wechat-secret" not in json.dumps(stored.value)
