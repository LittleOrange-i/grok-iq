from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select

from app.core.config import Settings

from .database import Database
from .models import AppSetting, MetadataRow


class RuntimeSecretCipher:
    """Encrypt runtime credentials stored in the GrokIQ database."""

    def __init__(self, settings: Settings):
        key = settings.runtime_secret_key.strip().encode()
        if not key:
            key = self._load_or_create_key(settings.database_path)
        try:
            self._fernet = Fernet(key)
        except (TypeError, ValueError) as exc:
            raise ValueError("GROKIQ_RUNTIME_SECRET_KEY 不是有效的 Fernet key") from exc

    @staticmethod
    def _load_or_create_key(database_path: Path) -> bytes:
        path = database_path.resolve().with_suffix(".settings.key")
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            return path.read_bytes().strip()
        key = Fernet.generate_key()
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.write(descriptor, key + b"\n")
        finally:
            os.close(descriptor)
        return key

    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: str) -> str:
        try:
            return self._fernet.decrypt(value.encode()).decode()
        except (InvalidToken, ValueError) as exc:
            raise ValueError("运行时密钥解密失败，请检查本地 settings key") from exc


class SettingsRepository:
    LEGACY_RUNTIME_FIELD_MAP = {
        "soft_tps": "degradation_tps",
        "hard_tps": "strong_degradation_tps",
    }

    def __init__(self, database: Database, settings: Settings):
        self.database = database
        self.cipher = RuntimeSecretCipher(settings)

    def load(self) -> dict[str, Any]:
        with self.database.session() as session:
            rows = session.scalars(select(AppSetting)).all()
            result: dict[str, Any] = {}
            for row in rows:
                key = self.LEGACY_RUNTIME_FIELD_MAP.get(row.key, row.key)
                if key not in Settings.RUNTIME_FIELDS:
                    continue
                value = row.value
                if key in Settings.SECRET_RUNTIME_FIELDS:
                    if not isinstance(value, dict) or not isinstance(value.get("ciphertext"), str):
                        continue
                    value = self.cipher.decrypt(value["ciphertext"])
                if row.key in self.LEGACY_RUNTIME_FIELD_MAP:
                    result.setdefault(key, value)
                else:
                    result[key] = value
            return result

    def save(self, values: dict[str, Any]) -> None:
        with self.database.transaction() as session:
            for key, value in values.items():
                if key not in Settings.RUNTIME_FIELDS:
                    continue
                stored: Any = value
                if key in Settings.SECRET_RUNTIME_FIELDS:
                    stored = {"ciphertext": self.cipher.encrypt(str(value))}
                row = session.get(AppSetting, key)
                if row is None:
                    session.add(AppSetting(key=key, value=stored))
                else:
                    row.value = stored

    def migration_applied(self, key: str) -> bool:
        with self.database.session() as session:
            return session.get(MetadataRow, key) is not None

    def mark_migration_applied(self, key: str) -> None:
        with self.database.transaction() as session:
            if session.get(MetadataRow, key) is None:
                session.add(MetadataRow(key=key, value="applied"))
