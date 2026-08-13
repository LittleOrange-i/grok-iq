from __future__ import annotations

import base64
import json
import re
import time
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from curl_cffi import requests as curl_requests

HOME_URL = "https://grok.com/"
COOKIE_DOMAINS = (
    ".x.ai",
    "accounts.x.ai",
    "auth.x.ai",
    ".grok.com",
    "grok.com",
)


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _integer(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_url(value: Any) -> str:
    raw = _text(value)
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw)
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    except ValueError:
        return ""


def _iso_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class SsoCredential:
    token: str = field(repr=False)
    expected_email: str = ""
    label: str = ""


class SsoCredentialLoader:
    @classmethod
    def load(cls, content: str) -> list[SsoCredential]:
        output: list[SsoCredential] = []
        for line_number, line in enumerate(str(content or "").splitlines(), 1):
            raw = line.strip()
            if not raw or raw.startswith("#"):
                continue
            email = ""
            token = raw
            if "----" in raw:
                parts = [part.strip() for part in raw.split("----")]
                email = parts[0] if len(parts) > 1 else ""
                token = parts[-1]
            if token.startswith("sso="):
                token = token[4:].strip()
            if token:
                output.append(
                    SsoCredential(
                        token=token,
                        expected_email=email,
                        label=email or f"SSO {line_number}",
                    )
                )
        return output


def normalize_proxy(value: str) -> str:
    """Normalize supported HTTP proxy shorthand without persisting it.

    Accepted forms:
    - host:port
    - username:password@host:port
    - host:port:username:password
    - http://username:password@host:port
    """

    raw = _text(value)
    if not raw:
        return ""
    if any(character.isspace() for character in raw):
        raise ValueError("代理地址不能包含空格")

    if "://" not in raw and "@" not in raw:
        parts = raw.split(":")
        if len(parts) >= 4 and parts[1].isdigit():
            host, port, username, *password_parts = parts
            password = ":".join(password_parts)
            if not all((host, port, username, password)):
                raise ValueError("代理格式无效")
            raw = (
                f"http://{quote(username, safe='')}:{quote(password, safe='')}"
                f"@{host}:{port}"
            )
        else:
            raw = f"http://{raw}"
    elif "://" not in raw:
        raw = f"http://{raw}"

    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as exc:
        raise ValueError("代理地址或端口无效") from exc
    if parsed.scheme.lower() not in {"http", "https", "socks4", "socks5"}:
        raise ValueError("代理协议仅支持 http、https、socks4 或 socks5")
    if not parsed.hostname or port is None or not 1 <= port <= 65535:
        raise ValueError("代理格式应为 host:port 或 username:password@host:port")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("代理地址不能包含路径、查询参数或片段")
    if (parsed.username is None) != (parsed.password is None):
        raise ValueError("代理账号和密码需要同时填写")
    username = parsed.username
    password = parsed.password
    credentials = (
        f"{quote(unquote(username), safe='')}:{quote(unquote(password), safe='')}@"
        if username is not None and password is not None
        else ""
    )
    hostname = parsed.hostname or ""
    host = (
        f"[{hostname}]"
        if ":" in hostname and not hostname.startswith("[")
        else hostname
    )
    return f"{parsed.scheme.lower()}://{credentials}{host}:{port}"


