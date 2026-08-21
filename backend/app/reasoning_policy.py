from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from typing import Any

REASONING_POLICY_MODES = frozenset(
    {"required", "observe", "optional", "unsupported"}
)
REASONING_MEDIA_INPUT_MODES = frozenset({"inherit", "observe", "ignore"})
REASONING_OPERATIONS = frozenset({"*", "chat", "responses", "messages"})


@dataclass(slots=True, frozen=True)
class ReasoningModelPolicy:
    """Reasoning expectation for one upstream-model/request-operation pair."""

    model: str
    operation: str
    mode: str
    minimum_output_tokens: int = 32
    min_count: int = 2
    media_input_mode: str = "inherit"

    def public_dict(self) -> dict[str, Any]:
        value = asdict(self)
        return {
            "model": value["model"],
            "operation": value["operation"],
            "mode": value["mode"],
            "minimumOutputTokens": value["minimum_output_tokens"],
            "minCount": value["min_count"],
            "mediaInputMode": value["media_input_mode"],
        }


DEFAULT_REASONING_MODEL_POLICIES: tuple[ReasoningModelPolicy, ...] = (
    ReasoningModelPolicy("Build/grok-4.5", "chat", "required"),
    ReasoningModelPolicy("Build/grok-4.5", "responses", "required"),
    ReasoningModelPolicy("Build/grok-4.6", "chat", "required"),
    ReasoningModelPolicy("Build/grok-4.6", "responses", "required"),
    ReasoningModelPolicy(
        "Build/grok-4.6",
        "messages",
        "required",
        media_input_mode="observe",
    ),
    ReasoningModelPolicy("Build/grok-composer-2.5-fast", "*", "observe"),
    ReasoningModelPolicy("*", "*", "observe"),
)


def default_reasoning_model_policies() -> list[dict[str, Any]]:
    return [policy.public_dict() for policy in DEFAULT_REASONING_MODEL_POLICIES]


def _value(raw: Mapping[str, Any], snake: str, camel: str, default: Any) -> Any:
    if snake in raw:
        return raw[snake]
    if camel in raw:
        return raw[camel]
    return default


def canonical_reasoning_model(value: str) -> str:
    """Return the stable capability key used by audits and probe profiles.

    Request audits expose the actual upstream route as ``Build/grok-*`` while
    probe profiles store the selectable upstream model as ``grok-*``.  They
    describe the same model capability and must resolve to one policy.  Other
    provider prefixes remain intact so an unrelated model with the same suffix
    cannot inherit a Build policy accidentally.
    """

    normalized = str(value or "").strip().casefold()
    return normalized.removeprefix("build/") if normalized != "*" else normalized


def normalize_reasoning_model_policies(
    values: Iterable[Mapping[str, Any]] | None,
) -> tuple[ReasoningModelPolicy, ...]:
    source = list(values or default_reasoning_model_policies())
    result: list[ReasoningModelPolicy] = []
    seen: set[tuple[str, str]] = set()
    for raw in source:
        model = str(raw.get("model") or "").strip()
        operation = str(raw.get("operation") or "*").strip().lower()
        mode = str(raw.get("mode") or "observe").strip().lower()
        media_input_mode = str(
            _value(raw, "media_input_mode", "mediaInputMode", "inherit")
        ).strip().lower()
        if not model:
            raise ValueError("思考模型策略缺少上游模型")
        if len(model) > 255:
            raise ValueError("思考模型策略的上游模型不能超过 255 个字符")
        if operation not in REASONING_OPERATIONS:
            raise ValueError(f"思考模型策略请求类型无效: {operation}")
        if mode not in REASONING_POLICY_MODES:
            raise ValueError(f"思考模型策略模式无效: {mode}")
        if media_input_mode not in REASONING_MEDIA_INPUT_MODES:
            raise ValueError(f"思考模型策略 Media Input 模式无效: {media_input_mode}")
        try:
            minimum_output_tokens = int(
                _value(raw, "minimum_output_tokens", "minimumOutputTokens", 32)
            )
            min_count = int(_value(raw, "min_count", "minCount", 2))
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("思考模型策略数值无效") from exc
        if minimum_output_tokens < 1 or minimum_output_tokens > 4096:
            raise ValueError("思考模型策略最低输出 Token 必须在 1-4096 之间")
        if min_count < 2 or min_count > 100:
            raise ValueError("思考模型策略连续命中次数必须在 2-100 之间")
        key = (canonical_reasoning_model(model), operation)
        if key in seen:
            raise ValueError(f"思考模型策略重复: {model} / {operation}")
        seen.add(key)
        result.append(
            ReasoningModelPolicy(
                model=model,
                operation=operation,
                mode=mode,
                minimum_output_tokens=minimum_output_tokens,
                min_count=min_count,
                media_input_mode=media_input_mode,
            )
        )
    if ("*", "*") not in seen:
        result.append(ReasoningModelPolicy("*", "*", "observe"))
    return tuple(result)


def resolve_reasoning_model_policy(
    policies: Iterable[ReasoningModelPolicy],
    *,
    model_upstream_model: str = "",
    model_public_id: str = "",
    operation: str = "",
    media_input_images: int = 0,
) -> ReasoningModelPolicy:
    model = canonical_reasoning_model(model_upstream_model or model_public_id)
    normalized_operation = str(operation or "").strip().lower() or "*"
    candidates: list[tuple[int, int, ReasoningModelPolicy]] = []
    for index, policy in enumerate(policies):
        policy_model = canonical_reasoning_model(policy.model)
        if policy_model not in {"*", model}:
            continue
        if policy.operation not in {"*", normalized_operation}:
            continue
        score = (2 if policy_model != "*" else 0) + (
            1 if policy.operation != "*" else 0
        )
        candidates.append((score, -index, policy))
    policy = (
        max(candidates, key=lambda value: (value[0], value[1]))[2]
        if candidates
        else ReasoningModelPolicy("*", "*", "observe")
    )
    if media_input_images <= 0 or policy.media_input_mode == "inherit":
        return policy
    if policy.media_input_mode == "ignore":
        return ReasoningModelPolicy(
            model=policy.model,
            operation=policy.operation,
            mode="unsupported",
            minimum_output_tokens=policy.minimum_output_tokens,
            min_count=policy.min_count,
            media_input_mode=policy.media_input_mode,
        )
    return ReasoningModelPolicy(
        model=policy.model,
        operation=policy.operation,
        mode="observe",
        minimum_output_tokens=policy.minimum_output_tokens,
        min_count=policy.min_count,
        media_input_mode=policy.media_input_mode,
    )
