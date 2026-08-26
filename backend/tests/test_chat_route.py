from __future__ import annotations

from app.web.routes.chat import _sse_event_boundary, _stream_chunk_is_terminal


def test_stream_chunk_terminal_markers() -> None:
    assert _stream_chunk_is_terminal(b'data: {"type":"response.completed"}\n\n')
    assert _stream_chunk_is_terminal(b'data: {"type": "response.failed"}\n\n')
    assert _stream_chunk_is_terminal(b"data: [DONE]\n\n")
    assert not _stream_chunk_is_terminal(b'data: {"type":"response.output_text.delta"}\n\n')


def test_sse_event_boundary_splits_complete_events() -> None:
    buffer = bytearray(b'data: {"type":"response.output_text.delta","delta":"a"}\n\ndata: {')
    boundary = _sse_event_boundary(buffer)
    assert boundary == len(b'data: {"type":"response.output_text.delta","delta":"a"}\n\n')
    assert _sse_event_boundary(bytearray(b"data: partial")) is None
