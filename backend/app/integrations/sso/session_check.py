from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from typing import Any
from urllib.parse import urlsplit


class SsoSessionCheck:
    """Executes one SSO-backed page check and maps it to a verdict."""

    def __init__(
        self,
        *,
        home_url: str,
        cookie_domains: tuple[str, ...],
        timeout: int,
        impersonate: str,
        proxy: str,
        session_factory: Callable[[], Any],
        iso_now: Callable[[], str],
        safe_url: Callable[[Any], str],
        jwt_valid: Callable[[str], bool],
        initial_data: Callable[[str], dict[str, Any] | None],
        bot_flag: Callable[[Mapping[str, Any]], dict[str, Any]],
        bot_flag_from_text: Callable[[str], dict[str, Any]],
        text: Callable[[Any], str],
        integer: Callable[[Any], int | None],
    ):
        self.home_url = home_url
        self.cookie_domains = cookie_domains
        self.timeout = timeout
        self.impersonate = impersonate
        self.proxy = proxy
        self.session_factory = session_factory
        self.iso_now = iso_now
        self.safe_url = safe_url
        self.jwt_valid = jwt_valid
        self.initial_data = initial_data
        self.bot_flag = bot_flag
        self.bot_flag_from_text = bot_flag_from_text
        self.text = text
        self.integer = integer

    def run(self, credential: Any) -> dict[str, Any]:
        started = time.perf_counter()
        result = self._base_result(credential)
        session: Any | None = None
        try:
            session = self.session_factory()
            self._configure_session(session, credential.token)
            response = self._request(session)
            self._record_response(result, response)
            if response.status_code != 200:
                result["error"] = f"HTTP {response.status_code}"
                return self._finish(result, started)
            initial = self.initial_data(response.text)
            user = initial.get("user") if initial else None
            if not isinstance(user, Mapping):
                result["verdict"] = "invalid_or_unknown"
                result["error"] = "页面中未读取到登录账号资料"
                result["bot_flag"] = self.bot_flag_from_text(response.text)
                return self._finish(result, started)
            account = self._account(initial, user)
            if not self._profile_found(account, user):
                result["verdict"] = "invalid_or_unknown"
                result["error"] = "登录账号资料为空"
                result["bot_flag"] = self.bot_flag(user)
                return self._finish(result, started)
            result.update(self._verdict(credential.expected_email, account, user))
            return self._finish(result, started)
        except Exception as exc:
            result["error"] = self._redact(str(exc)[:300], credential.token)
            return self._finish(result, started)
        finally:
            close = getattr(session, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass

    def _base_result(self, credential: Any) -> dict[str, Any]:
        return {
            "account_id": getattr(credential, "account_id", None),
            "label": credential.label,
            "expected_email": credential.expected_email,
            "checked_at": self.iso_now(),
            "jwt_valid": self.jwt_valid(credential.token),
            "status_code": 0,
            "final_url": "",
            "valid_session": False,
            "email_match": None,
            "verdict": "error",
            "account": {},
            "bot_flag": {
                "found": False,
                "source": None,
                "details": "",
                "policy": "",
                "risk": None,
                "event": "",
                "denied": False,
                "flagged": False,
            },
            "error": "",
            "response_ms": 0,
        }

    def _configure_session(self, session: Any, token: str) -> None:
        if self.proxy:
            session.proxies = {"http": self.proxy, "https": self.proxy}
        for domain in self.cookie_domains:
            session.cookies.set("sso", token, domain=domain)
            session.cookies.set("sso-rw", token, domain=domain)

    def _request(self, session: Any) -> Any:
        return session.get(
            self.home_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/138.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml",
            },
            impersonate=self.impersonate,
            timeout=self.timeout,
            allow_redirects=True,
        )

    def _record_response(self, result: dict[str, Any], response: Any) -> None:
        response_url = self.text(response.url)
        if self.proxy:
            response_url = response_url.replace(self.proxy, "[PROXY]")
        result["status_code"] = int(response.status_code or 0)
        result["final_url"] = self.safe_url(response_url)

    def _account(
        self, initial: Mapping[str, Any], user: Mapping[str, Any]
    ) -> dict[str, Any]:
        return {
            "email": self.text(user.get("email")),
            "user_id": self.text(user.get("userId")),
            "given_name": self.text(user.get("givenName")),
            "family_name": self.text(user.get("familyName")),
            "display_name": " ".join(
                part
                for part in (self.text(user.get("givenName")), self.text(user.get("familyName")))
                if part
            ),
            "email_confirmed": user.get("emailConfirmed")
            if isinstance(user.get("emailConfirmed"), bool)
            else None,
            "session_tier_id": self.text(user.get("sessionTierId")),
            "x_subscription_type": self.text(user.get("xSubscriptionType")),
            "country_code": self.text(initial.get("countryCode")),
            "region": self.text(initial.get("region")),
            "region_code": self.text(initial.get("regionCode")),
            "organization_id": self.text(user.get("organizationId")),
            "organization_type": self.integer(user.get("organizationType")),
            "create_time": self.integer(user.get("createTime")),
        }

    def _profile_found(
        self, account: dict[str, Any], user: Mapping[str, Any]
    ) -> bool:
        return bool(account["email"] or account["user_id"] or self.text(user.get("sessionId")))

    def _verdict(
        self,
        expected_email: str,
        account: dict[str, Any],
        user: Mapping[str, Any],
    ) -> dict[str, Any]:
        bot_flag = self.bot_flag(user)
        expected = expected_email.casefold()
        actual = str(account["email"]).casefold()
        email_match = bool(actual and actual == expected) if expected else None
        flagged = bot_flag["source"] not in {None, 0}
        bot_flag["flagged"] = flagged
        if email_match is False:
            verdict = "flagged_email_mismatch" if flagged else "email_mismatch"
        else:
            verdict = "flagged" if flagged else "clean"
        return {
            "valid_session": True,
            "email_match": email_match,
            "verdict": verdict,
            "account": account,
            "bot_flag": bot_flag,
        }

    def _redact(self, message: str, token: str) -> str:
        if token:
            message = message.replace(token, "[REDACTED]")
        if self.proxy:
            message = message.replace(self.proxy, "[PROXY]")
            parsed_proxy = urlsplit(self.proxy)
            if parsed_proxy.password:
                message = message.replace(parsed_proxy.password, "[REDACTED]")
        return message

    @staticmethod
    def _finish(value: dict[str, Any], started: float) -> dict[str, Any]:
        value["response_ms"] = round((time.perf_counter() - started) * 1000)
        return value
