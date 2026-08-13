from __future__ import annotations

import base64
import json
import re
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from curl_cffi import requests as curl_requests

from app.integrations.sso.proxy_normalizer import ProxyNormalizer
from app.integrations.sso.session_check import SsoSessionCheck

HOME_URL = "https://grok.com/"
COOKIE_DOMAINS = (
    ".x.ai",
    "accounts.x.ai",
    "auth.x.ai",
    ".grok.com",
    "grok.com",
)
PROXY_NORMALIZER = ProxyNormalizer()


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

    return PROXY_NORMALIZER.normalize(value)


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
        self._session_check = SsoSessionCheck(
            home_url=HOME_URL,
            cookie_domains=COOKIE_DOMAINS,
            timeout=timeout,
            impersonate=impersonate,
            proxy=self.proxy,
            session_factory=session_factory or curl_requests.Session,
            iso_now=_iso_now,
            safe_url=_safe_url,
            jwt_valid=self._jwt_valid,
            initial_data=self._initial_data,
            bot_flag=self._bot_flag,
            bot_flag_from_text=self._bot_flag_from_text,
            text=_text,
            integer=_integer,
        )

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
        return self._session_check.run(credential)

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
