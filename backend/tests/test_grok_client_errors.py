from __future__ import annotations

from app.integrations.grok2api.client import _response_error


def test_openai_error_response_keeps_scheduler_metadata():
    error = _response_error(
        context="/v1/chat/completions",
        status_code=503,
        body=(
            '{"error":{"code":"client_key_account_scope_unavailable",'
            '"message":"temporarily unavailable","type":"server_error"}}'
        ),
        retry_after="7",
        request_id="request-1",
    )

    assert error.status_code == 503
    assert error.error_code == "client_key_account_scope_unavailable"
    assert error.error_type == "server_error"
    assert error.retry_after_seconds == 7
    assert error.request_id == "request-1"
    assert error.transient is True
    assert "temporarily unavailable" in str(error)


def test_quota_error_is_not_retried_as_scheduler_cooldown():
    error = _response_error(
        context="/v1/chat/completions",
        status_code=429,
        body=(
            '{"error":{"code":"upstream_quota_exhausted",'
            '"message":"quota exhausted","type":"rate_limit_error"}}'
        ),
    )

    assert error.status_code == 429
    assert error.error_code == "upstream_quota_exhausted"
    assert error.transient is False
