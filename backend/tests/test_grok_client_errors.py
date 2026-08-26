from __future__ import annotations

import pytest

from app.core.config import Settings
from app.integrations.grok2api.client import Grok2APIClient, _response_error


class RecordingGrokClient(Grok2APIClient):
    def __init__(self) -> None:
        super().__init__(Settings())
        self.requests: list[tuple[str, str, dict[str, object]]] = []

    async def admin_request(self, method: str, path: str, **kwargs: object) -> dict[str, int]:
        self.requests.append((method, path, kwargs))
        body = kwargs.get("json")
        ids = body.get("ids", []) if isinstance(body, dict) else []
        return {"assigned": len(ids)}


def test_openai_error_response_keeps_scheduler_metadata():
    error = _response_error(
        context="/v1/responses",
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
        context="/v1/responses",
        status_code=429,
        body=(
            '{"error":{"code":"upstream_quota_exhausted",'
            '"message":"quota exhausted","type":"rate_limit_error"}}'
        ),
    )

    assert error.status_code == 429
    assert error.error_code == "upstream_quota_exhausted"
    assert error.transient is False


@pytest.mark.asyncio
async def test_batch_egress_binding_sends_mode_and_unbinds_with_delete():
    client = RecordingGrokClient()

    assigned = await client.set_accounts_egress([1, 2], 7, mode="auto")
    unassigned = await client.set_accounts_egress([1, 2], None)

    assert assigned.updated == 2
    assert unassigned.updated == 2
    assert client.requests == [
        (
            "POST",
            "/api/admin/v1/egress-nodes/7/accounts",
            {"json": {"provider": "grok_build", "ids": ["1", "2"], "mode": "auto"}},
        ),
        (
            "DELETE",
            "/api/admin/v1/egress-nodes/accounts",
            {"json": {"provider": "grok_build", "ids": ["1", "2"], "mode": "manual"}},
        ),
    ]