class SsoChecker:
    """Read authenticated account state without persisting the submitted SSO."""

    def __init__(
        self,
        *,
        timeout: int = 20,
        max_workers: int = 8,
        impersonate: str = "chrome",
        proxy: str = "",
        session_factory: Callable[[], Any] | None = None,
    ) -> None:
        self.timeout = timeout
        self.max_workers = max_workers
        self.impersonate = impersonate
        self.proxy = normalize_proxy(proxy)
        self._session_factory = session_factory

    def check_many(
        self,
        credentials: list[SsoCredential],
        *,
        progress: Callable[[int, int, dict[str, Any]], None] | None = None,
    ) -> list[dict[str, Any]]:
        if not credentials:
            return []
        results: list[dict[str, Any] | None] = [None] * len(credentials)
        with ThreadPoolExecutor(max_workers=min(self.max_workers, len(credentials))) as pool:
            futures = {
                pool.submit(self.check, credential): index
                for index, credential in enumerate(credentials)
            }
            completed = 0
            for future in as_completed(futures):
                result = future.result()
                results[futures[future]] = result
                completed += 1
                if progress is not None:
                    progress(completed, len(credentials), result)
        for index in range(len(credentials)):
            credentials[index] = SsoCredential(token="")
        return [result for result in results if result is not None]

    def check(self, credential: SsoCredential) -> dict[str, Any]:
        started = time.perf_counter()
        base: dict[str, Any] = {
            "label": credential.label,
            "expected_email": credential.expected_email,
            "checked_at": _iso_now(),
            "jwt_valid": self._jwt_valid(credential.token),
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
        session: Any | None = None
        try:
            session = (
                self._session_factory()
                if self._session_factory is not None
                else curl_requests.Session()
            )
            if self.proxy:
                session.proxies = {"http": self.proxy, "https": self.proxy}
            for domain in COOKIE_DOMAINS:
                session.cookies.set("sso", credential.token, domain=domain)
                session.cookies.set("sso-rw", credential.token, domain=domain)
            response = session.get(
                HOME_URL,
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
            response_url = _text(response.url)
            if self.proxy:
                response_url = response_url.replace(self.proxy, "[PROXY]")
            base["status_code"] = int(response.status_code or 0)
            base["final_url"] = _safe_url(response_url)
            if response.status_code != 200:
                base["error"] = f"HTTP {response.status_code}"
                return self._finish(base, started)

            initial = self._initial_data(response.text)
            user = initial.get("user") if initial else None
            if not isinstance(user, Mapping):
                base["verdict"] = "invalid_or_unknown"
                base["error"] = "页面中未读取到登录账号资料"
                base["bot_flag"] = self._bot_flag_from_text(response.text)
                return self._finish(base, started)

            account = {
                "email": _text(user.get("email")),
                "user_id": _text(user.get("userId")),
                "given_name": _text(user.get("givenName")),
                "family_name": _text(user.get("familyName")),
                "display_name": " ".join(
                    part
                    for part in (_text(user.get("givenName")), _text(user.get("familyName")))
                    if part
                ),
                "email_confirmed": user.get("emailConfirmed")
                if isinstance(user.get("emailConfirmed"), bool)
                else None,
                "session_tier_id": _text(user.get("sessionTierId")),
                "x_subscription_type": _text(user.get("xSubscriptionType")),
                "country_code": _text(initial.get("countryCode")),
                "region": _text(initial.get("region")),
                "region_code": _text(initial.get("regionCode")),
                "organization_id": _text(user.get("organizationId")),
                "organization_type": _integer(user.get("organizationType")),
                "create_time": _integer(user.get("createTime")),
            }
            profile_found = bool(
                account["email"] or account["user_id"] or _text(user.get("sessionId"))
            )
            if not profile_found:
                base["verdict"] = "invalid_or_unknown"
                base["error"] = "登录账号资料为空"
                base["bot_flag"] = self._bot_flag(user)
                return self._finish(base, started)

            bot_flag = self._bot_flag(user)
            expected = credential.expected_email.casefold()
            actual = str(account["email"]).casefold()
            email_match = bool(actual and actual == expected) if expected else None
            # Product rule: only an explicit bot=0 is normal; every other
            # value (including missing/unknown) is a risk marker.
            flagged = bot_flag["source"] != 0
            bot_flag["flagged"] = flagged
            if email_match is False:
                verdict = "flagged_email_mismatch" if flagged else "email_mismatch"
            else:
                verdict = "flagged" if flagged else "clean"
            base.update(
                valid_session=True,
                email_match=email_match,
                verdict=verdict,
                account=account,
                bot_flag=bot_flag,
            )
            return self._finish(base, started)
        except Exception as exc:
            message = str(exc)[:300]
            if credential.token:
                message = message.replace(credential.token, "[REDACTED]")
            if self.proxy:
                message = message.replace(self.proxy, "[PROXY]")
                parsed_proxy = urlsplit(self.proxy)
                if parsed_proxy.password:
                    message = message.replace(parsed_proxy.password, "[REDACTED]")
            base["error"] = message
            return self._finish(base, started)
        finally:
            close = getattr(session, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass

    @staticmethod
    def _finish(value: dict[str, Any], started: float) -> dict[str, Any]:
        value["response_ms"] = round((time.perf_counter() - started) * 1000)
        return value

    @staticmethod
    def _jwt_valid(token: str) -> bool:
        try:
            parts = token.split(".")
            if len(parts) != 3:
                return False
            payload = parts[1] + "=" * (-len(parts[1]) % 4)
            return isinstance(json.loads(base64.urlsafe_b64decode(payload)), dict)
        except Exception:
            return False

    @staticmethod
    def _initial_data(page_html: str) -> dict[str, Any] | None:
        normalized = str(page_html or "").replace('\\"', '"')
        marker = '"initialData":'
        decoder = json.JSONDecoder()
        position = normalized.find(marker)
        while position >= 0:
            start = position + len(marker)
            try:
                value, _ = decoder.raw_decode(normalized[start:])
                if isinstance(value, dict) and isinstance(value.get("user"), dict):
                    return value
            except (TypeError, ValueError, json.JSONDecodeError):
                pass
            position = normalized.find(marker, start)
        return None

    @classmethod
    def _bot_flag(cls, user: Mapping[str, Any]) -> dict[str, Any]:
        return cls._build_bot_flag(
            found="botFlagSource" in user or "botFlagDetails" in user,
            source=_integer(user.get("botFlagSource")),
            details=_text(user.get("botFlagDetails")),
        )

    @classmethod
    def _bot_flag_from_text(cls, page_html: str) -> dict[str, Any]:
        normalized = str(page_html or "").replace('\\"', '"')
        source_match = re.search(r'botFlagSource"\s*:\s*(null|-?\d+)', normalized)
        details_match = re.search(
            r'botFlagDetails"\s*:\s*(?:null|"((?:\\.|[^"\\])*)")',
            normalized,
        )
        source = None
        if source_match and source_match.group(1) != "null":
            source = _integer(source_match.group(1))
        details = details_match.group(1) if details_match and details_match.group(1) else ""
        if details:
            try:
                details = json.loads(f'"{details}"')
            except (TypeError, ValueError, json.JSONDecodeError):
                pass
        return cls._build_bot_flag(
            found=bool(source_match or details_match),
            source=source,
            details=details,
        )

    @staticmethod
    def _build_bot_flag(
        *, found: bool, source: int | None, details: str
    ) -> dict[str, Any]:
        def field_value(name: str) -> str:
            match = re.search(
                rf"(?:^|,)\s*{re.escape(name)}\s*=\s*([^,]+)", details, re.I
            )
            return match.group(1).strip() if match else ""

        policy = field_value("policy").lower()
        event = field_value("event")
        risk_value = field_value("risk")
        try:
            risk = float(risk_value) if risk_value else None
        except ValueError:
            risk = None
        denied = policy == "deny" and event == "$registration"
        return {
            "found": found,
            "source": source,
            "details": details,
            "policy": policy,
            "risk": risk,
            "event": event,
            "denied": denied,
            "flagged": source != 0,
        }
