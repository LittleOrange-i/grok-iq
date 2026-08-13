from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event, inspect
from sqlalchemy.orm import Session, sessionmaker

from .models import Base


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
        inspector = inspect(self.engine)
        compatibility_columns = {
            "account_assessments": [
                (
                    "recovery_guarded",
                    "ALTER TABLE account_assessments ADD COLUMN recovery_guarded BOOLEAN "
                    "NOT NULL DEFAULT 0",
                )
            ],
            "probe_profiles": [
                (
                    "expected_output",
                    "ALTER TABLE probe_profiles ADD COLUMN expected_output TEXT NOT NULL DEFAULT ''",
                )
            ],
            "probe_plans": [
                (
                    "profile_ids",
                    "ALTER TABLE probe_plans ADD COLUMN profile_ids JSON NOT NULL DEFAULT '[]'",
                ),
                (
                    "execution_mode",
                    "ALTER TABLE probe_plans ADD COLUMN execution_mode VARCHAR(24) NOT NULL DEFAULT 'chat'",
                ),
                (
                    "account_scope",
                    "ALTER TABLE probe_plans ADD COLUMN account_scope VARCHAR(24) "
                    "NOT NULL DEFAULT 'fixed'",
                ),
            ],
            "probe_runs": [
                (
                    "source_event_id",
                    "ALTER TABLE probe_runs ADD COLUMN source_event_id VARCHAR(120)",
                ),
                (
                    "execution_mode",
                    "ALTER TABLE probe_runs ADD COLUMN execution_mode VARCHAR(24) NOT NULL DEFAULT 'chat'",
                ),
                (
                    "original_account_enabled",
                    "ALTER TABLE probe_runs ADD COLUMN original_account_enabled BOOLEAN",
                ),
                (
                    "original_account_priority",
                    "ALTER TABLE probe_runs ADD COLUMN original_account_priority INTEGER",
                ),
                (
                    "original_account_max_concurrent",
                    "ALTER TABLE probe_runs ADD COLUMN original_account_max_concurrent INTEGER",
                ),
                (
                    "account_settings_snapshot_at",
                    "ALTER TABLE probe_runs ADD COLUMN account_settings_snapshot_at DATETIME",
                ),
                (
                    "diagnostic_priority",
                    "ALTER TABLE probe_runs ADD COLUMN diagnostic_priority INTEGER",
                ),
                (
                    "diagnostic_max_concurrent",
                    "ALTER TABLE probe_runs ADD COLUMN diagnostic_max_concurrent INTEGER",
                ),
                (
                    "diagnostic_activation_active",
                    "ALTER TABLE probe_runs ADD COLUMN diagnostic_activation_active BOOLEAN "
                    "NOT NULL DEFAULT 0",
                ),
                (
                    "account_restore_status",
                    "ALTER TABLE probe_runs ADD COLUMN account_restore_status VARCHAR(32) "
                    "NOT NULL DEFAULT 'not_recorded'",
                ),
                (
                    "account_restore_source",
                    "ALTER TABLE probe_runs ADD COLUMN account_restore_source VARCHAR(32) "
                    "NOT NULL DEFAULT ''",
                ),
                (
                    "account_restore_attempts",
                    "ALTER TABLE probe_runs ADD COLUMN account_restore_attempts INTEGER NOT NULL DEFAULT 0",
                ),
                (
                    "account_restore_error",
                    "ALTER TABLE probe_runs ADD COLUMN account_restore_error TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "account_restore_attempted_at",
                    "ALTER TABLE probe_runs ADD COLUMN account_restore_attempted_at DATETIME",
                ),
                (
                    "account_restored_at",
                    "ALTER TABLE probe_runs ADD COLUMN account_restored_at DATETIME",
                ),
            ],
            "probe_samples": [
                (
                    "error_code",
                    "ALTER TABLE probe_samples ADD COLUMN error_code VARCHAR(100) NOT NULL DEFAULT ''",
                ),
                (
                    "retry_count",
                    "ALTER TABLE probe_samples ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
                ),
                (
                    "retry_after_seconds",
                    "ALTER TABLE probe_samples ADD COLUMN retry_after_seconds FLOAT NOT NULL DEFAULT 0",
                ),
            ],
            "sso_reports": [
                (
                    "completed_count",
                    "ALTER TABLE sso_reports ADD COLUMN completed_count INTEGER NOT NULL DEFAULT 0",
                ),
                (
                    "proxy_used",
                    "ALTER TABLE sso_reports ADD COLUMN proxy_used BOOLEAN NOT NULL DEFAULT 0",
                ),
                (
                    "concurrency",
                    "ALTER TABLE sso_reports ADD COLUMN concurrency INTEGER NOT NULL DEFAULT 8",
                ),
                (
                    "request_timeout_seconds",
                    "ALTER TABLE sso_reports ADD COLUMN request_timeout_seconds INTEGER "
                    "NOT NULL DEFAULT 20",
                ),
                (
                    "error",
                    "ALTER TABLE sso_reports ADD COLUMN error TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "started_at",
                    "ALTER TABLE sso_reports ADD COLUMN started_at DATETIME",
                ),
                (
                    "completed_at",
                    "ALTER TABLE sso_reports ADD COLUMN completed_at DATETIME",
                ),
            ],
        }
        compatibility_indexes = {
            "account_assessments": [
                (
                    "ix_account_assessments_recovery_guarded",
                    "CREATE INDEX IF NOT EXISTS ix_account_assessments_recovery_guarded "
                    "ON account_assessments (recovery_guarded)",
                )
            ],
            "probe_runs": [
                (
                    "ix_probe_runs_source_event_id",
                    "CREATE INDEX IF NOT EXISTS ix_probe_runs_source_event_id "
                    "ON probe_runs (source_event_id)",
                ),
                (
                    "ix_probe_run_status_created",
                    "CREATE INDEX IF NOT EXISTS ix_probe_run_status_created "
                    "ON probe_runs (status, created_at)",
                ),
                (
                    "ix_probe_run_created_at",
                    "CREATE INDEX IF NOT EXISTS ix_probe_run_created_at ON probe_runs (created_at)",
                ),
            ]
        }
        statements = []
        for table, columns in compatibility_columns.items():
            if table not in inspector.get_table_names():
                continue
            names = {value["name"] for value in inspector.get_columns(table)}
            for column, statement in columns:
                if column not in names:
                    statements.append(statement)
        existing_indexes = {
            table: {value["name"] for value in inspector.get_indexes(table)}
            for table in compatibility_indexes
            if table in inspector.get_table_names()
        }
        for table, indexes in compatibility_indexes.items():
            if table not in inspector.get_table_names():
                continue
            for name, statement in indexes:
                if name not in existing_indexes.get(table, set()):
                    statements.append(statement)
        if statements or any(
            table in inspector.get_table_names()
            for table in ("probe_plans", "sso_reports")
        ):
            with self.engine.begin() as connection:
                for statement in statements:
                    connection.exec_driver_sql(statement)
                if "sso_reports" in inspector.get_table_names():
                    connection.exec_driver_sql(
                        "UPDATE sso_reports SET completed_count = total "
                        "WHERE status = 'completed' AND completed_count = 0 AND total > 0"
                    )
                if "probe_plans" in inspector.get_table_names():
                    rows = connection.exec_driver_sql(
                        "SELECT id, profile_id, profile_ids FROM probe_plans"
                    ).all()
                    for plan_id, profile_id, profile_ids in rows:
                        if profile_ids not in (None, "", "[]", "null"):
                            continue
                        connection.exec_driver_sql(
                            "UPDATE probe_plans SET profile_ids = ? WHERE id = ?",
                            (json.dumps([profile_id]), plan_id),
                        )

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
