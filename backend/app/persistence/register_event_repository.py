from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.core.clock import utc_now

from .database import Database
from .models import RegisterWebhookEvent, model_dict


class RegisterEventConflictError(ValueError):
    pass


class RegisterEventRepository:
    def __init__(self, database: Database):
        self.database = database

    def receive(self, values: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        event_id = str(values["event_id"])
        now = utc_now()
        try:
            with self.database.transaction() as session:
                event = session.get(RegisterWebhookEvent, event_id)
                if event is not None:
                    return self._existing_event(event, values), False
                event = RegisterWebhookEvent(
                    event_id=event_id,
                    event_type=str(
                        values.get("event_type") or "grok2api.account_imported"
                    ),
                    registration_id=str(values.get("registration_id") or ""),
                    email=str(values["email"]).lower(),
                    sso=str(values.get("sso") or "").strip(),
                    grok2api_account_id=values.get("grok2api_account_id"),
                    bot_risk=bool(values.get("bot_risk")),
                    bfs=(
                        "" if values.get("bfs") is None else str(values.get("bfs"))
                    ),
                    occurred_at=str(values.get("occurred_at") or ""),
                    status="pending",
                    attempts=0,
                    next_attempt_at=now,
                    created_at=now,
                    updated_at=now,
                )
                session.add(event)
                return model_dict(event), True
        except IntegrityError:
            # Concurrent at-least-once deliveries can race on the primary key.
            with self.database.transaction() as session:
                event = session.get(RegisterWebhookEvent, event_id)
                if event is None:
                    raise
                return self._existing_event(event, values), False

    def list_events(
        self,
        *,
        page: int,
        page_size: int,
        status: str = "",
        search: str = "",
    ) -> dict[str, Any]:
        filters: list[Any] = []
        if status:
            filters.append(RegisterWebhookEvent.status == status)
        token = search.strip().lower()
        if token:
            search_filters = [
                func.lower(RegisterWebhookEvent.event_id).contains(token),
                func.lower(RegisterWebhookEvent.event_type).contains(token),
                func.lower(RegisterWebhookEvent.registration_id).contains(token),
                func.lower(RegisterWebhookEvent.email).contains(token),
            ]
            if token.isdigit():
                numeric_token = int(token)
                search_filters.extend(
                    [
                        RegisterWebhookEvent.grok2api_account_id == numeric_token,
                        RegisterWebhookEvent.resolved_account_id == numeric_token,
                    ]
                )
            filters.append(or_(*search_filters))

        now = utc_now()
        with self.database.session() as session:
            total = int(
                session.scalar(
                    select(func.count(RegisterWebhookEvent.event_id)).where(*filters)
                )
                or 0
            )
            events = session.scalars(
                select(RegisterWebhookEvent)
                .where(*filters)
                .order_by(RegisterWebhookEvent.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            status_counts = {
                "pending": 0,
                "processing": 0,
                "completed": 0,
                "failed": 0,
            }
            for event_status, count in session.execute(
                select(
                    RegisterWebhookEvent.status,
                    func.count(RegisterWebhookEvent.event_id),
                ).group_by(RegisterWebhookEvent.status)
            ).all():
                status_counts[str(event_status)] = int(count or 0)
            due_count = int(
                session.scalar(
                    select(func.count(RegisterWebhookEvent.event_id)).where(
                        RegisterWebhookEvent.status == "pending",
                        RegisterWebhookEvent.next_attempt_at <= now,
                    )
                )
                or 0
            )
            retrying_count = int(
                session.scalar(
                    select(func.count(RegisterWebhookEvent.event_id)).where(
                        RegisterWebhookEvent.status == "pending",
                        RegisterWebhookEvent.attempts > 0,
                    )
                )
                or 0
            )

        return {
            "items": [
                {
                    key: value
                    for key, value in model_dict(event).items()
                    if key != "sso"
                }
                for event in events
            ],
            "total": total,
            "page": page,
            "pageSize": page_size,
            "statusCounts": status_counts,
            "dueCount": due_count,
            "retryingCount": retrying_count,
        }

    @staticmethod
    def _existing_event(
        event: RegisterWebhookEvent,
        values: dict[str, Any],
    ) -> dict[str, Any]:
        if event.email.lower() != str(values["email"]).lower():
            raise RegisterEventConflictError("event_id 已被其他邮箱使用")
        incoming_sso = str(values.get("sso") or "").strip()
        if incoming_sso:
            event.sso = incoming_sso
            event.updated_at = utc_now()
        return model_dict(event)

    def sso_for_accounts(self, account_ids: list[int]) -> dict[int, dict[str, str]]:
        """Return the latest non-empty raw SSO received for each account."""
        normalized = sorted({int(value) for value in account_ids if int(value) > 0})
        if not normalized:
            return {}
        with self.database.session() as session:
            rows = session.scalars(
                select(RegisterWebhookEvent)
                .where(
                    RegisterWebhookEvent.resolved_account_id.in_(normalized),
                    RegisterWebhookEvent.sso != "",
                )
                .order_by(RegisterWebhookEvent.updated_at.desc())
            ).all()
        result: dict[int, dict[str, str]] = {}
        for row in rows:
            account_id = int(row.resolved_account_id or 0)
            if account_id and account_id not in result:
                result[account_id] = {
                    "email": str(row.email or ""),
                    "sso": str(row.sso or ""),
                }
        return result

    def recover_processing(self) -> int:
        now = utc_now()
        with self.database.transaction() as session:
            result = session.execute(
                update(RegisterWebhookEvent)
                .where(RegisterWebhookEvent.status == "processing")
                .values(status="pending", next_attempt_at=now, updated_at=now)
            )
            return int(result.rowcount or 0)

    def bind_account(self, event_id: str, account_id: int) -> None:
        now = utc_now()
        with self.database.transaction() as session:
            event = session.get(RegisterWebhookEvent, event_id)
            if event is None:
                return
            event.resolved_account_id = int(account_id)
            event.updated_at = now

    def claim_due(self) -> dict[str, Any] | None:
        now = utc_now()
        with self.database.transaction() as session:
            event = session.scalar(
                select(RegisterWebhookEvent)
                .where(
                    RegisterWebhookEvent.status == "pending",
                    RegisterWebhookEvent.next_attempt_at <= now,
                )
                .order_by(
                    RegisterWebhookEvent.next_attempt_at.asc(),
                    RegisterWebhookEvent.created_at.asc(),
                )
                .limit(1)
            )
            if event is None:
                return None
            event.status = "processing"
            event.attempts += 1
            event.updated_at = now
            return model_dict(event)

    def retry(self, event_id: str, error: str, delay_seconds: float) -> None:
        now = utc_now()
        with self.database.transaction() as session:
            event = session.get(RegisterWebhookEvent, event_id)
            if event is None or event.status == "completed":
                return
            event.status = "pending"
            event.last_error = str(error)[:4000]
            event.next_attempt_at = now + timedelta(seconds=max(delay_seconds, 1))
            event.updated_at = now

    def fail(self, event_id: str, error: str) -> None:
        now = utc_now()
        with self.database.transaction() as session:
            event = session.get(RegisterWebhookEvent, event_id)
            if event is None or event.status == "completed":
                return
            event.status = "failed"
            event.last_error = str(error)[:4000]
            event.updated_at = now
            event.completed_at = now

    def complete(self, event_id: str, account_id: int, run_ids: list[str]) -> None:
        now = utc_now()
        with self.database.transaction() as session:
            event = session.get(RegisterWebhookEvent, event_id)
            if event is None:
                return
            event.status = "completed"
            event.last_error = ""
            event.resolved_account_id = account_id
            event.run_ids = list(run_ids)
            event.updated_at = now
            event.completed_at = now
