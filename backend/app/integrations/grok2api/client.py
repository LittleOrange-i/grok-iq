from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

from curl_cffi.requests import AsyncSession as CurlAsyncSession

from app.core.config import Settings


class IntegrationError(RuntimeError):
    """An error while talking to grok2api.

    The original implementation only kept a formatted string.  That made a
    transient scheduler response (for example ``upstream_cooling``) look the
    same as an invalid request or an authentication failure to the probe
    queue.  Keep the human-readable message for existing callers while also
    exposing the machine-readable response metadata used by retry and task
    detail rendering.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 0,
        error_code: str = "",
        error_type: str = "",
        retry_after_seconds: float = 0.0,
        response_body: str = "",
        request_id: str = "",
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.error_type = error_type
        self.retry_after_seconds = max(0.0, retry_after_seconds)
        self.response_body = response_body
        self.request_id = request_id
        self.attempt_count = 1

    @property
    def transient(self) -> bool:
        return is_transient_gateway_error(
            status_code=self.status_code,
            error_code=self.error_code,
        )


TRANSIENT_GATEWAY_CODES = frozenset(
    {
        "client_key_account_scope_unavailable",
        "upstream_cooling",
        "upstream_model_cooling",
        "upstream_network_error",
        "upstream_saturated",
    }
)
ADMIN_REFRESH_COOKIE = "grok2api_admin_refresh"
ADMIN_TOKEN_REFRESH_SKEW_SECONDS = 30.0
ACCOUNT_BATCH_UPDATE_SIZE = 10_000
ACCOUNT_BATCH_FALLBACK_CONCURRENCY = 8
ACCOUNT_BATCH_FALLBACK_STATUSES = frozenset({400, 404, 405, 409, 422})

logger = logging.getLogger(__name__)


def is_transient_gateway_error(*, status_code: int, error_code: str) -> bool:
    """Return whether a failed probe may succeed after a short wait.

    A remaining quota value does not imply that the selector can lease the
    account right now.  These codes represent cooling, transport, or capacity
    state and are safe for the monitor to retry once the upstream scheduler
    has had time to recover.  Credential, model, and quota failures are left
    as final samples so they are not hidden by retries.
    """

    if error_code in TRANSIENT_GATEWAY_CODES:
        return True
    return status_code in {502, 503, 504}


def _parse_error_payload(raw: str) -> tuple[str, str, str]:
    """Extract ``code``, ``message`` and ``type`` from an OpenAI error body."""

    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return "", raw.strip(), ""
    if not isinstance(payload, dict):
        return "", raw.strip(), ""
    value = payload.get("error", payload)
    if isinstance(value, dict):
        code = str(value.get("code") or "")
        message = str(value.get("message") or "")
        error_type = str(value.get("type") or "")
        return code, message, error_type
    return "", str(value or raw).strip(), ""


def _parse_retry_after(value: str | None) -> float:
    if not value:
        return 0.0
    try:
        return max(0.0, float(value.strip()))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return max(0.0, (parsed.astimezone(UTC) - datetime.now(UTC)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return 0.0


def _parse_timestamp(value: Any) -> float:
    if not value:
        return 0.0
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError, OverflowError):
        return 0.0


def _response_error(
    *,
    context: str,
    status_code: int,
    body: str,
    retry_after: str | None = None,
    request_id: str = "",
) -> IntegrationError:
    code, message, error_type = _parse_error_payload(body)
    detail = message or body.strip() or f"HTTP {status_code}"
    return IntegrationError(
        f"{context} 返回 HTTP {status_code}: {detail[:1000]}",
        status_code=status_code,
        error_code=code,
        error_type=error_type,
        retry_after_seconds=_parse_retry_after(retry_after),
        response_body=body[:4000],
        request_id=request_id,
    )


@dataclass(slots=True, frozen=True)
class ChatProbeResult:
    request_id: str
    audit_id: int | None
    verified_account_id: int | None
    verified_egress_node_id: int | None
    status_code: int
    response_text: str
    response_sha256: str
    output_tokens: int
    reasoning_tokens: int
    visible_tokens: int
    chunk_count: int
    first_token_ms: int
    duration_ms: int
    generation_ms: int
    first_token_share: float
    tps: float
    expected_matched: bool
    usage: dict[str, Any]


@dataclass(slots=True, frozen=True)
class AccountUpdateFailure:
    account_id: int
    error: str


@dataclass(slots=True, frozen=True)
class AccountBatchUpdateResult:
    updated: int
    failures: tuple[AccountUpdateFailure, ...] = ()


class Grok2APIClient:
    """API-only integration with grok2api.

    Account and proxy lists are read live. For a probe run this adapter creates
    a temporary account-bound model route and (when needed) a temporary client
    key, changes the selected account's egress binding, calls the normal
    ``/v1/chat/completions`` endpoint, verifies the request audit, and restores
    upstream state.
    """

    max_stream_bytes = 4 << 20

    def __init__(self, settings: Settings):
        self.settings = settings
        self._token = ""
        self._token_expires_at = 0.0
        self._refresh_token = ""
        self._login_lock = asyncio.Lock()

    def _session(self) -> CurlAsyncSession:
        return CurlAsyncSession(impersonate=self.settings.grok2api_http_impersonate)

    def reset_credentials(self) -> None:
        """Drop cached login state after runtime connection settings change."""

        self._token = ""
        self._token_expires_at = 0.0
        self._refresh_token = ""

    def _token_is_usable(self) -> bool:
        if not self._token:
            return False
        if self._token_expires_at <= 0:
            return True
        return time.time() + ADMIN_TOKEN_REFRESH_SKEW_SECONDS < self._token_expires_at

    def _credentials_configured(self) -> bool:
        return bool(
            self.settings.grok2api_admin_username
            and self.settings.grok2api_admin_password
        )

    async def _auth_post(self, path: str, *, body: dict[str, Any], context: str) -> Any:
        try:
            async with self._session() as client:
                response = await client.post(
                    f"{self.settings.normalized_gateway_base_url}{path}",
                    json=body,
                    timeout=30,
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise IntegrationError(f"{context}请求失败: {exc}") from exc
        if response.status_code >= 300:
            raise _response_error(
                context=context,
                status_code=response.status_code,
                body=response.text[:4000],
                retry_after=response.headers.get("Retry-After"),
            )
        return response

    def _remember_admin_tokens(
        self,
        tokens: dict[str, Any],
        response: Any,
        *,
        refresh_rotated: bool,
    ) -> str:
        access_token = str(tokens.get("accessToken") or "")
        if not access_token:
            raise IntegrationError("管理员鉴权响应缺少 accessToken")
        self._token = access_token
        self._token_expires_at = _parse_timestamp(tokens.get("accessTokenExpiresAt"))
        refresh_token = str(response.cookies.get(ADMIN_REFRESH_COOKIE) or "")
        if refresh_token:
            self._refresh_token = refresh_token
        elif refresh_rotated:
            # grok2api rotates refresh tokens. Keeping the previous value would
            # guarantee another 401, so fall back to password login next time.
            self._refresh_token = ""
        return self._token

    async def _login_locked(self) -> str:
        if not self._credentials_configured():
            raise IntegrationError("尚未配置 grok2api 管理员凭据")
        response = await self._auth_post(
            "/api/admin/v1/auth/login",
            body={
                "username": self.settings.grok2api_admin_username,
                "password": self.settings.grok2api_admin_password,
            },
            context="管理员登录",
        )
        payload = response.json()
        data = payload.get("data", payload)
        tokens = data.get("tokens", {}) if isinstance(data, dict) else {}
        return self._remember_admin_tokens(tokens, response, refresh_rotated=False)

    async def _refresh_locked(self) -> str:
        if not self._refresh_token:
            raise IntegrationError("管理员刷新会话不存在", status_code=401)
        response = await self._auth_post(
            "/api/admin/v1/auth/refresh",
            body={"refreshToken": self._refresh_token},
            context="管理员会话刷新",
        )
        payload = response.json()
        tokens = payload.get("data", payload)
        if not isinstance(tokens, dict):
            tokens = {}
        return self._remember_admin_tokens(tokens, response, refresh_rotated=True)

    async def _admin_token(self) -> str:
        if self._token_is_usable():
            return self._token
        async with self._login_lock:
            if self._token_is_usable():
                return self._token
            if self._refresh_token:
                try:
                    return await self._refresh_locked()
                except IntegrationError:
                    self._refresh_token = ""
            self._token = ""
            self._token_expires_at = 0.0
            return await self._login_locked()

    async def _renew_admin_token(self, rejected_token: str) -> str:
        async with self._login_lock:
            if (
                self._token
                and self._token != rejected_token
                and self._token_is_usable()
            ):
                return self._token
            self._token = ""
            self._token_expires_at = 0.0
            if self._refresh_token:
                try:
                    return await self._refresh_locked()
                except IntegrationError:
                    self._refresh_token = ""
            return await self._login_locked()

    async def _invalidate_admin_token(self, rejected_token: str) -> None:
        async with self._login_lock:
            if self._token != rejected_token:
                return
            self._token = ""
            self._token_expires_at = 0.0
            self._refresh_token = ""

    async def admin_request(self, method: str, path: str, **kwargs: Any) -> Any:
        token = await self._admin_token()
        base_headers = dict(kwargs.pop("headers", {}))
        timeout = kwargs.pop("timeout", 180)

        async def send(current_token: str) -> Any:
            headers = {**base_headers, "Authorization": f"Bearer {current_token}"}
            try:
                async with self._session() as client:
                    return await client.request(
                        method,
                        f"{self.settings.normalized_gateway_base_url}{path}",
                        headers=headers,
                        timeout=timeout,
                        **kwargs,
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                raise IntegrationError(f"grok2api 请求失败: {exc}") from exc

        response = await send(token)
        if response.status_code == 401:
            token = await self._renew_admin_token(token)
            response = await send(token)
            if response.status_code == 401:
                await self._invalidate_admin_token(token)
        if response.status_code >= 300:
            raise _response_error(
                context="grok2api",
                status_code=response.status_code,
                body=response.text[:4000],
                retry_after=response.headers.get("Retry-After"),
            )
        if not response.content:
            return {}
        payload = response.json()
        return payload.get("data", payload)

    async def list_accounts(self, **params: Any) -> dict[str, Any]:
        query = {"provider": "grok_build", "page": 1, "pageSize": 50} | params
        return await self.admin_request("GET", "/api/admin/v1/accounts", params=query)

    async def list_all_accounts(
        self,
        account_ids: set[int] | None = None,
        **params: Any,
    ) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        page = 1
        while True:
            payload = await self.list_accounts(**params, page=page, pageSize=200)
            batch = list(payload.get("items", []))
            if account_ids is None:
                items.extend(batch)
            else:
                items.extend(item for item in batch if int(item.get("id") or 0) in account_ids)
            if not batch or page * int(payload.get("pageSize") or 200) >= int(payload.get("total") or 0):
                break
            if account_ids is not None and {int(item.get("id") or 0) for item in items} >= account_ids:
                break
            page += 1
        return items

    async def get_account(self, account_id: int) -> dict[str, Any]:
        return await self.admin_request("GET", f"/api/admin/v1/accounts/{account_id}")

    async def list_egress_nodes(self, **params: Any) -> dict[str, Any]:
        query = {"scope": "grok_build", "page": 1, "pageSize": 100} | params
        return await self.admin_request("GET", "/api/admin/v1/egress-nodes", params=query)

    async def set_account_enabled(self, account_id: int, enabled: bool) -> dict[str, Any]:
        return await self.admin_request(
            "PATCH", f"/api/admin/v1/accounts/{account_id}", json={"enabled": enabled}
        )

    async def recover_account_at_priority(
        self,
        account_id: int,
        *,
        priority: int,
    ) -> dict[str, Any]:
        """Atomically re-enable a quarantined account at a guarded priority."""

        return await self.admin_request(
            "PATCH",
            f"/api/admin/v1/accounts/{account_id}",
            json={"enabled": True, "priority": priority},
        )

    async def set_accounts_enabled(
        self,
        account_ids: list[int],
        enabled: bool,
    ) -> AccountBatchUpdateResult:
        """Update many accounts with a bounded compatibility fallback.

        The native endpoint keeps large selections fast. Older grok2api
        versions and a stale ID inside one batch can reject the entire request,
        so compatible 4xx responses fall back to the single-account endpoint.
        """

        unique_ids = list(
            dict.fromkeys(account_id for account_id in account_ids if account_id > 0)
        )
        updated = 0
        failures: list[AccountUpdateFailure] = []
        for start in range(0, len(unique_ids), ACCOUNT_BATCH_UPDATE_SIZE):
            batch = unique_ids[start : start + ACCOUNT_BATCH_UPDATE_SIZE]
            try:
                result = await self.admin_request(
                    "PATCH",
                    "/api/admin/v1/accounts/batch",
                    json={
                        "ids": [str(account_id) for account_id in batch],
                        "provider": "grok_build",
                        "enabled": enabled,
                    },
                )
                updated += int(result.get("updated") or 0)
            except IntegrationError as exc:
                if exc.status_code not in ACCOUNT_BATCH_FALLBACK_STATUSES:
                    raise
                logger.warning(
                    "native account batch update failed with HTTP %s; "
                    "falling back to %s single-account updates",
                    exc.status_code,
                    len(batch),
                )
                fallback = await self._set_accounts_enabled_individually(
                    batch,
                    enabled,
                )
                updated += fallback.updated
                failures.extend(fallback.failures)
        return AccountBatchUpdateResult(updated=updated, failures=tuple(failures))

    async def _set_accounts_enabled_individually(
        self,
        account_ids: list[int],
        enabled: bool,
    ) -> AccountBatchUpdateResult:
        semaphore = asyncio.Semaphore(ACCOUNT_BATCH_FALLBACK_CONCURRENCY)

        async def update(account_id: int) -> AccountUpdateFailure | None:
            async with semaphore:
                try:
                    await self.set_account_enabled(account_id, enabled)
                except IntegrationError as exc:
                    return AccountUpdateFailure(
                        account_id=account_id,
                        error=str(exc),
                    )
                return None

        results = await asyncio.gather(
            *(update(account_id) for account_id in account_ids)
        )
        failures = tuple(result for result in results if result is not None)
        return AccountBatchUpdateResult(
            updated=len(account_ids) - len(failures),
            failures=failures,
        )

    async def set_account_routing_settings(
        self,
        account_id: int,
        *,
        enabled: bool,
        priority: int,
        max_concurrent: int,
    ) -> dict[str, Any]:
        """Apply the diagnostic activation or its rollback in one upstream PATCH."""

        return await self.admin_request(
            "PATCH",
            f"/api/admin/v1/accounts/{account_id}",
            json={
                "enabled": enabled,
                "priority": priority,
                "maxConcurrent": max_concurrent,
            },
        )

    async def set_account_egress(self, account_id: int, target: dict[str, Any]) -> None:
        if target.get("kind") == "direct":
            await self.admin_request(
                "DELETE",
                "/api/admin/v1/egress-nodes/accounts",
                json={"provider": "grok_build", "ids": [str(account_id)]},
            )
            return
        node_id = int(target.get("id") or 0)
        if node_id <= 0:
            raise IntegrationError("代理目标缺少有效的出口节点 ID")
        await self.admin_request(
            "POST",
            f"/api/admin/v1/egress-nodes/{node_id}/accounts",
            json={"provider": "grok_build", "ids": [str(account_id)], "mode": "manual"},
        )

    async def restore_account_egress(
        self,
        account_id: int,
        original_node_id: int | None,
        original_mode: str,
    ) -> None:
        if original_node_id:
            await self.admin_request(
                "POST",
                f"/api/admin/v1/egress-nodes/{original_node_id}/accounts",
                json={
                    "provider": "grok_build",
                    "ids": [str(account_id)],
                    "mode": original_mode if original_mode in {"manual", "auto"} else "manual",
                },
            )
        else:
            await self.admin_request(
                "DELETE",
                "/api/admin/v1/egress-nodes/accounts",
                json={"provider": "grok_build", "ids": [str(account_id)]},
            )

    async def create_probe_route(
        self,
        *,
        account_id: int,
        upstream_model: str,
        allow_temporarily_unavailable: bool = False,
    ) -> tuple[str, str]:
        public_id = f"{self.settings.probe_route_prefix}-{account_id}-{uuid.uuid4().hex[:12]}"
        route = await self.admin_request(
            "POST",
            "/api/admin/v1/models",
            json={
                "publicId": public_id,
                "provider": "grok_build",
                "upstreamModel": upstream_model,
                "capability": "responses",
                "enabled": True,
                "accountIds": [str(account_id)],
            },
        )
        route_id = str(route.get("id") or "")
        if not route_id:
            raise IntegrationError("创建临时探针路由后响应缺少路由 ID")
        public_model = str(route.get("publicId") or public_id)
        if route.get("available") is False and not allow_temporarily_unavailable:
            try:
                await self.delete_probe_route(route_id)
            finally:
                supported = int(route.get("supportedAccounts") or 0)
                raise IntegrationError(
                    f"目标账号当前不可调度方案模型 {upstream_model}"
                    f"（可用绑定账号数 {supported}），请检查账号启用状态和模型能力同步"
                )
        return route_id, public_model

    async def delete_probe_route(self, route_id: str) -> None:
        if route_id:
            await self.admin_request("DELETE", f"/api/admin/v1/models/{route_id}")

    async def create_probe_client_key(self, route_id: str) -> tuple[str, str]:
        payload = await self.admin_request(
            "POST",
            "/api/admin/v1/client-keys",
            json={
                "name": f"{self.settings.probe_route_prefix}-{uuid.uuid4().hex[:12]}",
                "enabled": True,
                "maxConcurrent": 1,
                "allowedModelIds": [str(route_id)],
                "providerScope": ["grok_build"],
            },
        )
        key = payload.get("key", {})
        key_id = str(key.get("id") or "")
        secret = str(payload.get("secret") or "")
        if not key_id or not secret:
            raise IntegrationError("创建临时探针 Client Key 后响应缺少 ID 或 secret")
        return key_id, secret

    async def delete_probe_client_key(self, key_id: str) -> None:
        if key_id:
            await self.admin_request("DELETE", f"/api/admin/v1/client-keys/{key_id}")

    async def find_audit(self, request_id: str) -> dict[str, Any] | None:
        for _ in range(20):
            payload = await self.admin_request(
                "GET",
                "/api/admin/v1/request-audits",
                params={
                    "pagination": "cursor",
                    "search": request_id,
                    "period": "24h",
                    "pageSize": 20,
                },
            )
            for item in payload.get("items", []):
                if item.get("requestId") == request_id:
                    return item
            await asyncio.sleep(0.25)
        return None

    async def chat_probe(
        self,
        *,
        api_key: str,
        public_model: str,
        account_id: int,
        system_prompt: str,
        prompt: str,
        expected: str,
        max_output_tokens: int,
        temperature: float | None,
        extra_body: dict[str, Any],
    ) -> ChatProbeResult:
        request_id = f"gam_{uuid.uuid4().hex}"
        messages: list[dict[str, str]] = []
        if system_prompt.strip():
            messages.append({"role": "system", "content": system_prompt.strip()})
        messages.append({"role": "user", "content": prompt})
        body: dict[str, Any] = {
            **extra_body,
            "model": public_model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if max_output_tokens > 0:
            body["max_tokens"] = max_output_tokens
        if temperature is not None:
            body["temperature"] = temperature

        started = time.perf_counter()
        first_generated_at: float | None = None
        visible_parts: list[str] = []
        reasoning_parts: list[str] = []
        usage: dict[str, Any] = {}
        chunk_count = 0
        received_bytes = 0
        buffer = ""
        terminal = False
        status_code = 0

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-Request-ID": request_id,
            "X-Thread-ID": request_id,
        }
        try:
            async with self._session() as client:
                response = await client.post(
                    f"{self.settings.normalized_gateway_base_url}/v1/chat/completions",
                    headers=headers,
                    json=body,
                    stream=True,
                    timeout=300,
                )
                status_code = response.status_code
                if status_code < 200 or status_code >= 300:
                    error_body = await response.acontent()
                    raise _response_error(
                        context="/v1/chat/completions",
                        status_code=status_code,
                        body=error_body.decode("utf-8", "replace"),
                        retry_after=response.headers.get("Retry-After"),
                        request_id=request_id,
                    )
                async for chunk in response.aiter_content():
                    if not chunk:
                        continue
                    received_bytes += len(chunk)
                    if received_bytes > self.max_stream_bytes:
                        raise IntegrationError("探针流式响应超过 4 MiB")
                    buffer += chunk.decode("utf-8", "replace")
                    buffer = buffer.replace("\r\n", "\n")
                    events = buffer.split("\n\n")
                    buffer = events.pop()
                    for event in events:
                        data = "\n".join(
                            line[5:].lstrip() for line in event.splitlines() if line.startswith("data:")
                        )
                        if not data:
                            continue
                        if data == "[DONE]":
                            terminal = True
                            break
                        try:
                            payload = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        if payload.get("error"):
                            error_value = payload["error"]
                            raw_error = json.dumps(error_value, ensure_ascii=False)
                            code, message, error_type = _parse_error_payload(
                                json.dumps({"error": error_value}, ensure_ascii=False)
                            )
                            raise IntegrationError(
                                message or raw_error[:1000],
                                status_code=int(payload.get("status") or status_code),
                                error_code=code,
                                error_type=error_type,
                                request_id=request_id,
                                response_body=raw_error[:4000],
                            )
                        if isinstance(payload.get("usage"), dict):
                            usage = payload["usage"]
                        for choice in payload.get("choices", []):
                            delta = choice.get("delta") or {}
                            content = str(delta.get("content") or "")
                            reasoning = str(delta.get("reasoning") or delta.get("reasoning_content") or "")
                            if (content or reasoning) and first_generated_at is None:
                                first_generated_at = time.perf_counter()
                            if content:
                                visible_parts.append(content)
                                chunk_count += 1
                            if reasoning:
                                reasoning_parts.append(reasoning)
                    if terminal:
                        break
        except asyncio.CancelledError:
            raise
        except IntegrationError:
            raise
        except Exception as exc:
            raise IntegrationError(f"读取 /v1/chat/completions 流失败: {exc}") from exc

        completed = time.perf_counter()
        if not terminal:
            raise IntegrationError("流式响应未收到 [DONE]")
        response_text = "".join(visible_parts)
        duration_ms = max(1, round((completed - started) * 1000))
        first_token_ms = (
            max(0, round((first_generated_at - started) * 1000)) if first_generated_at is not None else 0
        )
        generation_ms = max(0, duration_ms - first_token_ms) if first_generated_at is not None else 0
        details = usage.get("completion_tokens_details") or {}
        output_tokens = int(usage.get("completion_tokens") or 0)
        reasoning_tokens = int(details.get("reasoning_tokens") or 0)
        visible_tokens = max(output_tokens - reasoning_tokens, 0)
        if visible_tokens == 0 and response_text:
            visible_tokens = max(1, (len(response_text) + 3) // 4)
        tps = output_tokens * 1000 / generation_ms if output_tokens > 0 and generation_ms > 0 else 0.0
        first_token_share = first_token_ms / duration_ms if duration_ms else 0.0

        audit = await self.find_audit(request_id)
        if audit is None:
            raise IntegrationError("请求审计未落库，未能核验实际账号和出口")
        verified_account_id = int(audit.get("accountId") or 0) or None
        verified_egress_node_id = int(audit.get("egressNodeId") or 0) or None
        if verified_account_id != account_id:
            raise IntegrationError(f"请求实际命中账号 {verified_account_id}，目标账号为 {account_id}")

        return ChatProbeResult(
            request_id=request_id,
            audit_id=int(audit.get("id") or 0) or None,
            verified_account_id=verified_account_id,
            verified_egress_node_id=verified_egress_node_id,
            status_code=status_code,
            response_text=response_text,
            response_sha256=hashlib.sha256(response_text.encode()).hexdigest(),
            output_tokens=output_tokens,
            reasoning_tokens=reasoning_tokens,
            visible_tokens=visible_tokens,
            chunk_count=chunk_count,
            first_token_ms=first_token_ms,
            duration_ms=duration_ms,
            generation_ms=generation_ms,
            first_token_share=first_token_share,
            tps=tps,
            expected_matched=expected in response_text if expected else True,
            usage=usage,
        )

    async def quality_probe(
        self,
        *,
        client_key_id: str,
        public_model: str,
        account_id: int,
        egress_node_id: int,
        prompt: str,
        expected: str,
        max_output_tokens: int,
    ) -> ChatProbeResult:
        """Run grok2api's forced-egress quality probe and record its audit."""

        if not client_key_id:
            raise IntegrationError("快速出口质量探针需要临时 Client Key ID")
        request_body: dict[str, Any] = {
            "clientKeyId": client_key_id,
            "model": public_model,
            "prompt": prompt,
            "expected": expected,
        }
        if max_output_tokens > 0:
            request_body["maxOutputTokens"] = max_output_tokens
        payload = await self.admin_request(
            "POST",
            f"/api/admin/v1/egress-nodes/{egress_node_id}/quality-test",
            json=request_body,
            timeout=300,
        )
        request_id = str(payload.get("requestId") or "")
        if not request_id:
            raise IntegrationError("出口质量探针响应缺少 requestId")
        audit = await self.find_audit(request_id)
        if audit is None:
            raise IntegrationError("出口质量探针审计未落库，未能核验实际账号和出口")
        verified_account_id = int(audit.get("accountId") or 0) or None
        verified_egress_node_id = int(audit.get("egressNodeId") or 0) or None
        if verified_account_id != account_id:
            raise IntegrationError(f"请求实际命中账号 {verified_account_id}，目标账号为 {account_id}")

        duration_ms = int(payload.get("durationMs") or 0)
        first_token_ms = int(payload.get("firstTokenMs") or 0)
        generation_ms = int(payload.get("generationMs") or max(duration_ms - first_token_ms, 0))
        output_tokens = int(payload.get("outputTokens") or 0)
        reasoning_tokens = int(payload.get("reasoningTokens") or 0)
        visible_tokens = int(payload.get("visibleTokens") or 0)
        usage = {
            "completion_tokens": output_tokens,
            "completion_tokens_details": {"reasoning_tokens": reasoning_tokens},
            "quality_test": True,
        }
        return ChatProbeResult(
            request_id=request_id,
            audit_id=int(audit.get("id") or 0) or None,
            verified_account_id=verified_account_id,
            verified_egress_node_id=verified_egress_node_id,
            status_code=int(payload.get("statusCode") or 0),
            response_text="",
            response_sha256=str(payload.get("responseSha256") or ""),
            output_tokens=output_tokens,
            reasoning_tokens=reasoning_tokens,
            visible_tokens=visible_tokens,
            chunk_count=int(payload.get("chunkCount") or 0),
            first_token_ms=first_token_ms,
            duration_ms=duration_ms,
            generation_ms=generation_ms,
            first_token_share=first_token_ms / duration_ms if duration_ms > 0 else 0.0,
            tps=float(payload.get("outputTokensPerSecond") or 0.0),
            expected_matched=bool(payload.get("expectedMatched")),
            usage=usage,
        )

    async def cleanup_stale_resources(self) -> dict[str, int]:
        routes_deleted = await self._cleanup_collection(
            path="/api/admin/v1/models",
            prefix=self.settings.probe_route_prefix,
            delete_path="/api/admin/v1/models/{id}",
            name_field="publicId",
        )
        keys_deleted = await self._cleanup_collection(
            path="/api/admin/v1/client-keys",
            prefix=self.settings.probe_route_prefix,
            delete_path="/api/admin/v1/client-keys/{id}",
            name_field="name",
        )
        return {"routes": routes_deleted, "clientKeys": keys_deleted}

    async def _cleanup_collection(
        self,
        *,
        path: str,
        prefix: str,
        delete_path: str,
        name_field: str,
    ) -> int:
        deleted = 0
        page = 1
        while True:
            payload = await self.admin_request(
                "GET", path, params={"search": prefix, "page": page, "pageSize": 200}
            )
            items = list(payload.get("items", []))
            for item in items:
                name = str(item.get(name_field) or "")
                item_id = str(item.get("id") or "")
                if name.startswith(f"{prefix}-") and item_id:
                    await self.admin_request("DELETE", delete_path.format(id=item_id))
                    deleted += 1
            if not items or page * 200 >= int(payload.get("total") or 0):
                break
            page += 1
        return deleted
