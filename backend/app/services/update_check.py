from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import total_ordering
from typing import Any

from curl_cffi.requests import AsyncSession as CurlAsyncSession

from app.core.clock import app_isoformat, utc_now
from app.core.version import current_version

logger = logging.getLogger(__name__)

GITHUB_REPOSITORY = "kaibush/grok-iq"
GITHUB_RELEASES_URL = f"https://github.com/{GITHUB_REPOSITORY}/releases"
GITHUB_LATEST_RELEASE_API = (
    f"https://api.github.com/repos/{GITHUB_REPOSITORY}/releases/latest"
)
UPDATE_CHECK_INTERVAL_SECONDS = 60 * 60
UPDATE_REQUEST_TIMEOUT_SECONDS = 10
MAX_RELEASE_RESPONSE_BYTES = 1024 * 1024
MAX_RELEASE_NOTES_CHARS = 4096
SEMVER_PATTERN = re.compile(
    r"^[vV]?(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
    r"(?:-(?P<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)
HOTFIX_PATTERN = re.compile(r"^hotfix[.-](?P<number>\d+)$", re.IGNORECASE)

ReleaseFetcher = Callable[[], Awaitable[dict[str, Any]]]


class ReleaseNotPublishedError(RuntimeError):
    pass


@total_ordering
@dataclass(slots=True, frozen=True)
class ReleaseVersion:
    major: int
    minor: int
    patch: int
    prerelease: tuple[str, ...] = ()
    hotfix: int | None = None

    @classmethod
    def parse(cls, value: str) -> ReleaseVersion:
        match = SEMVER_PATTERN.fullmatch(str(value or "").strip())
        if match is None:
            raise ValueError(f"版本号格式无效：{value or '空值'}")
        prerelease_text = str(match.group("prerelease") or "")
        hotfix_match = HOTFIX_PATTERN.fullmatch(prerelease_text)
        return cls(
            major=int(match.group("major")),
            minor=int(match.group("minor")),
            patch=int(match.group("patch")),
            prerelease=tuple(prerelease_text.split(".")) if prerelease_text else (),
            hotfix=(int(hotfix_match.group("number")) if hotfix_match else None),
        )

    def __lt__(self, other: object) -> bool:
        if not isinstance(other, ReleaseVersion):
            return NotImplemented
        base = (self.major, self.minor, self.patch)
        other_base = (other.major, other.minor, other.patch)
        if base != other_base:
            return base < other_base
        if self.hotfix is not None or other.hotfix is not None:
            return self._hotfix_rank() < other._hotfix_rank()
        if not self.prerelease or not other.prerelease:
            return bool(self.prerelease) and not other.prerelease
        return self._prerelease_is_lower(self.prerelease, other.prerelease)

    def _hotfix_rank(self) -> tuple[int, int]:
        if self.hotfix is not None:
            return 2, self.hotfix
        if not self.prerelease:
            return 1, 0
        return 0, 0

    @staticmethod
    def _prerelease_is_lower(left: tuple[str, ...], right: tuple[str, ...]) -> bool:
        for left_value, right_value in zip(left, right, strict=False):
            if left_value == right_value:
                continue
            left_numeric = left_value.isdigit()
            right_numeric = right_value.isdigit()
            if left_numeric and right_numeric:
                left_number = int(left_value)
                right_number = int(right_value)
                if left_number != right_number:
                    return left_number < right_number
                continue
            if left_numeric != right_numeric:
                return left_numeric
            return left_value.lower() < right_value.lower()
        return len(left) < len(right)


class UpdateCheckService:
    """Checks GitHub Releases and keeps the latest result in process memory."""

    def __init__(
        self,
        *,
        installed_version: str | None = None,
        interval_seconds: float = UPDATE_CHECK_INTERVAL_SECONDS,
        fetch_latest: ReleaseFetcher | None = None,
    ):
        self.current_version = installed_version or current_version()
        self.interval_seconds = max(1.0, float(interval_seconds))
        self._fetch_latest = fetch_latest or self._fetch_github_release
        self._flight_lock = asyncio.Lock()
        self._inflight: asyncio.Task[dict[str, Any]] | None = None
        self._loop_task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._state = self._initial_state()

    def _initial_state(self) -> dict[str, Any]:
        return {
            "status": "idle",
            "updateAvailable": False,
            "currentVersion": self.current_version,
            "latestVersion": "",
            "releaseUrl": GITHUB_RELEASES_URL,
            "releaseNotes": "",
            "publishedAt": "",
            "checkedAt": "",
            "error": "",
        }

    async def start(self) -> None:
        if self._loop_task is not None and not self._loop_task.done():
            return
        self._stop.clear()
        self._loop_task = asyncio.create_task(
            self._run_loop(), name="grokiq-update-check"
        )

    async def stop(self) -> None:
        self._stop.set()
        loop_task = self._loop_task
        self._loop_task = None
        if loop_task is not None:
            loop_task.cancel()
            await asyncio.gather(loop_task, return_exceptions=True)
        inflight = self._inflight
        if inflight is not None and not inflight.done():
            inflight.cancel()
            await asyncio.gather(inflight, return_exceptions=True)

    def snapshot(self) -> dict[str, Any]:
        return dict(self._state)

    async def check(self) -> dict[str, Any]:
        async with self._flight_lock:
            if self._inflight is None or self._inflight.done():
                self._state = {**self._state, "status": "checking", "error": ""}
                self._inflight = asyncio.create_task(
                    self._check_once(), name="grokiq-update-check-request"
                )
            task = self._inflight
        return await asyncio.shield(task)

    async def _run_loop(self) -> None:
        while not self._stop.is_set():
            await self.check()
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self.interval_seconds
                )
            except TimeoutError:
                pass

    async def _check_once(self) -> dict[str, Any]:
        checked_at = app_isoformat(utc_now()) or ""
        try:
            release = await self._fetch_latest()
            latest_version = str(release.get("tag_name") or "").strip()
            current = ReleaseVersion.parse(self.current_version)
            latest = ReleaseVersion.parse(latest_version)
            update_available = latest > current
            self._state = {
                "status": "update_available" if update_available else "up_to_date",
                "updateAvailable": update_available,
                "currentVersion": self.current_version,
                "latestVersion": latest_version,
                "releaseUrl": str(release.get("html_url") or GITHUB_RELEASES_URL),
                "releaseNotes": str(release.get("body") or "")[:MAX_RELEASE_NOTES_CHARS],
                "publishedAt": str(release.get("published_at") or ""),
                "checkedAt": checked_at,
                "error": "",
            }
        except ReleaseNotPublishedError:
            self._state = {
                **self._initial_state(),
                "status": "no_release",
                "checkedAt": checked_at,
            }
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("GrokIQ update check failed: %s", exc)
            self._state = {
                **self._state,
                "status": "error",
                "currentVersion": self.current_version,
                "checkedAt": checked_at,
                "error": str(exc)[:1000],
            }
        return self.snapshot()

    async def _fetch_github_release(self) -> dict[str, Any]:
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": f"GrokIQ/{self.current_version}",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        async with CurlAsyncSession() as client:
            response = await client.get(
                GITHUB_LATEST_RELEASE_API,
                headers=headers,
                timeout=UPDATE_REQUEST_TIMEOUT_SECONDS,
            )
        raw = bytes(response.content or b"")
        if len(raw) > MAX_RELEASE_RESPONSE_BYTES:
            raise ValueError("GitHub Release 响应超过 1 MiB 限制")
        if response.status_code == 404:
            raise ReleaseNotPublishedError("GitHub 尚未发布 Release")
        if response.status_code >= 300:
            detail = raw.decode("utf-8", errors="replace").strip()[:1000]
            raise ValueError(
                f"GitHub Releases 返回 HTTP {response.status_code}：{detail or '空响应'}"
            )
        try:
            payload = response.json()
        except (TypeError, ValueError) as exc:
            raise ValueError("GitHub Release 响应不是有效 JSON") from exc
        if not isinstance(payload, dict) or not str(payload.get("tag_name") or "").strip():
            raise ValueError("GitHub Release 响应缺少 tag_name")
        return payload
