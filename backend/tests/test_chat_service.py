from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from curl_cffi.const import CurlHttpVersion, CurlOpt

from app.integrations.grok2api.http_session import abort_curl_stream, streaming_curl_options
from app.services.chat_service import ChatService


@pytest.mark.asyncio
async def test_open_completion_uses_identity_encoding_and_streaming() -> None:
    settings = MagicMock(grok2api_http_impersonate="chrome")
    providers = MagicMock()
    providers.get_default.return_value = {
        "id": "provider-1",
        "base_url": "https://api.test/v1/responses",
        "api_key": "key",
        "enabled": True,
    }
    response = MagicMock(status_code=200, headers={"content-type": "text/event-stream"})
    session = MagicMock()
    session.post = AsyncMock(return_value=response)
    session.close = AsyncMock()

    with patch("app.services.chat_service.open_curl_session", return_value=session) as factory:
        stream = await ChatService(settings=settings, providers=providers).open_completion(
            provider_id="", body=b'{"messages":[]}', request_headers={}
        )

    session.post.assert_awaited_once()
    kwargs = session.post.await_args.kwargs
    assert kwargs["stream"] is True
    assert kwargs["accept_encoding"] == "identity"
    assert session.post.await_args.args[0] == "https://api.test/v1/responses"
    assert stream.response is response
    factory.assert_called_once()
    assert factory.call_args.kwargs["base_url"] == "https://api.test/v1/responses"


def test_responses_provider_payload_translates_messages_to_input() -> None:
    body = json.dumps(
        {
            "model": "grok-4.5",
            "stream": True,
            "messages": [
                {"role": "system", "content": "Be concise."},
                {"role": "user", "content": "hello"},
            ],
        }
    ).encode()

    result = ChatService._prepare_completion_body(body, "https://api.test/v1/responses")
    payload = json.loads(result)

    assert payload["instructions"] == "Be concise."
    assert payload["input"] == [{"role": "user", "content": "hello"}]
    assert payload["stream"] is True
    assert payload["store"] is False
    assert payload["reasoning"] == {"summary": "auto"}
    assert "messages" not in payload


def test_responses_provider_payload_keeps_explicit_store_and_reasoning() -> None:
    body = json.dumps(
        {
            "model": "grok-4.5",
            "stream": True,
            "store": True,
            "reasoning": {"effort": "high"},
            "messages": [{"role": "user", "content": "hello"}],
        }
    ).encode()

    payload = json.loads(
        ChatService._prepare_completion_body(body, "https://api.test/v1/responses")
    )

    assert payload["store"] is True
    assert payload["reasoning"] == {"effort": "high"}


def test_chat_provider_payload_is_unchanged_for_chat_completions() -> None:
    body = b'{"model":"grok-4.5","messages":[]}'
    assert ChatService._prepare_completion_body(body, "https://api.test/v1/chat/completions") == body


def test_responses_provider_payload_converts_token_limit() -> None:
    body = json.dumps(
        {
            "model": "grok-4.5",
            "stream": True,
            "max_tokens": 128,
            "messages": [{"role": "user", "content": "hello"}],
        }
    ).encode()

    payload = json.loads(
        ChatService._prepare_completion_body(body, "https://api.test/v1/responses")
    )

    assert payload["max_output_tokens"] == 128
    assert "max_tokens" not in payload
    assert "messages" not in payload


def test_completion_url_defaults_to_responses() -> None:
    assert ChatService._completion_url("https://api.test/v1/responses") == "https://api.test/v1/responses"
    assert ChatService._completion_url("https://api.test") == "https://api.test/v1/responses"
    assert (
        ChatService._completion_url("https://api.test/v1/chat/completions")
        == "https://api.test/v1/chat/completions"
    )


def test_root_provider_uses_responses_only() -> None:
    assert ChatService._completion_urls("https://api.test") == [
        "https://api.test/v1/responses",
    ]


def test_streaming_curl_options_force_http11_only_for_cleartext() -> None:
    cleartext = streaming_curl_options("http://127.0.0.1:8000")
    https = streaming_curl_options("https://api.lvyrix.com")

    assert cleartext[CurlOpt.ACCEPT_ENCODING] == b"identity"
    assert cleartext[CurlOpt.HTTP_VERSION] == CurlHttpVersion.V1_1
    assert CurlOpt.HTTP_VERSION not in https
    assert https[CurlOpt.TCP_NODELAY] == 1


@pytest.mark.asyncio
async def test_abort_curl_stream_prefers_aclose_over_handle_close() -> None:
    response = MagicMock()
    response.quit_now = MagicMock()
    response.curl = MagicMock()
    response.aclose = AsyncMock()
    response.astream_task = None

    await abort_curl_stream(response)

    response.quit_now.set.assert_called_once()
    response.aclose.assert_awaited_once()
    response.curl.close.assert_not_called()


@pytest.mark.asyncio
async def test_abort_curl_stream_closes_handle_when_aclose_missing() -> None:
    response = MagicMock()
    response.quit_now = MagicMock()
    response.curl = MagicMock()
    response.aclose = None
    response.astream_task = None

    await abort_curl_stream(response)

    response.quit_now.set.assert_called_once()
    response.curl.close.assert_called_once()


@pytest.mark.asyncio
async def test_abort_curl_stream_cancels_hanging_astream_task() -> None:
    async def hang() -> None:
        await asyncio.sleep(30)

    response = MagicMock()
    response.quit_now = MagicMock()
    response.curl = MagicMock()
    response.aclose = AsyncMock(side_effect=lambda: asyncio.sleep(30))
    response.astream_task = asyncio.create_task(hang())

    await asyncio.wait_for(abort_curl_stream(response), timeout=1)

    response.quit_now.set.assert_called_once()
    assert response.astream_task.cancelled() or response.astream_task.done()
    response.curl.close.assert_not_called()


@pytest.mark.asyncio
async def test_abort_curl_stream_does_not_wait_for_hanging_aclose() -> None:
    async def hang_aclose() -> None:
        await asyncio.sleep(30)

    response = MagicMock()
    response.quit_now = MagicMock()
    response.curl = MagicMock()
    response.aclose = hang_aclose
    response.astream_task = None

    await asyncio.wait_for(abort_curl_stream(response), timeout=1)

    response.quit_now.set.assert_called_once()
    response.curl.close.assert_called_once()

