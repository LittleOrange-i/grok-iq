from __future__ import annotations

import stat
from pathlib import Path

import pytest

from app.core.config import Settings
from app.persistence.auth_repository import AdminAlreadyExistsError, AuthRepository
from app.persistence.database import Database
from app.services.auth_service import AuthenticationError, AuthService


def build_service(
    tmp_path: Path,
    *,
    configured_secret: bool = True,
) -> tuple[Database, AuthService]:
    settings = Settings(
        _env_file=None,
        database_path=tmp_path / "grokiq.db",
        jwt_secret_key="s" * 48 if configured_secret else "",
        jwt_ttl_seconds=7 * 24 * 60 * 60,
    )
    database = Database(settings.database_path)
    database.initialize()
    return database, AuthService(settings, AuthRepository(database))


def test_first_admin_setup_login_and_logout_revocation(tmp_path: Path):
    database, service = build_service(tmp_path)

    assert service.setup_required() is True
    session = service.setup("admin", "password123", "password123")
    assert session["user"] == {"id": 1, "username": "admin", "role": "admin"}
    assert service.setup_required() is False
    assert service.authenticate_authorization(
        f"Bearer {session['accessToken']}"
    )["username"] == "admin"

    with pytest.raises(AdminAlreadyExistsError):
        service.setup("other", "password123", "password123")
    with pytest.raises(AuthenticationError, match="用户名或密码错误"):
        service.login("admin", "wrong-password")

    service.logout(service.authenticate_authorization(f"Bearer {session['accessToken']}"))
    with pytest.raises(AuthenticationError, match="登录已失效"):
        service.authenticate_authorization(f"Bearer {session['accessToken']}")

    replacement = service.login("admin", "password123")
    assert replacement["accessToken"] != session["accessToken"]
    database.dispose()


def test_generated_jwt_secret_is_private_and_persistent(tmp_path: Path):
    database, service = build_service(tmp_path, configured_secret=False)
    secret_path = tmp_path / "grokiq.jwt.key"

    assert secret_path.read_text(encoding="utf-8").strip() == service.secret
    assert stat.S_IMODE(secret_path.stat().st_mode) == 0o600

    second = AuthService(service.settings, AuthRepository(database))
    assert second.secret == service.secret
    database.dispose()
