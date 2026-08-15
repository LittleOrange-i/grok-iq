from __future__ import annotations

import os
from functools import lru_cache
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as package_version
from pathlib import Path

VERSION_FILE = Path(__file__).resolve().parents[2] / "VERSION"
PACKAGE_NAME = "grok-iq-backend"


def normalize_version(value: str) -> str:
    version = str(value or "").strip()
    if not version:
        return ""
    if version.lower() == "dev":
        return "dev"
    return version if version.lower().startswith("v") else f"v{version}"


def resolve_version(
    *,
    environment: dict[str, str] | None = None,
    version_file: Path = VERSION_FILE,
) -> str:
    env = os.environ if environment is None else environment
    injected = normalize_version(env.get("GROKIQ_VERSION", ""))
    if injected:
        return injected
    try:
        source_version = normalize_version(version_file.read_text(encoding="utf-8"))
    except OSError:
        source_version = ""
    if source_version:
        return source_version
    try:
        installed_version = normalize_version(package_version(PACKAGE_NAME))
    except PackageNotFoundError:
        installed_version = ""
    return installed_version or "dev"


@lru_cache
def current_version() -> str:
    return resolve_version()
