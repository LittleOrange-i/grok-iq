from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

import pytest

from app.core.config import Settings
from app.persistence.auth_repository import AuthRepository
from app.persistence.database import Database
from app.services.auth_service import AuthService
from app.web.routes.chat import _sse_event_boundary, _stream_chunk_is_terminal

LIVE_RESPONSES_URL = os.environ.get(
    "GROKIQ_LIVE_RESPONSES_URL",
    "https://monitor.lvyrix.com/api/responses",
)
LIVE_MODEL = os.environ.get("GROKIQ_LIVE_STREAM_MODEL", "grok-composer-2.5-fast")
LIVE_PROMPT = "从 1 数到 12，每个数字单独一行，不要解释。"


def _live_stream_enabled() -> bool:
    return os.environ.get("GROKIQ_LIVE_STREAM_TEST", "").strip() == "1"


pytestmark = pytest.mark.skipif(
    not _live_stream_enabled(),
    reason="Set GROKIQ_LIVE_STREAM_TEST=1 to hit the wrapped /api/responses",
)


def _admin_access_token() -> str:
    settings = Settings()
    database = Database(settings.database_path)
    auth = AuthService(settings, AuthRepository(database))
    user = auth.repository.get(1)
    if user is None:
        raise RuntimeError("local GrokIQ admin account is missing")
    return str(auth._session(user)["accessToken"])


def _next_sse_event(buffer: bytearray) -> bytes | None:
    boundary = _sse_event_boundary(buffer)
    if boundary is None:
        return None
    event = bytes(buffer[:boundary])
    del buffer[:boundary]
    return event


def _event_has_generated_delta(event: bytes) -> bool:
    text = event.decode("utf-8", "ignore")
    return (
        '"type":"response.output_text.delta"' in text
        or '"type": "response.output_text.delta"' in text
        or '"type":"response.reasoning_summary_text.delta"' in text
        or '"type": "response.reasoning_summary_text.delta"' in text
        or '"type":"response.reasoning_text.delta"' in text
        or '"type": "response.reasoning_text.delta"' in text
        or '"delta":"' in text
    )


@pytest.mark.asyncio
async def test_wrapped_responses_emits_first_sse_event_before_stream_ends() -> None:
    token = _admin_access_token()
    payload = json.dumps(
        {
            "model": LIVE_MODEL,
            "stream": True,
            "messages": [{"role": "user", "content": LIVE_PROMPT}],
        },
        ensure_ascii=False,
    )
    proc = await asyncio.create_subprocess_exec(
        "curl",
        "-sS",
        "-N",
        "--no-buffer",
        "--http1.1",
        "-m",
        "90",
        "-H",
        f"Authorization: Bearer {token}",
        "-H",
        "Content-Type: application/json",
        "-H",
        "Accept: text/event-stream",
        "-H",
        "Accept-Encoding: identity",
        "-H",
        "Cache-Control: no-cache",
        "-X",
        "POST",
        "--data-binary",
        payload,
        LIVE_RESPONSES_URL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.stdout is not None

    started = time.perf_counter()
    first_event_ms = 0
    first_delta_ms = 0
    completed_ms = 0
    event_count = 0
    buffer = bytearray()
    raw = bytearray()

    try:
        while True:
            chunk = await proc.stdout.read(256)
            if not chunk:
                break
            now_ms = max(1, round((time.perf_counter() - started) * 1000))
            if first_event_ms == 0:
                first_event_ms = now_ms
            raw.extend(chunk)
            buffer.extend(chunk)
            while True:
                event = _next_sse_event(buffer)
                if event is None:
                    break
                event_count += 1
                if first_delta_ms == 0 and _event_has_generated_delta(event):
                    first_delta_ms = max(
                        1, round((time.perf_counter() - started) * 1000)
                    )
                if _stream_chunk_is_terminal(event):
                    completed_ms = max(
                        1, round((time.perf_counter() - started) * 1000)
                    )
                    proc.terminate()
                    break
            if completed_ms:
                break
    finally:
        if proc.returncode is None:
            proc.kill()
        stdout, stderr = await proc.communicate()
        raw.extend(stdout)

    ended_ms = max(1, round((time.perf_counter() - started) * 1000))
    metrics: dict[str, Any] = {
        "url": LIVE_RESPONSES_URL,
        "model": LIVE_MODEL,
        "first_event_ms": first_event_ms,
        "first_delta_ms": first_delta_ms,
        "completed_ms": completed_ms or ended_ms,
        "connection_end_ms": ended_ms,
        "event_count": event_count,
        "bytes": len(raw),
        "stderr": stderr.decode("utf-8", "replace")[:500],
        "preview": raw[:240].decode("utf-8", "replace"),
    }
    print("wrapped_responses_stream " + json.dumps(metrics, ensure_ascii=False))

    assert first_event_ms > 0, metrics
    assert event_count > 0, metrics
    assert completed_ms > 0, metrics
    if completed_ms >= 2500:
        assert first_delta_ms > 0, metrics
        assert first_delta_ms < completed_ms * 0.5, metrics
    assert ended_ms - completed_ms < 3000, metrics
