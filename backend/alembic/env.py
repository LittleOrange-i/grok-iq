from __future__ import annotations

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context
from app.core.config import get_settings
from app.persistence.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
database_path = settings.database_path.resolve()
database_path.parent.mkdir(parents=True, exist_ok=True)
config.set_main_option("sqlalchemy.url", f"sqlite+pysqlite:///{database_path}")
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        # SQLAlchemy 2 starts a transaction for the PRAGMA statement.  SQLite
        # DDL survives a later rollback, but Alembic's version-table DML does
        # not; close that setup transaction before Alembic owns the migration
        # transaction so a completed upgrade retains its revision marker.
        connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
