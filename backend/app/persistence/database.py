from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .models import Base
from .schema_migrator import DatabaseSchemaMigrator


class Database:
    """SQLAlchemy engine/session owner.

    API and service code receive this object through application composition;
    they never open sqlite3 connections to the GrokIQ database directly.
    """

    def __init__(self, path: Path):
        self.path = path.resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            f"sqlite+pysqlite:///{self.path}",
            connect_args={"check_same_thread": False, "timeout": 30},
            pool_pre_ping=True,
        )
        self._configure_sqlite(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine,
            class_=Session,
            autoflush=False,
            expire_on_commit=False,
        )
        self._schema_migrator = DatabaseSchemaMigrator(self.engine)

    @staticmethod
    def _configure_sqlite(engine: Engine) -> None:
        @event.listens_for(engine, "connect")
        def set_pragmas(dbapi_connection, _connection_record) -> None:  # type: ignore[no-untyped-def]
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

    def initialize(self) -> None:
        Base.metadata.create_all(self.engine)
        # ``create_all`` deliberately does not mutate existing tables. Keep the
        # Docker one-command startup path compatible with databases created by
        # the pre-Alembic prototype; regular deployments can still run the
        # equivalent Alembic revision explicitly.
        self._schema_migrator.migrate()

    @contextmanager
    def session(self) -> Iterator[Session]:
        session = self.session_factory()
        try:
            yield session
        finally:
            session.close()

    @contextmanager
    def transaction(self) -> Iterator[Session]:
        session = self.session_factory()
        try:
            with session.begin():
                yield session
        finally:
            session.close()

    def dispose(self) -> None:
        self.engine.dispose()
