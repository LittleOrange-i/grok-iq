from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

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

    with patch("app.services.chat_service.CurlAsyncSession", return_value=session):
        stream = await ChatService(settings=settings, providers=providers).open_completion(
            provider_id="", body=b'{"messages":[]}', request_headers={}
        )

    session.post.assert_awaited_once()
    kwargs = session.post.await_args.kwargs
    assert kwargs["stream"] is True
    assert kwargs["accept_encoding"] == "identity"
    assert session.post.await_args.args[0] == "https://api.test/v1/responses"
    assert stream.response is response


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
    assert "messages" not in payload


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
