from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from typing import Any


@dataclass(slots=True)
class ChatProbeStreamState:
    started: float
    first_generated_at: float | None = None
    visible_parts: list[str] | None = None
    reasoning_parts: list[str] | None = None
    usage: dict[str, Any] | None = None
    chunk_count: int = 0
    received_bytes: int = 0
    buffer: str = ""
    terminal: bool = False
    status_code: int = 0

    def __post_init__(self) -> None:
        self.visible_parts = []
        self.reasoning_parts = []
        self.usage = {}


class ChatProbeRunner:
    """Runs and verifies one streamed chat probe."""

    def __init__(
        self,
        *,
        base_url: Callable[[], str],
        session_factory: Callable[[], Any],
        find_audit: Callable[[str], Awaitable[dict[str, Any] | None]],
        max_stream_bytes: Callable[[], int],
        result_type: type,
        error_type: type[RuntimeError],
        response_error: Callable[..., RuntimeError],
        parse_error_payload: Callable[[str], tuple[str, str, str]],
    ):
        self.base_url = base_url
        self.session_factory = session_factory
        self.find_audit = find_audit
        self.max_stream_bytes = max_stream_bytes
        self.result_type = result_type
        self.error_type = error_type
        self.response_error = response_error
        self.parse_error_payload = parse_error_payload

    async def run(
        self,
        *,
        request_id: str,
        api_key: str,
        public_model: str,
        account_id: int,
        system_prompt: str,
        prompt: str,
        expected: str,
        max_output_tokens: int,
        temperature: float | None,
        extra_body: dict[str, Any],
    ) -> Any:
        body = self._request_body(
            public_model=public_model,
            system_prompt=system_prompt,
            prompt=prompt,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
            extra_body=extra_body,
        )
        state = ChatProbeStreamState(started=time.perf_counter())
        await self._read_stream(
            request_id=request_id,
            api_key=api_key,
            body=body,
            state=state,
        )
        result = self._build_result(request_id, expected, state)
        return await self._verify_audit(request_id, account_id, result)

    @staticmethod
    def _request_body(
        *,
        public_model: str,
        system_prompt: str,
        prompt: str,
        max_output_tokens: int,
        temperature: float | None,
        extra_body: dict[str, Any],
    ) -> dict[str, Any]:
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
        return body

    async def _read_stream(
        self,
        *,
        request_id: str,
        api_key: str,
        body: dict[str, Any],
        state: ChatProbeStreamState,
    ) -> None:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-Request-ID": request_id,
            "X-Thread-ID": request_id,
        }
        try:
            async with self.session_factory() as client:
                response = await client.post(
                    f"{self.base_url()}/v1/chat/completions",
                    headers=headers,
                    json=body,
                    stream=True,
                    timeout=300,
                )
                state.status_code = response.status_code
                if state.status_code < 200 or state.status_code >= 300:
                    error_body = await response.acontent()
                    raise self.response_error(
                        context="/v1/chat/completions",
                        status_code=state.status_code,
                        body=error_body.decode("utf-8", "replace"),
                        retry_after=response.headers.get("Retry-After"),
                        request_id=request_id,
                    )
                async for chunk in response.aiter_content():
                    self._consume_chunk(chunk, state, request_id)
                    if state.terminal:
                        break
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if isinstance(exc, self.error_type):
                raise
            raise self.error_type(f"读取 /v1/chat/completions 流失败: {exc}") from exc
        if not state.terminal:
            raise self.error_type("流式响应未收到 [DONE]")

    def _consume_chunk(
        self, chunk: bytes, state: ChatProbeStreamState, request_id: str
    ) -> None:
        if not chunk:
            return
        state.received_bytes += len(chunk)
        if state.received_bytes > self.max_stream_bytes():
            raise self.error_type("探针流式响应超过 4 MiB")
        state.buffer += chunk.decode("utf-8", "replace")
        state.buffer = state.buffer.replace("\r\n", "\n")
        events = state.buffer.split("\n\n")
        state.buffer = events.pop()
        for event in events:
            self._consume_event(event, state, request_id)
            if state.terminal:
                break

    def _consume_event(
        self, event: str, state: ChatProbeStreamState, request_id: str
    ) -> None:
        data = "\n".join(
            line[5:].lstrip() for line in event.splitlines() if line.startswith("data:")
        )
        if not data:
            return
        if data == "[DONE]":
            state.terminal = True
            return
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            return
        self._raise_payload_error(payload, state.status_code, request_id)
        if isinstance(payload.get("usage"), dict):
            state.usage = payload["usage"]
        for choice in payload.get("choices", []):
            delta = choice.get("delta") or {}
            content = str(delta.get("content") or "")
            reasoning = str(delta.get("reasoning") or delta.get("reasoning_content") or "")
            if (content or reasoning) and state.first_generated_at is None:
                state.first_generated_at = time.perf_counter()
            if content:
                state.visible_parts.append(content)
                state.chunk_count += 1
            if reasoning:
                state.reasoning_parts.append(reasoning)

    def _raise_payload_error(
        self, payload: dict[str, Any], status_code: int, request_id: str
    ) -> None:
        if not payload.get("error"):
            return
        error_value = payload["error"]
        raw_error = json.dumps(error_value, ensure_ascii=False)
        code, message, error_name = self.parse_error_payload(
            json.dumps({"error": error_value}, ensure_ascii=False)
        )
        raise self.error_type(
            message or raw_error[:1000],
            status_code=int(payload.get("status") or status_code),
            error_code=code,
            error_type=error_name,
            request_id=request_id,
            response_body=raw_error[:4000],
        )

    def _build_result(
        self, request_id: str, expected: str, state: ChatProbeStreamState
    ) -> Any:
        completed = time.perf_counter()
        response_text = "".join(state.visible_parts)
        duration_ms = max(1, round((completed - state.started) * 1000))
        first_token_ms = (
            max(0, round((state.first_generated_at - state.started) * 1000))
            if state.first_generated_at is not None
            else 0
        )
        generation_ms = max(0, duration_ms - first_token_ms) if state.first_generated_at is not None else 0
        usage = state.usage or {}
        details = usage.get("completion_tokens_details") or {}
        output_tokens = int(usage.get("completion_tokens") or 0)
        reasoning_tokens = int(details.get("reasoning_tokens") or 0)
        reasoning_tokens_reported = "reasoning_tokens" in details
        visible_tokens = max(output_tokens - reasoning_tokens, 0)
        if visible_tokens == 0 and response_text:
            visible_tokens = max(1, (len(response_text) + 3) // 4)
        tps = output_tokens * 1000 / generation_ms if output_tokens > 0 and generation_ms > 0 else 0.0
        return self.result_type(
            request_id=request_id,
            audit_id=None,
            verified_account_id=None,
            verified_egress_node_id=None,
            status_code=state.status_code,
            response_text=response_text,
            response_sha256=hashlib.sha256(response_text.encode()).hexdigest(),
            output_tokens=output_tokens,
            reasoning_tokens=reasoning_tokens,
            reasoning_tokens_reported=reasoning_tokens_reported,
            visible_tokens=visible_tokens,
            chunk_count=state.chunk_count,
            first_token_ms=first_token_ms,
            duration_ms=duration_ms,
            generation_ms=generation_ms,
            first_token_share=first_token_ms / duration_ms if duration_ms else 0.0,
            tps=tps,
            expected_matched=expected in response_text if expected else True,
            usage=usage,
        )

    async def _verify_audit(self, request_id: str, account_id: int, result: Any) -> Any:
        audit = await self.find_audit(request_id)
        if audit is None:
            error = self.error_type(
                "请求审计未落库，未能核验实际账号和出口",
                request_id=request_id,
            )
            error.probe_result = result
            raise error
        # grok2api is authoritative for server-side token timing.  The local
        # stream clock can observe a buffered reasoning block much later than
        # the upstream first-token marker, which otherwise produces an
        # artificially tiny generation window and an inflated TPS value.
        result = self._apply_audit_metrics(result, audit)
        verified_account_id = int(audit.get("accountId") or 0) or None
        verified_egress_node_id = int(audit.get("egressNodeId") or 0) or None
        result = replace(
            result,
            audit_id=int(audit.get("id") or 0) or None,
            verified_account_id=verified_account_id,
            verified_egress_node_id=verified_egress_node_id,
        )
        if verified_account_id != account_id:
            error = self.error_type(
                f"请求实际命中账号 {verified_account_id}，目标账号为 {account_id}",
                request_id=request_id,
            )
            error.audit_id = result.audit_id
            error.verified_account_id = verified_account_id
            error.verified_egress_node_id = verified_egress_node_id
            error.probe_result = result
            raise error
        return result

    @staticmethod
    def _apply_audit_metrics(result: Any, audit: dict[str, Any]) -> Any:
        def integer(key: str, fallback: int) -> int:
            try:
                return int(audit.get(key)) if audit.get(key) is not None else fallback
            except (TypeError, ValueError, OverflowError):
                return fallback

        def number(key: str, fallback: float) -> float:
            try:
                value = float(audit.get(key)) if audit.get(key) is not None else fallback
            except (TypeError, ValueError, OverflowError):
                return fallback
            return value if value == value and abs(value) != float("inf") else fallback

        output_tokens = integer("outputTokens", result.output_tokens)
        reasoning_tokens = integer("reasoningTokens", result.reasoning_tokens)
        first_token_ms = max(0, integer("firstTokenMs", result.first_token_ms))
        duration_ms = max(0, integer("durationMs", result.duration_ms))
        generation_ms = max(
            0,
            integer(
                "generationMs",
                max(0, duration_ms - first_token_ms),
            ),
        )
        tps = number("outputTokensPerSecond", result.tps)
        if "outputTokensPerSecond" not in audit and output_tokens > 0 and generation_ms > 0:
            tps = output_tokens * 1000.0 / generation_ms
        status_code = integer("statusCode", result.status_code)
        visible_tokens = max(output_tokens - reasoning_tokens, 0)
        return replace(
            result,
            status_code=status_code,
            output_tokens=output_tokens,
            reasoning_tokens=reasoning_tokens,
            visible_tokens=visible_tokens,
            first_token_ms=first_token_ms,
            duration_ms=duration_ms,
            generation_ms=generation_ms,
            first_token_share=(
                first_token_ms / duration_ms if duration_ms > 0 else 0.0
            ),
            tps=tps,
        )
