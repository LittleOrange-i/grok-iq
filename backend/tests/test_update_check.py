from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.core.version import resolve_version
from app.services.update_check import (
    MAX_RELEASE_NOTES_CHARS,
    ReleaseNotPublishedError,
    ReleaseVersion,
    UpdateCheckService,
)


@pytest.mark.parametrize(
    ("older", "newer"),
    [
        ("v1.0.0", "v1.0.1"),
        ("v1.9.9", "v2.0.0"),
        ("v1.0.0-beta.1", "v1.0.0-beta.2"),
        ("v1.0.0-beta.2", "v1.0.0"),
        ("v1.0.0", "v1.0.0-hotfix.1"),
        ("v1.0.0-hotfix.1", "v1.0.0-hotfix.2"),
    ],
)
def test_release_version_ordering(older: str, newer: str):
    assert ReleaseVersion.parse(newer) > ReleaseVersion.parse(older)


def test_resolve_version_prefers_environment_then_version_file(tmp_path: Path):
    version_file = tmp_path / "VERSION"
    version_file.write_text("v2.4.1\n", encoding="utf-8")

    assert resolve_version(environment={}, version_file=version_file) == "v2.4.1"
    assert (
        resolve_version(
            environment={"GROKIQ_VERSION": "v2.5.0-hotfix.1"},
            version_file=version_file,
        )
        == "v2.5.0-hotfix.1"
    )


@pytest.mark.asyncio
async def test_update_check_reports_release_and_truncates_notes():
    async def fetch_release():
        return {
            "tag_name": "v1.1.0",
            "html_url": "https://github.com/kaibush/grok-iq/releases/tag/v1.1.0",
            "body": "x" * (MAX_RELEASE_NOTES_CHARS + 100),
            "published_at": "2026-08-14T00:00:00Z",
        }

    service = UpdateCheckService(
        installed_version="v1.0.0",
        fetch_latest=fetch_release,
    )

    result = await service.check()

    assert result["status"] == "update_available"
    assert result["updateAvailable"] is True
    assert result["currentVersion"] == "v1.0.0"
    assert result["latestVersion"] == "v1.1.0"
    assert len(result["releaseNotes"]) == MAX_RELEASE_NOTES_CHARS
    assert result["checkedAt"]


@pytest.mark.asyncio
async def test_update_check_merges_concurrent_requests():
    calls = 0
    fetch_started = asyncio.Event()
    release_ready = asyncio.Event()

    async def fetch_release():
        nonlocal calls
        calls += 1
        fetch_started.set()
        await release_ready.wait()
        return {"tag_name": "v1.0.0", "body": ""}

    service = UpdateCheckService(
        installed_version="v1.0.0",
        fetch_latest=fetch_release,
    )
    first = asyncio.create_task(service.check())
    await fetch_started.wait()
    second = asyncio.create_task(service.check())
    await asyncio.sleep(0)
    release_ready.set()

    first_result, second_result = await asyncio.gather(first, second)

    assert calls == 1
    assert first_result == second_result
    assert first_result["status"] == "up_to_date"


@pytest.mark.asyncio
async def test_update_check_keeps_errors_in_memory():
    async def fetch_release():
        raise RuntimeError("github unavailable")

    service = UpdateCheckService(
        installed_version="v1.0.0",
        fetch_latest=fetch_release,
    )

    result = await service.check()

    assert result["status"] == "error"
    assert result["updateAvailable"] is False
    assert result["error"] == "github unavailable"


@pytest.mark.asyncio
async def test_update_check_reports_missing_release_without_an_error():
    async def fetch_release():
        raise ReleaseNotPublishedError("GitHub 尚未发布 Release")

    service = UpdateCheckService(
        installed_version="v1.0.0",
        fetch_latest=fetch_release,
    )

    result = await service.check()

    assert result["status"] == "no_release"
    assert result["updateAvailable"] is False
    assert result["error"] == ""
