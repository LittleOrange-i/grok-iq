from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.services.chat_service import ChatService
from app.web.schemas import ChatProviderCreateInput, ChatProviderUpdateInput

from ._shared import disable_client_cache


def build_chat_router(service: ChatService) -> APIRouter:
    router = APIRouter()

    @router.get("/chat/providers")
    def chat_providers() -> list[dict[str, Any]]:
        return service.list_providers()

    @router.post("/chat/providers", status_code=201)
    def create_chat_provider(
        payload: ChatProviderCreateInput,
    ) -> dict[str, Any]:
        return service.create_provider(payload.model_dump())

    @router.put("/chat/providers/{provider_id}")
    def update_chat_provider(
        provider_id: str,
        payload: ChatProviderUpdateInput,
    ) -> dict[str, Any]:
        return service.update_provider(provider_id, payload.changes())

    @router.delete("/chat/providers/{provider_id}", status_code=204)
    def delete_chat_provider(provider_id: str) -> Response:
        service.delete_provider(provider_id)
        return Response(status_code=204)

    @router.get("/chat/providers/{provider_id}/api-key")
    def reveal_chat_provider_api_key(
        provider_id: str,
        response: Response,
    ) -> dict[str, str]:
        disable_client_cache(response)
        return {"value": service.reveal_provider_api_key(provider_id)}

    @router.post("/chat/providers/{provider_id}/sync-models")
    async def sync_chat_provider_models(provider_id: str) -> dict[str, Any]:
        return await service.sync_models(provider_id)

    @router.get("/chat/models")
    async def chat_models(
        provider_id: str = Query(default="", alias="providerId"),
    ) -> list[dict[str, Any]]:
        return await service.list_models(provider_id)

    @router.post("/responses")
    @router.post("/chat/completions")
    async def create_response(request: Request) -> StreamingResponse:
        stream = await service.open_completion(
            provider_id=request.headers.get("x-chat-provider-id", ""),
            body=await request.body(),
            request_headers=request.headers,
        )

        async def iterator() -> AsyncIterator[bytes]:
            buffer = bytearray()
            try:
                async for chunk in stream.response.aiter_content():
                    if not chunk:
                        continue
                    buffer.extend(chunk)
                    while True:
                        boundary = _sse_event_boundary(buffer)
                        if boundary is None:
                            break
                        event = bytes(buffer[:boundary])
                        del buffer[:boundary]
                        yield event
                        # Let h11 flush this SSE event before reading more
                        # upstream data, so the browser sees tokens live.
                        await asyncio.sleep(0)
                        if _stream_chunk_is_terminal(event):
                            return
                if buffer:
                    yield bytes(buffer)
            finally:
                await stream.session.close()

        return StreamingResponse(
            iterator(),
            media_type=stream.response.headers.get(
                "content-type", "text/event-stream"
            ),
            headers={
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return router


def _sse_event_boundary(buffer: bytearray) -> int | None:
    boundaries = [
        index + len(separator)
        for separator in (b"\n\n", b"\r\n\r\n", b"\r\r")
        if (index := buffer.find(separator)) >= 0
    ]
    return min(boundaries, default=None)


def _stream_chunk_is_terminal(chunk: bytes) -> bool:
    """Stop proxying once an upstream SSE stream has declared completion."""
    text = chunk.decode("utf-8", "ignore")
    return (
        "data: [DONE]" in text
        or '"type":"response.completed"' in text
        or '"type": "response.completed"' in text
        or '"type":"response.failed"' in text
        or '"type": "response.failed"' in text
        or '"type":"response.incomplete"' in text
        or '"type": "response.incomplete"' in text
        or '"type":"response.done"' in text
        or '"type": "response.done"' in text
    )
