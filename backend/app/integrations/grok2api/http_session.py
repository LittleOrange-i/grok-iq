from __future__ import annotations

import asyncio
from typing import Any

from curl_cffi.const import CurlHttpVersion, CurlOpt
from curl_cffi.requests import AsyncSession as CurlAsyncSession


def streaming_curl_options(base_url: str = "") -> dict[int, object]:
    """Keep SSE chunks unbuffered when talking to grok2api.

    The default gateway is cleartext ``http://127.0.0.1:8000``, which only
    speaks HTTP/1.1. Forcing HTTP/1.1 on ``https://`` would disable the
    browser-like HTTP/2 flush path, so HTTPS leaves the version to impersonate.
    """

    options: dict[int, object] = {
        CurlOpt.ACCEPT_ENCODING: b"identity",
        CurlOpt.BUFFERSIZE: 1024,
        CurlOpt.TCP_NODELAY: 1,
    }
    if _is_cleartext_http(base_url):
        options[CurlOpt.HTTP_VERSION] = CurlHttpVersion.V1_1
    return options


def open_curl_session(*, impersonate: str, base_url: str = "") -> CurlAsyncSession:
    return CurlAsyncSession(
        impersonate=impersonate,
        default_headers=False,
        curl_options=streaming_curl_options(base_url),
    )


async def abort_curl_stream(response: Any) -> None:
    """Stop waiting for a completed SSE body that the server has not closed.

    curl_cffi's ``aclose()`` only awaits ``astream_task``. After
    ``response.completed`` grok2api often keeps the socket open, so that wait
    can run until the 300s timeout. Cancel the stream task first; only close
    the easy handle if cancellation did not finish.
    """

    quit_now = getattr(response, "quit_now", None)
    setter = getattr(quit_now, "set", None)
    if setter is not None:
        setter()

    task = getattr(response, "astream_task", None)
    if isinstance(task, asyncio.Task) and not task.done():
        task.cancel()
        try:
            await asyncio.wait_for(task, timeout=0.3)
        except (TimeoutError, asyncio.CancelledError, Exception):
            pass
        if not task.done():
            _close_curl_handle(response)
            try:
                await asyncio.wait_for(task, timeout=0.3)
            except (TimeoutError, asyncio.CancelledError, Exception):
                pass
        return

    aclose = getattr(response, "aclose", None)
    if callable(aclose):
        try:
            await asyncio.wait_for(aclose(), timeout=0.2)
            return
        except Exception:
            pass
    _close_curl_handle(response)


def _close_curl_handle(response: Any) -> None:
    curl = getattr(response, "curl", None)
    closer = getattr(curl, "close", None)
    if closer is None:
        return
    try:
        closer()
    except Exception:
        return


def _is_cleartext_http(base_url: str) -> bool:
    return base_url.strip().lower().startswith("http://")
