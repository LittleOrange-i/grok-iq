from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, false, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.core.clock import utc_now

from .database import Database
from .models import RequestAuditRecord, RequestAuditScanState, model_dict


class RequestAuditRepository:
    """Persistence boundary for the retained local request-audit projection."""

    def __init__(self, database: Database):
        self.database = database

    def get_state(self, scope: str = "grok_build_today") -> dict[str, Any] | None:
        with self.database.session() as session:
            value = session.get(RequestAuditScanState, scope)
            return model_dict(value) if value else None

    def save_state(self, scope: str, values: dict[str, Any]) -> dict[str, Any]:
        with self.database.transaction() as session:
            value = session.get(RequestAuditScanState, scope)
            if value is None:
                value = RequestAuditScanState(scope=scope)
                session.add(value)
            for key, item in values.items():
                if hasattr(value, key):
                    setattr(value, key, item)
            value.updated_at = utc_now()
            session.flush()
            return model_dict(value)

    def existing_ids(self, upstream_ids: Iterable[str]) -> set[str]:
        values = {str(item) for item in upstream_ids if str(item)}
        if not values:
            return set()
        with self.database.session() as session:
            rows = session.scalars(
                select(RequestAuditRecord.upstream_id).where(
                    RequestAuditRecord.upstream_id.in_(values)
                )
            ).all()
        return set(rows)

    def upsert_records(self, records: Iterable[dict[str, Any]]) -> int:
        # De-duplicate a page before opening the transaction. Audit rows are
        # immutable after grok2api publishes them, so conflicts can be ignored.
        unique: dict[str, dict[str, Any]] = {}
        for record in records:
            key = str(record.get("upstream_id") or "").strip()
            if key:
                unique[key] = record
        if not unique:
            return 0

        columns = {
            "upstream_id",
            "request_id",
            "day_key",
            "provider",
            "operation",
            "model_public_id",
            "model_upstream_model",
            "account_id",
            "account_name",
            "egress_node_id",
            "egress_node_name",
            "egress_ip",
            "egress_mode",
            "egress_scope",
            "status_code",
            "streaming",
            "input_tokens",
            "output_tokens",
            "reasoning_tokens",
            "total_tokens",
            "first_token_ms",
            "duration_ms",
            "tps",
            "risk_level",
            "risk_reasons",
            "raw",
            "created_at",
            "fetched_at",
        }
        payloads = [
            {key: item for key, item in record.items() if key in columns}
            for record in unique.values()
        ]
        with self.database.transaction() as session:
            result = session.execute(
                sqlite_insert(RequestAuditRecord.__table__)
                .on_conflict_do_nothing(index_elements=["upstream_id"]),
                payloads,
            )
            return max(0, int(result.rowcount or 0))

    def delete_older_than(self, cutoff: datetime) -> int:
        with self.database.transaction() as session:
            result = session.execute(
                delete(RequestAuditRecord).where(RequestAuditRecord.created_at < cutoff)
            )
            return int(result.rowcount or 0)

    def refresh_egress_node_details(
        self,
        *,
        day_key: str = "",
        start: datetime | None = None,
        end: datetime | None = None,
        nodes: dict[int, dict[str, Any]],
    ) -> int:
        """Refresh stable node labels and remove legacy IP snapshot backfills.

        grok2api request audits identify the egress node, but they do not retain
        the concrete dynamic IP used by an individual request. Older GrokIQ
        builds copied a node's latest probe IP onto every historical row. Clear
        that derived value so it can no longer be mistaken for request evidence.
        """

        updated = 0
        with self.database.transaction() as session:
            query = select(RequestAuditRecord)
            if start is not None:
                query = query.where(RequestAuditRecord.created_at >= start)
            if end is not None:
                query = query.where(RequestAuditRecord.created_at < end)
            if start is None and end is None and day_key:
                query = query.where(RequestAuditRecord.day_key == day_key)
            values = session.scalars(query).all()
            for value in values:
                changed = False
                if value.egress_ip:
                    value.egress_ip = ""
                    changed = True
                if value.egress_node_id is not None:
                    node = nodes.get(value.egress_node_id, {})
                    current_name = str(node.get("name") or "")
                    if current_name and value.egress_node_name != current_name:
                        value.egress_node_name = current_name
                        changed = True
                if changed:
                    updated += 1
        return updated

    def list_records(
        self,
        *,
        day_key: str = "",
        start: datetime | None = None,
        end: datetime | None = None,
        page: int = 1,
        page_size: int = 50,
        account: str = "",
        risk: str = "",
        egress_node_id: int | None = None,
        watch_threshold: float = 150,
        high_threshold: float = 500,
        risk_enabled: bool = True,
    ) -> dict[str, Any]:
        page = max(1, page)
        page_size = max(1, min(page_size, 200))
        with self.database.session() as session:
            query = select(RequestAuditRecord)
            count_query = select(func.count()).select_from(RequestAuditRecord)
            if start is not None:
                query = query.where(RequestAuditRecord.created_at >= start)
                count_query = count_query.where(RequestAuditRecord.created_at >= start)
            if end is not None:
                query = query.where(RequestAuditRecord.created_at < end)
                count_query = count_query.where(RequestAuditRecord.created_at < end)
            if start is None and end is None and day_key:
                query = query.where(RequestAuditRecord.day_key == day_key)
                count_query = count_query.where(RequestAuditRecord.day_key == day_key)
            # Risk is evaluated against the live runtime thresholds instead of
            # the classification snapshot stored when the row was fetched.
            # Settings changes therefore take effect immediately in filters.
            if not risk_enabled:
                if risk in {"risky", "watch", "high"}:
                    query = query.where(false())
                    count_query = count_query.where(false())
            elif risk == "risky":
                clause = RequestAuditRecord.tps >= watch_threshold
                query = query.where(clause)
                count_query = count_query.where(clause)
            elif risk == "high":
                clause = RequestAuditRecord.tps >= high_threshold
                query = query.where(clause)
                count_query = count_query.where(clause)
            elif risk == "watch":
                clause = (
                    (RequestAuditRecord.tps >= watch_threshold)
                    & (RequestAuditRecord.tps < high_threshold)
                )
                query = query.where(clause)
                count_query = count_query.where(clause)
            elif risk == "normal":
                clause = (
                    RequestAuditRecord.tps.is_(None)
                    | (RequestAuditRecord.tps < watch_threshold)
                )
                query = query.where(clause)
                count_query = count_query.where(clause)
            if egress_node_id is not None:
                query = query.where(
                    RequestAuditRecord.egress_node_id == egress_node_id
                )
                count_query = count_query.where(
                    RequestAuditRecord.egress_node_id == egress_node_id
                )
            if account:
                needle = f"%{account.strip()}%"
                account_clause = (
                    RequestAuditRecord.account_name.ilike(needle)
                    | RequestAuditRecord.request_id.ilike(needle)
                )
                try:
                    account_id = int(account.strip())
                except (TypeError, ValueError):
                    account_id = 0
                if account_id > 0:
                    account_clause = account_clause | (RequestAuditRecord.account_id == account_id)
                query = query.where(account_clause)
                count_query = count_query.where(account_clause)
            total = int(session.scalar(count_query) or 0)
            values = session.scalars(
                query.order_by(
                    RequestAuditRecord.created_at.desc(),
                    RequestAuditRecord.upstream_id.desc(),
                )
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            return {
                "items": [model_dict(value) for value in values],
                "total": total,
                "page": page,
                "page_size": page_size,
            }

    def records_for_day(self, day_key: str) -> list[dict[str, Any]]:
        with self.database.session() as session:
            values = session.scalars(
                select(RequestAuditRecord)
                .where(RequestAuditRecord.day_key == day_key)
                .order_by(RequestAuditRecord.created_at.asc(), RequestAuditRecord.upstream_id.asc())
            ).all()
            return [model_dict(value) for value in values]

    def records_for_range(
        self,
        start: datetime,
        end: datetime,
    ) -> list[dict[str, Any]]:
        with self.database.session() as session:
            values = session.scalars(
                select(RequestAuditRecord)
                .where(
                    RequestAuditRecord.created_at >= start,
                    RequestAuditRecord.created_at < end,
                )
                .order_by(
                    RequestAuditRecord.created_at.asc(),
                    RequestAuditRecord.upstream_id.asc(),
                )
            ).all()
            return [model_dict(value) for value in values]

    def count_for_day(self, day_key: str) -> int:
        with self.database.session() as session:
            return int(
                session.scalar(
                    select(func.count()).select_from(RequestAuditRecord).where(
                        RequestAuditRecord.day_key == day_key
                    )
                )
                or 0
            )

    def count_for_range(self, start: datetime, end: datetime) -> int:
        with self.database.session() as session:
            return int(
                session.scalar(
                    select(func.count()).select_from(RequestAuditRecord).where(
                        RequestAuditRecord.created_at >= start,
                        RequestAuditRecord.created_at < end,
                    )
                )
                or 0
            )

    def available_range(self) -> dict[str, Any]:
        with self.database.session() as session:
            row = session.execute(
                select(
                    func.min(RequestAuditRecord.created_at),
                    func.max(RequestAuditRecord.created_at),
                    func.count(),
                )
            ).one()
            return {
                "start": row[0],
                "end": row[1],
                "records": int(row[2] or 0),
            }

    @staticmethod
    def state_defaults(scope: str = "grok_build_today") -> dict[str, Any]:
        return {
            "scope": scope,
            "day_key": "",
            "newest_upstream_id": "",
            "newest_created_at": None,
            "initial_cursor": "",
            "initial_complete": False,
            "last_scan_at": None,
            "last_success_at": None,
            "last_error": "",
            "last_pages": 0,
            "last_new_records": 0,
            "last_seen_records": 0,
        }

    def ensure_state(self, scope: str = "grok_build_today") -> dict[str, Any]:
        return self.get_state(scope) or self.state_defaults(scope)

    def reset_day(self, scope: str, day_key: str) -> dict[str, Any]:
        return self.save_state(
            scope,
            {
                "day_key": day_key,
                "newest_upstream_id": "",
                "newest_created_at": None,
                "initial_cursor": "",
                "initial_complete": False,
                "last_scan_at": None,
                "last_success_at": None,
                "last_error": "",
                "last_pages": 0,
                "last_new_records": 0,
                "last_seen_records": 0,
            },
        )

    @staticmethod
    def retention_cutoff(days: int = 3) -> datetime:
        return utc_now() - timedelta(days=max(1, days))
