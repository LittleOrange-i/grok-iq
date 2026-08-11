from pathlib import Path
from typing import Any

import pytest

from app.core.config import Settings
from app.integrations.grok2api.client import Grok2APIClient
from app.persistence.database import Database
from app.persistence.models import ProbeProfile
from app.persistence.probe_repository import ProbeRepository
from app.persistence.seeds import DEFAULT_PROFILES
from app.web.schemas import ProfileInput


class StubStreamResponse:
    status_code = 200
    headers: dict[str, str] = {}

    async def aiter_content(self):  # type: ignore[no-untyped-def]
        yield b'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n'
        yield (
            b'data: {"choices":[],"usage":{"completion_tokens":1,'
            b'"completion_tokens_details":{"reasoning_tokens":0}}}\n\n'
        )
        yield b"data: [DONE]\n\n"


class StubStreamSession:
    def __init__(self, request_body: dict[str, Any]):
        self.request_body = request_body

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self

    async def __aexit__(self, *_: Any):  # type: ignore[no-untyped-def]
        return None

    async def post(self, _: str, *, json: dict[str, Any], **__: Any):
        self.request_body.update(json)
        return StubStreamResponse()


def test_profile_input_follows_upstream_output_limit_by_default():
    profile = ProfileInput(name="probe", model="model", prompt="prompt")

    assert profile.max_output_tokens == 0


def test_profile_source_distinguishes_built_in_and_custom(tmp_path: Path):
    database = Database(tmp_path / "monitor.db")
    database.initialize()
    repository = ProbeRepository(database)
    repository.seed_defaults()

    custom_id = repository.create_profile(
        {"name": "custom", "model": "grok-4.5", "prompt": "prompt"}
    )
    profiles = {profile["id"]: profile for profile in repository.list_profiles()}

    assert profiles["quality-marker"]["built_in"] is True
    assert profiles[custom_id]["built_in"] is False


def test_default_profiles_migrate_to_follow_upstream_once(tmp_path: Path):
    database = Database(tmp_path / "monitor.db")
    database.initialize()
    legacy_limits = {values["id"]: 256 for values in DEFAULT_PROFILES}
    legacy_limits["html-preview"] = 4096
    with database.transaction() as session:
        for values in DEFAULT_PROFILES:
            session.add(ProbeProfile(**(values | {"max_output_tokens": legacy_limits[values["id"]]})))

    repository = ProbeRepository(database)
    repository.seed_defaults()

    profiles = {profile["id"]: profile for profile in repository.list_profiles()}
    assert all(profiles[profile_id]["max_output_tokens"] == 0 for profile_id in legacy_limits)

    repository.update_profile("html-preview", {"max_output_tokens": 8192})
    repository.seed_defaults()

    assert repository.get_profile("html-preview")["max_output_tokens"] == 8192


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("max_output_tokens", "expected"),
    [(0, None), (2048, 2048)],
)
async def test_chat_probe_only_sends_explicit_output_limit(
    monkeypatch: pytest.MonkeyPatch,
    max_output_tokens: int,
    expected: int | None,
):
    request_body: dict[str, Any] = {}
    client = Grok2APIClient(Settings())
    monkeypatch.setattr(client, "_session", lambda: StubStreamSession(request_body))

    async def find_audit(_: str) -> dict[str, Any]:
        return {"id": "1", "accountId": "7", "egressNodeId": "2"}

    monkeypatch.setattr(client, "find_audit", find_audit)

    await client.chat_probe(
        api_key="key",
        public_model="model",
        account_id=7,
        system_prompt="",
        prompt="prompt",
        expected="OK",
        max_output_tokens=max_output_tokens,
        temperature=None,
        extra_body={},
    )

    assert request_body.get("max_tokens") == expected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("max_output_tokens", "expected"),
    [(0, None), (1024, 1024)],
)
async def test_quality_probe_only_sends_explicit_output_limit(
    monkeypatch: pytest.MonkeyPatch,
    max_output_tokens: int,
    expected: int | None,
):
    request_body: dict[str, Any] = {}
    client = Grok2APIClient(Settings())

    async def admin_request(_: str, __: str, **kwargs: Any) -> dict[str, Any]:
        request_body.update(kwargs["json"])
        return {
            "requestId": "request-1",
            "statusCode": 200,
            "durationMs": 1000,
            "firstTokenMs": 100,
            "generationMs": 900,
            "outputTokens": 100,
            "reasoningTokens": 20,
            "visibleTokens": 80,
            "expectedMatched": True,
        }

    async def find_audit(_: str) -> dict[str, Any]:
        return {"id": "1", "accountId": "7", "egressNodeId": "2"}

    monkeypatch.setattr(client, "admin_request", admin_request)
    monkeypatch.setattr(client, "find_audit", find_audit)

    await client.quality_probe(
        client_key_id="3",
        public_model="model",
        account_id=7,
        egress_node_id=2,
        prompt="prompt",
        expected="OK",
        max_output_tokens=max_output_tokens,
    )

    assert request_body.get("maxOutputTokens") == expected
