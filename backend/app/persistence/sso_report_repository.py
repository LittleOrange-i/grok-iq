from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import func, select, update

from app.core.clock import utc_now

from .database import Database
from .models import SsoReport

ACTIVE_SSO_REPORT_STATUSES = {"queued", "running"}


class SsoReportRepository:
    def __init__(self, database: Database):
        self.database = database

    def create_queued(
        self,
        *,
        name: str,
        total: int,
        proxy_used: bool,
        concurrency: int,
        request_timeout_seconds: int,
    ) -> dict[str, Any]:
        row = SsoReport(
            id=uuid4().hex,
            name=name.strip(),
            status="queued",
            total=max(0, int(total)),
            completed_count=0,
            proxy_used=bool(proxy_used),
            concurrency=int(concurrency),
            request_timeout_seconds=int(request_timeout_seconds),
            summary={"total": max(0, int(total))},
            results=[],
        )
        with self.database.transaction() as session:
            session.add(row)
            session.flush()
            report_id = row.id
        created = self.get(report_id)
        if created is None:
            raise RuntimeError("SSO 报告创建后读取失败")
        return created

    def delete_if_queued(self, report_id: str) -> bool:
        with self.database.transaction() as session:
            row = session.get(SsoReport, report_id)
            if row is None or row.status != "queued":
                return False
            session.delete(row)
            return True

    def start(self, report_id: str) -> bool:
        now = utc_now()
        with self.database.transaction() as session:
            result = session.execute(
                update(SsoReport)
                .where(
                    SsoReport.id == report_id,
                    SsoReport.status == "queued",
                )
                .values(status="running", started_at=now, error="")
            )
            return bool(result.rowcount)

    def update_progress(
        self,
        report_id: str,
        *,
        completed_count: int,
        elapsed_seconds: float,
    ) -> None:
        with self.database.transaction() as session:
            session.execute(
                update(SsoReport)
                .where(
                    SsoReport.id == report_id,
                    SsoReport.status == "running",
                )
                .values(
                    completed_count=max(0, int(completed_count)),
                    elapsed_seconds=max(0.0, float(elapsed_seconds)),
                )
            )

    def complete(
        self,
        report_id: str,
        *,
        summary: dict[str, Any],
        results: list[dict[str, Any]],
        elapsed_seconds: float,
    ) -> dict[str, Any] | None:
        now = utc_now()
        with self.database.transaction() as session:
            row = session.get(SsoReport, report_id)
            if row is None or row.status not in ACTIVE_SSO_REPORT_STATUSES:
                return None
            row.status = "completed"
            row.total = int(summary.get("total", len(results)))
            row.completed_count = len(results)
            row.valid_count = int(summary.get("valid", 0))
            row.clean_count = int(summary.get("clean", 0))
            row.flagged_count = int(summary.get("flagged", 0))
            row.invalid_count = int(summary.get("invalid", 0))
            row.error_count = int(summary.get("errors", 0))
            row.elapsed_seconds = max(0.0, float(elapsed_seconds))
            row.summary = summary
            row.results = results
            row.error = ""
            row.completed_at = now
        return self.get(report_id)

    def fail(self, report_id: str, error: str, elapsed_seconds: float = 0) -> None:
        now = utc_now()
        with self.database.transaction() as session:
            session.execute(
                update(SsoReport)
                .where(
                    SsoReport.id == report_id,
                    SsoReport.status.in_(ACTIVE_SSO_REPORT_STATUSES),
                )
                .values(
                    status="failed",
                    error=str(error)[:2000],
                    elapsed_seconds=max(0.0, float(elapsed_seconds)),
                    completed_at=now,
                )
            )

    def fail_interrupted(self) -> int:
        now = utc_now()
        with self.database.transaction() as session:
            result = session.execute(
                update(SsoReport)
                .where(SsoReport.status.in_(ACTIVE_SSO_REPORT_STATUSES))
                .values(
                    status="failed",
                    error="服务重启，内存中的 SSO 凭据已清除，请重新创建检测",
                    completed_at=now,
                )
            )
            return int(result.rowcount or 0)

    def list(self) -> list[dict[str, Any]]:
        with self.database.session() as session:
            rows = session.scalars(
                select(SsoReport).order_by(SsoReport.created_at.desc())
            ).all()
            queue_positions: dict[str, int] = {}
            position = 0
            for row in sorted(rows, key=lambda value: value.created_at):
                if row.status != "queued":
                    continue
                position += 1
                queue_positions[row.id] = position
            return [
                self._serialize(
                    row,
                    include_results=False,
                    queue_position=queue_positions.get(row.id),
                )
                for row in rows
            ]

    def get(self, report_id: str) -> dict[str, Any] | None:
        with self.database.session() as session:
            row = session.get(SsoReport, report_id)
            if row is None:
                return None
            queue_position: int | None = None
            if row.status == "queued":
                queued_ids = session.scalars(
                    select(SsoReport.id)
                    .where(SsoReport.status == "queued")
                    .order_by(SsoReport.created_at.asc())
                ).all()
                try:
                    queue_position = list(queued_ids).index(row.id) + 1
                except ValueError:
                    queue_position = None
            return self._serialize(
                row,
                include_results=True,
                queue_position=queue_position,
            )

    def latest_account_results(
        self,
        account_ids: list[int] | set[int],
    ) -> dict[int, dict[str, Any]]:
        """Return the newest completed account-linked result per account."""

        normalized = {int(value) for value in account_ids if int(value) > 0}
        if not normalized:
            return {}
        with self.database.session() as session:
            rows = session.scalars(
                select(SsoReport)
                .where(SsoReport.status.in_({"running", "completed", "failed"}))
                .order_by(
                    func.coalesce(
                        SsoReport.completed_at,
                        SsoReport.started_at,
                        SsoReport.created_at,
                    ).desc()
                )
            ).all()
        output: dict[int, dict[str, Any]] = {}
        for report in rows:
            completed_at = (
                report.completed_at or report.started_at or report.created_at
            )
            for raw in report.results or []:
                if not isinstance(raw, dict):
                    continue
                try:
                    account_id = int(raw.get("account_id") or 0)
                except (TypeError, ValueError):
                    account_id = 0
                if account_id not in normalized or account_id in output:
                    continue
                value = dict(raw)
                value["_report_id"] = report.id
                value["_report_completed_at"] = completed_at
                value["_report_proxy_used"] = bool(report.proxy_used)
                output[account_id] = value
            if len(output) == len(normalized):
                break
        return output

    def record_account_result(
        self,
        report_id: str,
        result: dict[str, Any],
    ) -> bool:
        """Persist a linked result early so account UIs show a bot action now."""

        try:
            account_id = int(result.get("account_id") or 0)
        except (TypeError, ValueError):
            account_id = 0
        if account_id <= 0:
            return False
        with self.database.transaction() as session:
            row = session.get(SsoReport, report_id)
            if row is None or row.status not in ACTIVE_SSO_REPORT_STATUSES:
                return False
            results: list[dict[str, Any]] = []
            replaced = False
            for raw in row.results or []:
                value = dict(raw) if isinstance(raw, dict) else {}
                try:
                    result_account_id = int(value.get("account_id") or 0)
                except (TypeError, ValueError):
                    result_account_id = 0
                if result_account_id == account_id:
                    results.append(dict(result))
                    replaced = True
                else:
                    results.append(value)
            if not replaced:
                results.append(dict(result))
            row.results = results
            return True

    def merge_account_actions(
        self,
        report_id: str,
        results: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Carry early action outcomes into the final ordered check results."""

        with self.database.session() as session:
            row = session.get(SsoReport, report_id)
            existing = list(row.results or []) if row is not None else []
        actions: dict[int, dict[str, Any]] = {}
        for raw in existing:
            if not isinstance(raw, dict) or not isinstance(
                raw.get("account_action"), dict
            ):
                continue
            try:
                account_id = int(raw.get("account_id") or 0)
            except (TypeError, ValueError):
                account_id = 0
            if account_id > 0:
                actions[account_id] = dict(raw["account_action"])
        merged: list[dict[str, Any]] = []
        for raw in results:
            value = dict(raw)
            try:
                account_id = int(value.get("account_id") or 0)
            except (TypeError, ValueError):
                account_id = 0
            if account_id in actions:
                value["account_action"] = actions[account_id]
            merged.append(value)
        return merged

    def update_account_action(
        self,
        report_id: str,
        *,
        account_id: int,
        status: str,
        error: str = "",
    ) -> bool:
        """Persist a delayed account action into an already completed report."""

        with self.database.transaction() as session:
            row = session.get(SsoReport, report_id)
            if row is None or row.status not in {"completed", "failed"}:
                return False
            changed = False
            results: list[dict[str, Any]] = []
            for raw in row.results or []:
                value = dict(raw) if isinstance(raw, dict) else {}
                try:
                    result_account_id = int(value.get("account_id") or 0)
                except (TypeError, ValueError):
                    result_account_id = 0
                if result_account_id == int(account_id):
                    value["account_action"] = {
                        "status": str(status),
                        "error": str(error)[:1000],
                    }
                    changed = True
                results.append(value)
            if changed:
                row.results = results
            return changed

    def pending_account_actions(self) -> list[dict[str, Any]]:
        """Recover newest account-linked bot actions left protected or failed."""

        with self.database.session() as session:
            rows = session.scalars(
                select(SsoReport)
                .where(SsoReport.status.in_({"completed", "failed"}))
                .order_by(SsoReport.completed_at.desc(), SsoReport.created_at.desc())
            ).all()
        output: list[dict[str, Any]] = []
        seen: set[int] = set()
        for report in rows:
            for raw in report.results or []:
                if not isinstance(raw, dict):
                    continue
                bot_flag = raw.get("bot_flag")
                action = raw.get("account_action")
                if not isinstance(bot_flag, dict) or not bool(
                    bot_flag.get("flagged")
                ):
                    continue
                if (
                    raw.get("valid_session") is not True
                    or raw.get("email_match") is not True
                ):
                    continue
                if (
                    not isinstance(action, dict)
                    or str(action.get("status") or "")
                    not in {"task_protected", "action_failed"}
                ):
                    continue
                try:
                    account_id = int(raw.get("account_id") or 0)
                except (TypeError, ValueError):
                    account_id = 0
                if account_id <= 0 or account_id in seen:
                    continue
                seen.add(account_id)
                output.append(
                    {
                        "report_id": report.id,
                        "account_id": account_id,
                        "detail": {
                            "reportId": report.id,
                            "ssoVerdict": str(raw.get("verdict") or "flagged"),
                            "botFlag": bot_flag,
                            "checkedAt": str(raw.get("checked_at") or ""),
                            "proxyUsed": bool(report.proxy_used),
                        },
                    }
                )
        return output

    def delete_many(self, report_ids: list[str]) -> dict[str, Any]:
        unique_ids = list(dict.fromkeys(value for value in report_ids if value))
        deleted = 0
        skipped_ids: list[str] = []
        with self.database.transaction() as session:
            rows = session.scalars(
                select(SsoReport).where(SsoReport.id.in_(unique_ids))
            ).all()
            found_ids = {row.id for row in rows}
            for row in rows:
                if row.status in ACTIVE_SSO_REPORT_STATUSES:
                    skipped_ids.append(row.id)
                    continue
                session.delete(row)
                deleted += 1
        missing = len([value for value in unique_ids if value not in found_ids])
        return {
            "requested": len(unique_ids),
            "deleted": deleted,
            "missing": missing,
            "skipped": len(skipped_ids),
            "skipped_ids": skipped_ids,
        }

    @staticmethod
    def _serialize(
        row: SsoReport,
        *,
        include_results: bool,
        queue_position: int | None = None,
    ) -> dict[str, Any]:
        total = max(0, int(row.total or 0))
        completed_count = min(total, max(0, int(row.completed_count or 0)))
        value: dict[str, Any] = {
            "id": row.id,
            "name": row.name,
            "status": row.status,
            "total": total,
            "completed_count": completed_count,
            "progress_percent": round(completed_count * 100 / total, 1) if total else 0,
            "queue_position": queue_position,
            "valid": row.valid_count,
            "clean": row.clean_count,
            "flagged": row.flagged_count,
            "mismatched": int((row.summary or {}).get("mismatched", 0)),
            "invalid": row.invalid_count,
            "errors": row.error_count,
            "elapsed_seconds": row.elapsed_seconds,
            "summary": dict(row.summary or {}),
            "proxy_used": bool(row.proxy_used),
            "concurrency": int(row.concurrency or 8),
            "request_timeout_seconds": int(row.request_timeout_seconds or 20),
            "error": row.error,
            "created_at": row.created_at,
            "started_at": row.started_at,
            "completed_at": row.completed_at,
        }
        if include_results:
            value["results"] = list(row.results or [])
        return value
