from __future__ import annotations

import json
from typing import Any

from app.core.clock import app_isoformat, utc_now

DISPOSITION_SOURCE_ALIASES = {
    "request_audit": "request_audit",
    "probe": "probe",
    "register": "register",
    "grok-register": "register",
    "manual": "manual",
    "sso": "sso",
    "sso_report": "sso",
    "quality_retry": "quality_retry",
}

DISPOSITION_SOURCE_LABELS = {
    "request_audit": "请求审计",
    "probe": "账号探针",
    "register": "注册联动",
    "manual": "手动操作",
    "sso": "SSO 检测",
    "quality_retry": "grok2api 降智停用",
}

DISPOSITION_ORIGIN_GROK2API = "grok2api"
DISPOSITION_ORIGIN_GROKIQ = "grokiq"
DISPOSITION_ORIGIN_LABELS = {
    DISPOSITION_ORIGIN_GROK2API: "grok2api",
    DISPOSITION_ORIGIN_GROKIQ: "GrokIQ",
}

DISPOSITION_ACTION_LABELS = {
    "isolate": "隔离停用",
    "quarantine": "临时停用",
    "disable": "停用",
}

DEFAULT_DISPOSITION_REASONS = {
    "request_audit": "请求审计发现异常后自动停用",
    "probe": "账号探针发现异常后自动隔离",
    "register": "注册联动确认降智后自动隔离",
    "sso": "SSO 检测发现风险后自动停用",
    "manual": "手动移入隔离区",
    "quality_retry": "grok2api 请求拦截二次命中降智后停用",
}


def normalize_disposition_source(source: str | None) -> str:
    raw = str(source or "").strip()
    if not raw:
        return "unknown"
    return DISPOSITION_SOURCE_ALIASES.get(raw, raw)


def disposition_source_label(source: str | None) -> str:
    normalized = normalize_disposition_source(source)
    return DISPOSITION_SOURCE_LABELS.get(normalized, normalized)


def disposition_origin(source: str | None) -> str:
    if normalize_disposition_source(source) == "quality_retry":
        return DISPOSITION_ORIGIN_GROK2API
    return DISPOSITION_ORIGIN_GROKIQ


def disposition_origin_label(source: str | None) -> str:
    origin = disposition_origin(source)
    return DISPOSITION_ORIGIN_LABELS.get(origin, origin)


def matches_disposition_source(source: str | None, requested: str | None) -> bool:
    needle = str(requested or "").strip().lower()
    if not needle or needle == "all":
        return True
    actual = normalize_disposition_source(source)
    origin = disposition_origin(actual)
    if needle in {DISPOSITION_ORIGIN_GROK2API, "quality_retry"}:
        return actual == "quality_retry" or origin == DISPOSITION_ORIGIN_GROK2API
    if needle == DISPOSITION_ORIGIN_GROKIQ:
        return origin == DISPOSITION_ORIGIN_GROKIQ
    return actual == needle


def disposition_action_label(action: str | None) -> str:
    normalized = str(action or "").strip() or "isolate"
    return DISPOSITION_ACTION_LABELS.get(normalized, normalized)


def infer_disposition_source(note: str | None) -> str:
    text = str(note or "")
    if "请求拦截二次命中" in text or "grok2api 降智停用" in text:
        return "quality_retry"
    if "请求审计" in text:
        return "request_audit"
    if "grok-register" in text or text.startswith("registration:"):
        return "register"
    if "SSO" in text:
        return "sso"
    if "风险周期" in text or "探针" in text:
        return "probe"
    return "manual"


def display_disposition_reason(note: str | None, source: str | None) -> str:
    text = str(note or "").strip()
    normalized = normalize_disposition_source(source)
    if text.startswith("registration:"):
        return DEFAULT_DISPOSITION_REASONS["register"]
    return text or DEFAULT_DISPOSITION_REASONS.get(normalized, "已隔离停用")


def unique_evidence(values: Any) -> list[str]:
    if not isinstance(values, (list, tuple)):
        return []
    return list(
        dict.fromkeys(
            str(item).strip() for item in values if str(item).strip()
        )
    )


def evidence_from(
    *,
    detail: dict[str, Any] | None = None,
    assessment: dict[str, Any] | None = None,
) -> list[str]:
    values: list[str] = []
    if isinstance(detail, dict):
        values.extend(
            unique_evidence(
                detail.get("riskReasons")
                if detail.get("riskReasons") is not None
                else detail.get("risk_reasons")
            )
        )
        bfs = detail.get("bfs")
        if bfs is not None and str(bfs).strip() != "":
            values.append(f"bot_risk/bfs={bfs}")
    if isinstance(assessment, dict):
        values.extend(unique_evidence(assessment.get("risk_reasons")))
        nested = assessment.get("disposition")
        if isinstance(nested, dict):
            values.extend(unique_evidence(nested.get("evidence")))
    return unique_evidence(values)


def build_disposition(
    *,
    source: str | None,
    action: str | None,
    reason: str | None,
    at: str | None = None,
    evidence: Any = None,
) -> dict[str, Any]:
    normalized_source = normalize_disposition_source(source)
    normalized_action = str(action or "").strip() or "isolate"
    return {
        "source": normalized_source,
        "sourceLabel": disposition_source_label(normalized_source),
        "origin": disposition_origin(normalized_source),
        "originLabel": disposition_origin_label(normalized_source),
        "action": normalized_action,
        "actionLabel": disposition_action_label(normalized_action),
        "reason": display_disposition_reason(reason, normalized_source),
        "at": at or app_isoformat(utc_now()),
        "evidence": unique_evidence(evidence),
    }


def coerce_disposition(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def public_disposition(value: Any) -> dict[str, Any] | None:
    value = coerce_disposition(value)
    if not value:
        return None
    source = str(value.get("source") or "").strip()
    reason = str(value.get("reason") or "").strip()
    if not source and not reason:
        return None
    return build_disposition(
        source=source or infer_disposition_source(reason),
        action=value.get("action"),
        reason=reason,
        at=str(value.get("at") or "") or None,
        evidence=value.get("evidence"),
    )
