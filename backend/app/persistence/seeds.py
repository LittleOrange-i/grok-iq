from __future__ import annotations

import json
from importlib.resources import files
from typing import Any


def _load_default_profiles() -> list[dict[str, Any]]:
    resource = files(__package__).joinpath("default_profiles.json")
    payload = json.loads(resource.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError("default_profiles.json must contain a JSON array")
    return payload


# Keep the full reference outputs outside Python source. The JSON resource is
# packaged with the backend so fresh local and Docker installations receive the
# same built-in probe catalog.
DEFAULT_PROFILES = _load_default_profiles()
DEFAULT_PROFILE_IDS = frozenset(str(profile["id"]) for profile in DEFAULT_PROFILES)
