from __future__ import annotations

import logging
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from time import time

from app.core.clock import configure_process_timezone

PROBE_LOGGER_NAME = "app.services.probe_manager"
PROBE_LOG_RETENTION_DAYS = 2
PROBE_LOG_FILE_NAME = "probe-workers.log"
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"
PROBE_LOG_FORMAT = "%(asctime)s %(levelname)s %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S%z"


def configure_logging(database_path: Path) -> Path:
    """Configure console output and a daily rotating probe execution log."""

    configure_process_timezone()
    logging.basicConfig(
        level=logging.INFO,
        format=LOG_FORMAT,
        datefmt=LOG_DATE_FORMAT,
    )
    log_path = database_path.resolve().parent / "logs" / PROBE_LOG_FILE_NAME
    log_path.parent.mkdir(parents=True, exist_ok=True)

    probe_logger = logging.getLogger(PROBE_LOGGER_NAME)
    resolved = str(log_path)
    handlers = [
        handler
        for handler in probe_logger.handlers
        if (
            isinstance(handler, TimedRotatingFileHandler)
            and str(getattr(handler, "baseFilename", "")) == resolved
        )
    ]
    formatter = logging.Formatter(PROBE_LOG_FORMAT, datefmt=LOG_DATE_FORMAT)
    if not handlers:
        handler = TimedRotatingFileHandler(
            log_path,
            when="midnight",
            interval=1,
            backupCount=PROBE_LOG_RETENTION_DAYS,
            encoding="utf-8",
            utc=False,
        )
        handler.setFormatter(formatter)
        probe_logger.addHandler(handler)
        handlers.append(handler)

    # Application factories and reloaders can import this module more than
    # once in the same process. Keep an existing file handler aligned with the
    # current Shanghai-local formatter and midnight rollover configuration.
    for handler in handlers:
        handler.utc = False
        handler.setFormatter(formatter)
        handler.rolloverAt = handler.computeRollover(int(time()))
    probe_logger.setLevel(logging.INFO)
    return log_path


def recent_log_lines(log_path: Path, limit: int) -> list[str]:
    """Return the newest log lines across the active and rotated files."""

    remaining = max(1, limit)
    newest_first = sorted(
        (
            path
            for path in log_path.parent.glob(f"{log_path.name}*")
            if path.is_file()
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    chunks: list[list[str]] = []
    for path in newest_first:
        lines = _tail_file(path, remaining)
        if lines:
            chunks.append(lines)
            remaining -= len(lines)
        if remaining <= 0:
            break

    result: list[str] = []
    for chunk in reversed(chunks):
        result.extend(chunk)
    return result[-limit:]


def probe_log_size(log_path: Path) -> int:
    return sum(
        path.stat().st_size
        for path in log_path.parent.glob(f"{log_path.name}*")
        if path.is_file()
    )


def _tail_file(path: Path, limit: int) -> list[str]:
    if limit <= 0:
        return []
    block_size = 8192
    with path.open("rb") as stream:
        stream.seek(0, 2)
        position = stream.tell()
        data = b""
        while position > 0 and data.count(b"\n") <= limit:
            read_size = min(block_size, position)
            position -= read_size
            stream.seek(position)
            data = stream.read(read_size) + data
    return data.decode("utf-8", "replace").splitlines()[-limit:]
