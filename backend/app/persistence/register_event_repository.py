from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select, update
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
            with self.database.session() as session:
                event = session.get(RegisterWebhookEvent, event_id)
                if event is None:
                    raise
                return self._existing_event(event, values), False

    @staticmethod
    def _existing_event(
        event: RegisterWebhookEvent,
        values: dict[str, Any],
    ) -> dict[str, Any]:
        if event.email.lower() != str(values["email"]).lower():
            raise RegisterEventConflictError("event_id 已被其他邮箱使用")
        return model_dict(event)

    def recover_processing(self) -> int:
        now = utc_now()
        with self.database.transaction() as session:
            result = session.execute(
                update(RegisterWebhookEvent)
                .where(RegisterWebhookEvent.status == "processing")
                .values(status="pending", next_attempt_at=now, updated_at=now)
            )
            return int(result.rowcount or 0)

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
