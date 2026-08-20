from __future__ import annotations

import json

from app.integrations.sso.checker import (
    SsoChecker,
    SsoCredential,
    SsoCredentialLoader,
    normalize_proxy,
)


def page(source: int | None) -> str:
    user = {
        "userId": "USER-ID",
        "email": "account@example.com",
        "givenName": "Ada",
        "familyName": "Lovelace",
        "sessionTierId": "2",
        "botFlagSource": source,
        "botFlagDetails": None,
    }
    initial = {"user": user, "countryCode": "US", "regionCode": "VA"}
    escaped = json.dumps(initial, separators=(",", ":")).replace('"', '\\"')
    return f'<script>x:{{\\"initialData\\":{escaped}}}</script>'


class Cookies:
    def set(self, *_args, **_kwargs) -> None:
        pass


class Response:
    status_code = 200
    url = "https://grok.com/?secret=value"

    def __init__(self, body: str):
        self.text = body


class Session:
    def __init__(self, body: str):
        self.cookies = Cookies()
        self.body = body
        self.proxies: dict[str, str] = {}

    def get(self, *_args, **_kwargs) -> Response:
        return Response(self.body)

    def close(self) -> None:
        pass


def checker_for(body: str) -> SsoChecker:
    return SsoChecker(session_factory=lambda: Session(body))


def test_loader_treats_each_non_empty_line_as_one_sso() -> None:
    values = SsoCredentialLoader.load(
        "TOKEN-1\naccount@example.com----password----TOKEN-2"
    )
    assert [item.token for item in values] == ["TOKEN-1", "TOKEN-2"]
    assert values[1].expected_email == "account@example.com"


def test_only_bot_zero_is_clean() -> None:
    assert checker_for(page(0)).check(SsoCredential("TOKEN"))["verdict"] == "clean"
    assert checker_for(page(3)).check(SsoCredential("TOKEN"))["verdict"] == "flagged"
    assert checker_for(page(None)).check(SsoCredential("TOKEN"))["verdict"] == "clean"


def test_proxy_shorthand_is_normalized() -> None:
    assert normalize_proxy("127.0.0.1:8080") == "http://127.0.0.1:8080"
    assert (
        normalize_proxy("proxy-user:proxy-pass@127.0.0.1:8080")
        == "http://proxy-user:proxy-pass@127.0.0.1:8080"
    )
    assert (
        normalize_proxy("127.0.0.1:8080:proxy-user:proxy-pass")
        == "http://proxy-user:proxy-pass@127.0.0.1:8080"
    )


def test_checker_applies_proxy_to_both_protocols() -> None:
    session = Session(page(0))
    checker = SsoChecker(
        proxy="127.0.0.1:8080",
        session_factory=lambda: session,
    )
    checker.check(SsoCredential("TOKEN"))
    assert session.proxies == {
        "http": "http://127.0.0.1:8080",
        "https": "http://127.0.0.1:8080",
    }
