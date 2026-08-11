from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from .database import Database
from .models import AdminUser, model_dict


class AdminAlreadyExistsError(ValueError):
    pass


class AuthRepository:
    """ORM persistence for the local administrator account."""

    def __init__(self, database: Database):
        self.database = database

    def setup_required(self) -> bool:
        with self.database.session() as session:
            return not bool(session.scalar(select(func.count(AdminUser.id))))

    def create_admin(self, values: dict[str, Any]) -> dict[str, Any]:
        try:
            with self.database.transaction() as session:
                if session.scalar(select(func.count(AdminUser.id))):
                    raise AdminAlreadyExistsError("管理员账号已完成初始化")
                user = AdminUser(id=1, **values)
                session.add(user)
                session.flush()
                result = model_dict(user)
        except IntegrityError as exc:
            raise AdminAlreadyExistsError("管理员账号已完成初始化") from exc
        return result

    def find_by_username(self, username: str) -> dict[str, Any] | None:
        with self.database.session() as session:
            user = session.scalar(
                select(AdminUser).where(AdminUser.username == username)
            )
            return model_dict(user) if user else None

    def get(self, user_id: int) -> dict[str, Any] | None:
        with self.database.session() as session:
            user = session.get(AdminUser, user_id)
            return model_dict(user) if user else None

    def revoke_sessions(self, user_id: int) -> bool:
        """Invalidate every JWT issued before this administrator logout."""

        with self.database.transaction() as session:
            user = session.get(AdminUser, user_id)
            if user is None:
                return False
            user.token_version = int(user.token_version or 0) + 1
            session.flush()
            return True
