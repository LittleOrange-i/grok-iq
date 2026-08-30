from app.core.disposition import (
    build_disposition,
    evidence_from,
    infer_disposition_source,
    matches_disposition_source,
    public_disposition,
)


def test_infer_disposition_source_from_known_notes():
    assert infer_disposition_source("请求审计高风险已达处置阈值后自动停用") == "request_audit"
    assert infer_disposition_source("风险周期达到自动隔离区阈值") == "probe"
    assert infer_disposition_source("grok-register 确认降智：bot_risk/bfs=2") == "register"
    assert infer_disposition_source("SSO 检测发现 bot 标记后立即自动停用") == "sso"
    assert infer_disposition_source("grok2api 请求拦截二次命中降智后停用") == "quality_retry"
    assert infer_disposition_source("manual isolate") == "manual"


def test_build_disposition_normalizes_aliases_and_labels():
    value = build_disposition(
        source="grok-register",
        action="isolate",
        reason="grok-register 确认降智：bot_risk/bfs=2",
        evidence=["bot_risk/bfs=2"],
    )
    assert value["source"] == "register"
    assert value["sourceLabel"] == "注册联动"
    assert value["origin"] == "grokiq"
    assert value["originLabel"] == "GrokIQ"
    assert value["actionLabel"] == "隔离停用"
    assert value["evidence"] == ["bot_risk/bfs=2"]


def test_evidence_from_merges_detail_and_assessment():
    values = evidence_from(
        detail={"riskReasons": ["高速 TPS 3 次"], "bfs": 2},
        assessment={"risk_reasons": ["硬信号 1 次"], "disposition": {"evidence": ["高速 TPS 3 次"]}},
    )
    assert values == ["高速 TPS 3 次", "bot_risk/bfs=2", "硬信号 1 次"]


def test_public_disposition_ignores_empty_payloads():
    assert public_disposition({}) is None
    assert public_disposition(None) is None
    value = public_disposition(
        {
            "source": "request_audit",
            "reason": "请求审计高风险已达处置阈值后自动停用",
        }
    )
    assert value is not None
    assert value["sourceLabel"] == "请求审计"
    assert value["action"] == "isolate"


def test_quality_retry_disposition_uses_grok2api_origin():
    value = build_disposition(
        source="quality_retry",
        action="isolate",
        reason="",
    )
    assert value["source"] == "quality_retry"
    assert value["sourceLabel"] == "grok2api 降智停用"
    assert value["origin"] == "grok2api"
    assert value["originLabel"] == "grok2api"
    assert value["reason"] == "grok2api 请求拦截二次命中降智后停用"


def test_matches_disposition_source_groups_origin():
    assert matches_disposition_source("quality_retry", "all") is True
    assert matches_disposition_source("quality_retry", "grok2api") is True
    assert matches_disposition_source("quality_retry", "quality_retry") is True
    assert matches_disposition_source("quality_retry", "grokiq") is False
    assert matches_disposition_source("probe", "grokiq") is True
    assert matches_disposition_source("probe", "probe") is True
    assert matches_disposition_source("probe", "grok2api") is False
    assert matches_disposition_source("request_audit", "request_audit") is True
