"""The two runtime agents: end-user intake and agent-assist copilot."""

from __future__ import annotations

import json
from html import escape

from anthropic.types import MessageParam
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.catalog import TEMPLATES, MacroId, SwarmGroup, TemplateId
from app.ai.llm import StructuredLLM
from app.ai.prompts import COPILOT_SYSTEM, INTAKE_SYSTEM
from app.models import KBArticle, SiemAlert, Ticket, VaultSecret
from app.services import itam, kb, saas
from app.services.tickets import get_ticket

# ------------------------------------------------------------------ output schemas


class IntakeResult(BaseModel):
    reply_to_user: str
    detected_language: str = Field(description="BCP-47 code, e.g. 'es', 'pt-BR'")
    urgency_score: int = Field(description="1 (low) to 5 (critical)")
    sentiment: str = Field(description="one of: positive, neutral, anxious, frustrated, angry")
    selected_template_id: TemplateId
    title_for_agent: str
    english_summary_for_agent: str
    required_approvals: list[str]
    recommended_swarm_group: SwarmGroup
    self_service_kb_ids: list[str]
    clarifying_question: str | None
    ready_to_submit: bool


class Recommendation(BaseModel):
    action: str
    rationale: str
    kb_citations: list[str]
    evidence: list[str]


class MacroSuggestion(BaseModel):
    macro_id: MacroId
    reason: str
    kb_citations: list[str]


class JitSuggestion(BaseModel):
    secret_id: int
    reason: str


class CopilotResult(BaseModel):
    ticket_summary: str
    recommendations: list[Recommendation]
    macros: list[MacroSuggestion]
    jit_elevation: JitSuggestion | None
    draft_reply: str
    draft_reply_english: str | None
    knowledge_gaps: list[str]


class CopilotResponse(CopilotResult):
    """CopilotResult after server-side grounding checks."""

    rejected_ungrounded: list[str] = Field(default_factory=list)


# ------------------------------------------------------------------ context builders


def _kb_block(articles: list[KBArticle]) -> str:
    if not articles:
        return "<knowledge_base>No matching articles.</knowledge_base>"
    parts = [
        f'<article id="{a.key}" version="{a.current_version}" title="{escape(a.title)}">\n'
        f"{escape(kb.current_body(a))}\n</article>"
        for a in articles
    ]
    return "<knowledge_base>\n" + "\n".join(parts) + "\n</knowledge_base>"


async def _cmdb_context(session: AsyncSession, email: str) -> str:
    assets = await itam.assets_for_user(session, email)
    seats = await saas.seats_for_user(session, email)
    data = {
        "devices": [
            {"tag": a.tag, "name": a.name, "model": a.model, "os": a.os_version, "mdm": a.mdm_status,
             "state": a.lifecycle_state}
            for a in assets
        ],
        "saas_apps": [{"app": app.name, "domain": app.domain} for _, app in seats],
    }
    return f"<cmdb_context>{escape(json.dumps(data))}</cmdb_context>"


# ------------------------------------------------------------------ intake agent


async def run_intake(
    session: AsyncSession, llm: StructuredLLM, requester_email: str, message: str,
    history: list[MessageParam] | None = None,
) -> IntakeResult:
    articles = await kb.search(session, message, limit=4)
    context = "\n".join([await _cmdb_context(session, requester_email), _kb_block(articles)])
    messages: list[MessageParam] = list(history or [])
    messages.append(
        {"role": "user", "content": f"{context}\n\n<user_message>{escape(message)}</user_message>"}
    )
    result = await llm.parse(
        system=INTAKE_SYSTEM, messages=messages, output_model=IntakeResult, effort="low", max_tokens=4096
    )
    # Guardrails the schema can't express.
    result.urgency_score = max(1, min(5, result.urgency_score))
    allowed_kb = {a.key for a in articles}
    result.self_service_kb_ids = [k for k in result.self_service_kb_ids if k in allowed_kb]
    template = TEMPLATES[result.selected_template_id]
    result.required_approvals = sorted(set(result.required_approvals) | set(template.default_approvals))
    return result


# ------------------------------------------------------------------ copilot


async def run_copilot(session: AsyncSession, llm: StructuredLLM, ticket_id: int) -> CopilotResponse:
    ticket: Ticket = await get_ticket(session, ticket_id, with_events=True)
    assets = await itam.assets_for_ticket(session, ticket.id)
    asset_ids = {a.id for a in assets}
    alerts = [
        a for a in (await session.execute(select(SiemAlert).order_by(SiemAlert.id.desc()).limit(200))).scalars()
        if ticket.id in a.linked_ticket_ids or asset_ids & set(a.matched_asset_ids)
    ][:10]
    articles = await kb.search(session, f"{ticket.title} {ticket.description}", limit=6)
    secrets = list(
        (await session.execute(select(VaultSecret).where(VaultSecret.asset_id.in_(asset_ids)))).scalars()
    ) if asset_ids else []

    ctx = {
        "ticket": {"key": ticket.key, "title": ticket.title, "description": ticket.description,
                   "requester_language": ticket.original_language, "original_text": ticket.original_text,
                   "urgency": ticket.urgency, "status": ticket.status, "sentiment": ticket.sentiment},
        "cmdb_assets": [{"tag": a.tag, "name": a.name, "hostname": a.hostname, "os": a.os_version,
                         "mdm": a.mdm_status, "state": a.lifecycle_state, "attributes": a.attributes}
                        for a in assets],
        "siem_alerts": [{"source": a.source, "title": a.title, "severity": a.severity,
                         "indicators": a.indicators} for a in alerts],
        "ticket_timeline": [{"kind": e.kind, "actor": e.actor, "body": e.body} for e in ticket.events[-20:]],
        "vault_credentials": [{"id": s.id, "name": s.name} for s in secrets],
    }
    blocks = [f"<{k}>{escape(json.dumps(v, default=str))}</{k}>" for k, v in ctx.items()]
    blocks.append(_kb_block(articles))
    result = await llm.parse(
        system=COPILOT_SYSTEM,
        messages=[{"role": "user", "content": "\n".join(blocks)}],
        output_model=CopilotResult,
        effort="medium",
        max_tokens=8000,
    )
    return enforce_grounding(result, {a.key for a in articles}, {s.id for s in secrets})


def enforce_grounding(result: CopilotResult, kb_ids: set[str], secret_ids: set[int]) -> CopilotResponse:
    """Drop anything that doesn't cite a KB article we actually supplied — zero tolerance for hallucination."""
    rejected: list[str] = []
    recs = []
    for r in result.recommendations:
        cites = [c for c in r.kb_citations if c in kb_ids]
        if cites:
            recs.append(r.model_copy(update={"kb_citations": cites}))
        else:
            rejected.append(r.action)
    macros = []
    for m in result.macros:
        cites = [c for c in m.kb_citations if c in kb_ids]
        if cites:
            macros.append(m.model_copy(update={"kb_citations": cites}))
        else:
            rejected.append(f"macro:{m.macro_id}")
    jit = result.jit_elevation if result.jit_elevation and result.jit_elevation.secret_id in secret_ids else None
    if result.jit_elevation and jit is None:
        rejected.append(f"jit:{result.jit_elevation.secret_id}")
    return CopilotResponse(
        **result.model_dump(exclude={"recommendations", "macros", "jit_elevation"}),
        recommendations=recs, macros=macros, jit_elevation=jit, rejected_ungrounded=rejected,
    )
