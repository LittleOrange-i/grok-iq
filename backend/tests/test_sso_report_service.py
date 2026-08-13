from __future__ import annotations

import asyncio
from pathlib import Path

from app.integrations.sso.checker import SsoCredential
from app.persistence.database import Database
from app.persistence.sso_report_repository import SsoReportRepository
from app.services.sso_report_service import SsoReportService


class Checker:
    def check_many(self, credentials: list[SsoCredential], *, progress=None):  # type: ignore[no-untyped-def]
        results = []
        total = len(credentials)
        for index, item in enumerate(credentials):
            result = {
                "label": item.label,
                "expected_email": item.expected_email,
                "valid_session": True,
                "email_match": index != 1,
                "verdict": "clean" if index == 0 else "flagged_email_mismatch",
                "account": {"region_code": "VA"},
                "bot_flag": {
                    "source": 0 if index == 0 else 4,
                    "flagged": index != 0,
                },
                "response_ms": 100 + index,
                "error": "",
            }
            results.append(result)
            if progress is not None:
                progress(index + 1, total, result)
        return results


class CheckerFactory:
    def __init__(self) -> None:
        self.values: list[tuple[str, int, int]] = []

    def __call__(self, proxy: str, concurrency: int, timeout: int):  # type: ignore[no-untyped-def]
        self.values.append((proxy, concurrency, timeout))
        return Checker()


async def wait_for_terminal(service: SsoReportService, report_id: str):  # type: ignore[no-untyped-def]
    for _ in range(100):
        report = service.get(report_id)
        if report["status"] in {"completed", "failed"}:
            return report
        await asyncio.sleep(0.01)
    raise AssertionError("SSO report did not finish")


async def test_each_execution_persists_one_credential_free_report(tmp_path: Path) -> None:
    database = Database(tmp_path / "grokiq.db")
    database.initialize()
    checker_factory = CheckerFactory()
    service = SsoReportService(
        SsoReportRepository(database),
        checker_factory=checker_factory,
    )
    await service.start()
    try:
        queued = service.create(
            "batch",
            "first@example.com----SECRET-ONE\nsecond@example.com----SECRET-TWO",
            "proxy-user:proxy-pass@127.0.0.1:8080",
            concurrency=12,
            request_timeout_seconds=35,
        )
        assert queued["status"] == "queued"
        assert queued["proxy_used"] is True
        assert queued["concurrency"] == 12
        assert queued["request_timeout_seconds"] == 35

        report = await wait_for_terminal(service, queued["id"])
        assert report["status"] == "completed"
        assert report["total"] == 2
        assert report["completed_count"] == 2
        assert report["clean"] == 1
        assert report["flagged"] == 1
        assert report["mismatched"] == 1
        assert len(service.list()) == 1
        assert "SECRET-ONE" not in str(report)
        assert "SECRET-TWO" not in str(report)
        assert "proxy-pass" not in str(report)
        assert checker_factory.values == [
            ("http://proxy-user:proxy-pass@127.0.0.1:8080", 12, 35)
        ]
    finally:
        await service.stop()
        database.dispose()
