from __future__ import annotations

from urllib.parse import quote, unquote, urlsplit


class ProxyNormalizer:
    """Normalizes supported proxy shorthand into an explicit URL."""

    def normalize(self, value: str) -> str:
        raw = "" if value is None else str(value).strip()
        if not raw:
            return ""
        if any(character.isspace() for character in raw):
            raise ValueError("代理地址不能包含空格")
        parsed = self._parse(self._expand_shorthand(raw))
        self._validate(parsed)
        return self._normalized_url(parsed)

    @staticmethod
    def _expand_shorthand(raw: str) -> str:
        if "://" in raw:
            return raw
        if "@" in raw:
            return f"http://{raw}"
        parts = raw.split(":")
        if len(parts) < 4 or not parts[1].isdigit():
            return f"http://{raw}"
        host, port, username, *password_parts = parts
        password = ":".join(password_parts)
        if not all((host, port, username, password)):
            raise ValueError("代理格式无效")
        return (
            f"http://{quote(username, safe='')}:{quote(password, safe='')}"
            f"@{host}:{port}"
        )

    @staticmethod
    def _parse(raw: str):  # type: ignore[no-untyped-def]
        try:
            parsed = urlsplit(raw)
            port = parsed.port
            del port
            return parsed
        except ValueError as exc:
            raise ValueError("代理地址或端口无效") from exc

    @staticmethod
    def _validate(parsed) -> None:  # type: ignore[no-untyped-def]
        if parsed.scheme.lower() not in {"http", "https", "socks4", "socks5"}:
            raise ValueError("代理协议仅支持 http、https、socks4 或 socks5")
        if not parsed.hostname or parsed.port is None or not 1 <= parsed.port <= 65535:
            raise ValueError("代理格式应为 host:port 或 username:password@host:port")
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError("代理地址不能包含路径、查询参数或片段")
        if (parsed.username is None) != (parsed.password is None):
            raise ValueError("代理账号和密码需要同时填写")

    @staticmethod
    def _normalized_url(parsed) -> str:  # type: ignore[no-untyped-def]
        credentials = (
            f"{quote(unquote(parsed.username), safe='')}:"
            f"{quote(unquote(parsed.password), safe='')}@"
            if parsed.username is not None and parsed.password is not None
            else ""
        )
        hostname = parsed.hostname or ""
        host = f"[{hostname}]" if ":" in hostname and not hostname.startswith("[") else hostname
        return f"{parsed.scheme.lower()}://{credentials}{host}:{parsed.port}"
