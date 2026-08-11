from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import select, update

from app.core.config import Settings

from .database import Database
from .models import ChatProvider
from .settings_repository import RuntimeSecretCipher


class ChatProviderRepository:
    """ORM persistence for playground provider configuration and secrets."""

    def __init__(self, database: Database, settings: Settings):
        self.database = database
        self.cipher = RuntimeSecretCipher(settings)

    def list(self) -> list[dict[str, Any]]:
        with self.database.session() as session:
            rows = session.scalars(
                select(ChatProvider).order_by(
                    ChatProvider.is_default.desc(),
                    ChatProvider.created_at.asc(),
                )
            ).all()
            return [self._serialize(row) for row in rows]

    def get(
        self,
        provider_id: str,
        *,
        reveal_secret: bool = False,
    ) -> dict[str, Any] | None:
        with self.database.session() as session:
            row = session.get(ChatProvider, provider_id)
            return self._serialize(row, reveal_secret=reveal_secret) if row else None

    def get_default(
        self,
        *,
        reveal_secret: bool = False,
    ) -> dict[str, Any] | None:
        with self.database.session() as session:
            row = session.scalar(
                select(ChatProvider)
                .where(ChatProvider.enabled.is_(True))
                .order_by(ChatProvider.is_default.desc(), ChatProvider.created_at.asc())
                .limit(1)
            )
            return self._serialize(row, reveal_secret=reveal_secret) if row else None

    def create(
        self,
        *,
        name: str,
        base_url: str,
        api_key: str,
        models: list[str],
        enabled: bool,
        is_default: bool,
    ) -> dict[str, Any]:
        with self.database.transaction() as session:
            first = session.scalar(select(ChatProvider.id).limit(1)) is None
            make_default = enabled and (is_default or first)
            if make_default:
                session.execute(update(ChatProvider).values(is_default=False))
            row = ChatProvider(
                id=uuid4().hex,
                name=name,
                base_url=base_url,
                api_key_ciphertext=self.cipher.encrypt(api_key) if api_key else "",
                models=models,
                enabled=enabled,
                is_default=make_default,
            )
            session.add(row)
            session.flush()
            provider_id = row.id
        self._ensure_default()
        created = self.get(provider_id)
        if created is None:
            raise RuntimeError("模型提供商创建后读取失败")
        return created

    def update(self, provider_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
        with self.database.transaction() as session:
            row = session.get(ChatProvider, provider_id)
            if row is None:
                return None
            make_default = bool(values.pop("is_default", False))
            if make_default:
                session.execute(update(ChatProvider).values(is_default=False))
                row.is_default = True
                row.enabled = True
            for key in ("name", "base_url", "models", "enabled"):
                if key in values:
                    setattr(row, key, values[key])
            if "api_key" in values:
                api_key = str(values["api_key"] or "")
                row.api_key_ciphertext = self.cipher.encrypt(api_key) if api_key else ""
            if not row.enabled:
                row.is_default = False
            session.flush()
        self._ensure_default()
        return self.get(provider_id)

    def set_models(self, provider_id: str, models: list[str]) -> dict[str, Any] | None:
        return self.update(provider_id, {"models": models})

    def delete(self, provider_id: str) -> bool:
        with self.database.transaction() as session:
            row = session.get(ChatProvider, provider_id)
            if row is None:
                return False
            session.delete(row)
        self._ensure_default()
        return True

    def _ensure_default(self) -> None:
        with self.database.transaction() as session:
            default = session.scalar(
                select(ChatProvider.id)
                .where(
                    ChatProvider.enabled.is_(True),
                    ChatProvider.is_default.is_(True),
                )
                .limit(1)
            )
            if default is not None:
                return
            session.execute(update(ChatProvider).values(is_default=False))
            first_enabled = session.scalar(
                select(ChatProvider)
                .where(ChatProvider.enabled.is_(True))
                .order_by(ChatProvider.created_at.asc())
                .limit(1)
            )
            if first_enabled is not None:
                first_enabled.is_default = True

    def _serialize(
        self,
        row: ChatProvider,
        *,
        reveal_secret: bool = False,
    ) -> dict[str, Any]:
        value: dict[str, Any] = {
            "id": row.id,
            "name": row.name,
            "base_url": row.base_url,
            "models": list(row.models or []),
            "enabled": bool(row.enabled),
            "is_default": bool(row.is_default),
            "api_key_configured": bool(row.api_key_ciphertext),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
        if reveal_secret:
            value["api_key"] = (
                self.cipher.decrypt(row.api_key_ciphertext)
                if row.api_key_ciphertext
                else ""
            )
        return value
