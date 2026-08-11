from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import jwt
from jwt import InvalidTokenError

from app.core.clock import app_isoformat
from app.core.config import Settings
from app.persistence.auth_repository import AuthRepository

PASSWORD_ITERATIONS = 310_000
JWT_ALGORITHM = "HS256"
JWT_ISSUER = "grok-account-monitor"
JWT_AUDIENCE = "grok-account-monitor-web"


class AuthenticationError(ValueError):
    pass


class AuthService:
    """Administrator setup, password verification, and signed JWT sessions."""

    def __init__(self, settings: Settings, repository: AuthRepository):
        self.settings = settings
        self.repository = repository
        self.secret = self._load_or_create_secret(settings)

    def setup_required(self) -> bool:
        return self.repository.setup_required()

    def setup(
        self,
        username: str,
        password: str,
        confirm_password: str,
    ) -> dict[str, Any]:
        normalized_username = self._validate_credentials(username, password)
        if password != confirm_password:
            raise ValueError("两次输入的密码不一致")
        salt = secrets.token_bytes(16)
        user = self.repository.create_admin(
            {
                "username": normalized_username,
                "password_salt": base64.urlsafe_b64encode(salt).decode("ascii"),
                "password_hash": self._hash_password(
                    password,
                    salt,
                    PASSWORD_ITERATIONS,
                ),
                "password_iterations": PASSWORD_ITERATIONS,
                "token_version": 1,
            }
        )
        return self._session(user)

    def login(self, username: str, password: str) -> dict[str, Any]:
        normalized_username = str(username or "").strip()
        user = self.repository.find_by_username(normalized_username)
        if user is None:
            # Keep an unknown username on the same expensive password path as
            # a known one, so response timing does not disclose the sole admin.
            self._hash_password(str(password or ""), bytes(16), PASSWORD_ITERATIONS)
            raise AuthenticationError("用户名或密码错误")
        if not self._password_matches(password, user):
            raise AuthenticationError("用户名或密码错误")
        return self._session(user)

    def logout(self, user: dict[str, Any]) -> None:
        if not self.repository.revoke_sessions(int(user["id"])):
            raise AuthenticationError("登录已失效")

    def status(self, authorization: str = "") -> dict[str, Any]:
        try:
            user = self.authenticate_authorization(authorization)
        except AuthenticationError:
            setup_required = self.setup_required()
            return {
                "setupRequired": setup_required,
                "authenticated": False,
                "user": None,
            }
        return {
            "setupRequired": False,
            "authenticated": True,
            "user": self.public_user(user),
        }

    def authenticate_authorization(self, authorization: str) -> dict[str, Any]:
        token = self._bearer_token(authorization)
        if not token:
            raise AuthenticationError("请先登录")
        try:
            payload = jwt.decode(
                token,
                self.secret,
                algorithms=[JWT_ALGORITHM],
                audience=JWT_AUDIENCE,
                issuer=JWT_ISSUER,
                options={
                    "require": [
                        "exp",
                        "iat",
                        "nbf",
                        "sub",
                        "username",
                        "ver",
                        "iss",
                        "aud",
                        "jti",
                    ]
                },
            )
            user_id = int(payload["sub"])
            token_version = int(payload["ver"])
        except (InvalidTokenError, KeyError, TypeError, ValueError) as exc:
            raise AuthenticationError("登录已失效") from exc
        user = self.repository.get(user_id)
        if user is None or int(user.get("token_version") or 0) != token_version:
            raise AuthenticationError("登录已失效")
        if not hmac.compare_digest(
            str(payload.get("username") or ""), str(user["username"])
        ):
            raise AuthenticationError("登录已失效")
        return user

    @staticmethod
    def public_user(user: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": int(user["id"]),
            "username": str(user["username"]),
            "role": "admin",
        }

    def _session(self, user: dict[str, Any]) -> dict[str, Any]:
        issued_at = datetime.now(UTC)
        expires_at = issued_at + timedelta(seconds=self.settings.jwt_ttl_seconds)
        token = jwt.encode(
            {
                "sub": str(user["id"]),
                "username": str(user["username"]),
                "role": "admin",
                "ver": int(user.get("token_version") or 1),
                "iat": issued_at,
                "nbf": issued_at,
                "exp": expires_at,
                "iss": JWT_ISSUER,
                "aud": JWT_AUDIENCE,
                "jti": uuid.uuid4().hex,
            },
            self.secret,
            algorithm=JWT_ALGORITHM,
        )
        return {
            "accessToken": token,
            "tokenType": "bearer",
            "expiresAt": app_isoformat(expires_at),
            "user": self.public_user(user),
        }

    @staticmethod
    def _validate_credentials(username: str, password: str) -> str:
        normalized_username = str(username or "").strip()
        if len(normalized_username) < 3:
            raise ValueError("用户名至少需要 3 个字符")
        if len(normalized_username) > 64:
            raise ValueError("用户名最多 64 个字符")
        if len(password) < 8:
            raise ValueError("密码至少需要 8 个字符")
        if len(password) > 256:
            raise ValueError("密码最多 256 个字符")
        return normalized_username

    @staticmethod
    def _hash_password(password: str, salt: bytes, iterations: int) -> str:
        return hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, iterations
        ).hex()

    def _password_matches(self, password: str, user: dict[str, Any]) -> bool:
        try:
            salt = base64.urlsafe_b64decode(
                str(user["password_salt"]).encode("ascii")
            )
            iterations = int(user.get("password_iterations") or PASSWORD_ITERATIONS)
            expected = str(user["password_hash"])
        except (KeyError, TypeError, ValueError, base64.binascii.Error):
            return False
        actual = self._hash_password(str(password or ""), salt, iterations)
        return hmac.compare_digest(actual, expected)

    @staticmethod
    def _bearer_token(authorization: str) -> str:
        scheme, _, token = str(authorization or "").strip().partition(" ")
        return token.strip() if scheme.lower() == "bearer" else ""

    @staticmethod
    def _load_or_create_secret(settings: Settings) -> str:
        configured = settings.jwt_secret_key.strip()
        if configured:
            if len(configured.encode("utf-8")) < 32:
                raise ValueError("GAM_JWT_SECRET_KEY 至少需要 32 字节")
            return configured
        path = settings.database_path.resolve().with_suffix(".jwt.key")
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            return AuthService._read_secret_file(path)
        secret = secrets.token_urlsafe(48)
        try:
            descriptor = os.open(
                path,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
            )
        except FileExistsError:
            # Multiple worker processes may initialize the composition root at
            # the same time. The process that lost O_EXCL reads the winner.
            return AuthService._read_secret_file(path, attempts=20)
        try:
            os.write(descriptor, f"{secret}\n".encode())
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        return secret

    @staticmethod
    def _read_secret_file(path: Path, *, attempts: int = 1) -> str:
        for attempt in range(attempts):
            try:
                secret = path.read_text(encoding="utf-8").strip()
            except OSError as exc:
                if attempt + 1 >= attempts:
                    raise ValueError(f"JWT 密钥文件读取失败: {path}") from exc
            else:
                if len(secret.encode("utf-8")) >= 32:
                    return secret
                if attempt + 1 >= attempts:
                    raise ValueError(f"JWT 密钥文件内容异常: {path}")
            time.sleep(0.01)
        raise ValueError(f"JWT 密钥文件内容异常: {path}")
