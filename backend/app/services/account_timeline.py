from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.core.clock import app_isoformat
from app.core.disposition import public_disposition
from app.persistence.database import Database
from app.persistence.models import AccountAssessment, ProbeSample, RequestAuditRecord

MAX_TIMELINE_LIMIT = 200
DEFAULT_TIMELINE_LIMIT = 50

CLASSIFICATION_LABELS = {
    "normal": "正常",
    "elevated": "降智信号",
    "buffered_soft": "缓冲降智信号",
    "buffered_hard": "强缓冲降智",
    "fast_risk": "强降智信号",
    "marker_miss": "预期缺失",
    "reasoning_zero": "思考输出为 0",
    "reasoning_zero_observe": "思考输出为 0（观察）",
    "error": "错误",
    "unmeasurable": "无法测量",
    "insufficient": "样本不足",
}

RISK_LEVEL_LABELS = {
    "normal": "正常",
    "watch": "观察",
    "high": "高风险",
}

DISPOSITION_TYPES = {"isolate", "restore"}


def build_account_timeline(
    database: Database,
    *,
    account_id: int,
    limit: int = DEFAULT_TIMELINE_LIMIT,
) -> dict[str, Any]:
    """Merge probe, audit, disposition, and note events for one account."""

    normalized_id = int(account_id)
    normalized_limit = _normalize_limit(limit)
    fetch_limit = normalized_limit + 1
    with database.session() as session:
        samples = session.scalars(
            select(ProbeSample)
            .where(ProbeSample.account_id == normalized_id)
            .order_by(ProbeSample.created_at.desc(), ProbeSample.id.desc())
            .limit(fetch_limit)
        ).all()
        audits = session.scalars(
            select(RequestAuditRecord)
            .where(RequestAuditRecord.account_id == normalized_id)
            .order_by(
                RequestAuditRecord.created_at.desc(),
                RequestAuditRecord.upstream_id.desc(),
            )
            .limit(fetch_limit)
        ).all()
        assessment = session.get(AccountAssessment, normalized_id)

    items = [
        *_sample_items(samples),
        *_audit_items(audits),
        *_disposition_items(assessment),
        *_note_items(assessment),
    ]
    items.sort(key=lambda item: (str(item.get("at") or ""), str(item.get("id") or "")), reverse=True)
    return {
        "accountId": normalized_id,
        "items": items[:normalized_limit],
        "limit": normalized_limit,
        "hasMore": len(items) > normalized_limit,
    }


def _normalize_limit(limit: int) -> int:
    try:
        value = int(limit)
    except (TypeError, ValueError):
        return DEFAULT_TIMELINE_LIMIT
    return min(max(value, 1), MAX_TIMELINE_LIMIT)


def _sample_items(samples: list[ProbeSample]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for sample in samples:
        at = app_isoformat(sample.created_at)
        if not at:
            continue
        classification = str(sample.classification or "").strip()
        label = CLASSIFICATION_LABELS.get(classification, classification or "未知")
        run_id = str(sample.run_id or "").strip()
        account_id = int(sample.account_id or 0)
        item = {
            "id": f"sample:{sample.id}",
            "type": "sample",
            "at": at,
            "title": f"探针样本 · {label}",
            "detail": " · ".join(_tps_part(sample.tps)),
            "href": "/runs" if run_id else None,
            "meta": {
                "sampleId": sample.id,
                "runId": run_id or None,
                "classification": classification,
                "tps": sample.tps,
            },
        }
        if run_id and account_id > 0:
            item["search"] = {"account": str(account_id)}
        items.append(item)
    return items


def _audit_items(records: list[RequestAuditRecord]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for record in records:
        at = app_isoformat(record.created_at)
        if not at:
            continue
        risk_level = str(record.risk_level or "").strip()
        risk_label = RISK_LEVEL_LABELS.get(risk_level, risk_level or "未知")
        request_id = str(record.request_id or "").strip()
        status_code = int(record.status_code or 0)
        detail_parts: list[str] = []
        if request_id:
            detail_parts.append(f"请求 {request_id}")
        if status_code:
            detail_parts.append(f"HTTP {status_code}")
        detail_parts.extend(_tps_part(record.tps))
        account_id = int(record.account_id or 0)
        item = {
            "id": f"audit:{record.upstream_id}",
            "type": "audit",
            "at": at,
            "title": f"请求审计 · {risk_label}",
            "detail": " · ".join(detail_parts),
            "href": "/request-audits/ledger",
            "meta": {
                "upstreamId": record.upstream_id,
                "requestId": request_id or None,
                "tps": record.tps,
                "statusCode": status_code,
                "riskLevel": risk_level,
            },
        }
        if account_id > 0:
            item["search"] = {"account": str(account_id)}
        items.append(item)
    return items


def _disposition_items(assessment: AccountAssessment | None) -> list[dict[str, Any]]:
    if assessment is None:
        return []
    raw = assessment.disposition if isinstance(assessment.disposition, dict) else {}
    at = str(raw.get("at") or "").strip()
    if not at:
        return []
    disposition = public_disposition(raw)
    if not disposition:
        return []
    action = str(disposition.get("action") or raw.get("action") or "").strip()
    if action not in DISPOSITION_TYPES:
        return []
    source_label = str(
        disposition.get("sourceLabel") or disposition.get("source") or ""
    ).strip()
    reason = str(disposition.get("reason") or "").strip()
    if action == "isolate":
        title = str(disposition.get("actionLabel") or "隔离停用")
        href = "/quarantine"
    else:
        title = "恢复账号"
        href = None
    detail_parts = [part for part in (source_label, reason) if part]
    return [
        {
            "id": f"{action}:{assessment.account_id}",
            "type": action,
            "at": at,
            "title": title,
            "detail": " · ".join(detail_parts),
            "href": href,
            "meta": {
                "source": disposition.get("source"),
                "action": action,
                "reason": reason,
            },
        }
    ]


def _note_items(assessment: AccountAssessment | None) -> list[dict[str, Any]]:
    if assessment is None:
        return []
    raw_notes = assessment.operator_notes or []
    notes = raw_notes if isinstance(raw_notes, list) else []
    items: list[dict[str, Any]] = []
    for note in notes:
        if not isinstance(note, dict):
            continue
        note_id = str(note.get("id") or "").strip()
        content = str(note.get("content") or "").strip()
        at = str(note.get("created_at") or "").strip()
        if not note_id or not content or not at:
            continue
        items.append(
            {
                "id": f"note:{note_id}",
                "type": "note",
                "at": at,
                "title": "运营备注",
                "detail": content,
                "href": None,
                "meta": {"noteId": note_id},
            }
        )
    return items


def _tps_part(value: Any) -> list[str]:
    formatted = _format_tps(value)
    return [f"TPS {formatted}"] if formatted else []


def _format_tps(value: Any) -> str:
    if value is None or value == "":
        return ""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    if number != number:
        return ""
    if number.is_integer():
        return str(int(number))
    return f"{number:.2f}".rstrip("0").rstrip(".")
