"""AdminZero API — FastAPI on Cloud Run.

Endpoints
  GET  /api/v1/health            secret + AI status (names only, never values)
  POST /api/v1/tickets/intake     Conversational Intake Agent (Runtime System Prompt 1)
  POST /api/v1/agent/assist       Agent-Assist Copilot (Runtime System Prompt 2)
  POST /api/v1/siem/webhook       HMAC-signed Sentinel / Splunk / Datadog alerts → CMDB-correlated P1 draft
  GET  /api/v1/saas/discovery     SaaS spend, seats and reclaimable savings

Run locally:  uv run uvicorn main:app --reload --port 8080
"""

from __future__ import annotations

import json
import logging
import time
from collections import defaultdict, deque
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware

from adminzero_api import fallback, siem
from adminzero_api.catalog import SAAS
from adminzero_api.config import get_settings
from adminzero_api.llm import ClaudeUnavailable, assist_messages, get_llm, intake_messages
from adminzero_api.prompts import ASSIST_SYSTEM, INTAKE_SYSTEM
from adminzero_api.schemas import (
    AssistOutput,
    AssistRequest,
    AssistResponse,
    HealthResponse,
    IntakeAnalysis,
    IntakeOutput,
    IntakeRequest,
    IntakeResponse,
    SaasAppOut,
    SaasDiscoveryResponse,
    SiemAlertResponse,
)
from adminzero_api.secrets import get_secret, get_secret_provider, secret_status

VERSION = "0.5.0"
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("adminzero")

settings = get_settings()
app = FastAPI(
    title="AdminZero Open API",
    version=VERSION,
    description="Claude-powered intake and agent assist, signed SIEM webhook and SaaS discovery. Secrets from Google Cloud Secret Manager.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-AdminZero-Timestamp", "X-AdminZero-Signature"],
)

# ------------------------------------------------------------------ AI rate limit (per client IP, sliding minute)

_hits: dict[str, deque[float]] = defaultdict(deque)


def ai_rate_limit(request: Request) -> None:
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown").split(",")[0].strip()
    window = _hits[ip]
    now = time.monotonic()
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= get_settings().ai_rate_limit_per_minute:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "AI rate limit reached — try again in a minute")
    window.append(now)


AiLimited = Annotated[None, Depends(ai_rate_limit)]

# ------------------------------------------------------------------ health


@app.get("/api/v1/health", response_model=HealthResponse, tags=["ops"])
async def health() -> HealthResponse:
    provider = get_secret_provider()
    llm = get_llm()
    return HealthResponse(
        status="ok",
        version=VERSION,
        environment=get_settings().env,
        secrets={"source": provider.source, "resolved": secret_status()},
        ai={"engine": "claude" if llm else "offline", "model": llm.model if llm else None},
    )


# ------------------------------------------------------------------ intake


def _analysis(out: IntakeOutput, kb_ids: set[str]) -> IntakeAnalysis:
    template = fallback.template_meta(out.selected_template_id)
    urgency = max(1, min(5, out.urgency_score))
    return IntakeAnalysis(
        detected_language=out.detected_language,
        urgency_score=urgency,
        sentiment=out.sentiment,
        selected_template_id=out.selected_template_id,
        template_name=template.name,
        ticket_type=template.ticket_type,
        priority=fallback.priority_for(min(urgency, 4) if template.ticket_type == "CHANGE" else urgency),  # type: ignore[arg-type]
        english_summary_for_agent=out.english_summary_for_agent,
        required_approvals=sorted(set(out.required_approvals) | set(template.approvals)),
        recommended_swarm_group=out.recommended_swarm_group,
        clarifying_question=out.clarifying_question,
        self_service_kb_ids=[k for k in out.self_service_kb_ids if k in kb_ids],  # never cite an article we didn't provide
    )


@app.post("/api/v1/tickets/intake", response_model=IntakeResponse, tags=["ai"])
async def tickets_intake(req: IntakeRequest, _: AiLimited) -> IntakeResponse:
    kb_ids = {k.id for k in req.context.kb_articles} or {k for k in fallback.TEMPLATE_KB.values()}
    llm = get_llm()
    reason = "no_api_key"
    if llm:
        try:
            out = await llm.structured(
                system=INTAKE_SYSTEM, messages=intake_messages(req), output_model=IntakeOutput, effort="low", max_tokens=4096
            )
            return IntakeResponse(reply=out.reply, analysis=_analysis(out, kb_ids), engine="claude", model=llm.model)
        except ClaudeUnavailable as exc:
            reason = str(exc)
            log.warning("Intake falling back to offline engine: %s", reason)
    out = fallback.offline_intake(req)
    return IntakeResponse(reply=out.reply, analysis=_analysis(out, kb_ids), engine="offline", fallback_reason=reason)


# ------------------------------------------------------------------ agent assist


@app.post("/api/v1/agent/assist", response_model=AssistResponse, tags=["ai"])
async def agent_assist(req: AssistRequest, _: AiLimited) -> AssistResponse:
    kb_ids = {k.id for k in fallback.kb_corpus(req)}
    llm = get_llm()
    reason = "no_api_key"
    if llm and req.kb_articles:
        try:
            out = await llm.structured(
                system=ASSIST_SYSTEM, messages=assist_messages(req), output_model=AssistOutput, effort="medium", max_tokens=8000
            )
            grounded, rejected = fallback.enforce_grounding(out, kb_ids)
            return AssistResponse(**grounded.model_dump(), rejected_ungrounded=rejected, engine="claude", model=llm.model)
        except ClaudeUnavailable as exc:
            reason = str(exc)
            log.warning("Assist falling back to offline engine: %s", reason)
    elif llm:
        reason = "no_knowledge_base_supplied"
    out = fallback.offline_assist(req)
    grounded, rejected = fallback.enforce_grounding(out, kb_ids)
    return AssistResponse(**grounded.model_dump(), rejected_ungrounded=rejected, engine="offline", fallback_reason=reason)


# ------------------------------------------------------------------ SIEM webhook


@app.post("/api/v1/siem/webhook", response_model=SiemAlertResponse, status_code=status.HTTP_202_ACCEPTED, tags=["siem"])
async def siem_webhook(
    request: Request,
    source: Annotated[Literal["sentinel", "splunk", "datadog"], Query()],
    x_adminzero_timestamp: Annotated[str | None, Header()] = None,
    x_adminzero_signature: Annotated[str | None, Header()] = None,
) -> SiemAlertResponse:
    """Sign `{timestamp}.{raw body}` with HMAC-SHA256 using SIEM_WEBHOOK_SECRET (from Secret Manager).
    Send `X-AdminZero-Timestamp: <unix seconds>` and `X-AdminZero-Signature: sha256=<hex>`."""
    secret = get_secret("SIEM_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "SIEM_WEBHOOK_SECRET is not configured")
    body = await request.body()
    try:
        siem.verify_signature(secret, body, x_adminzero_timestamp, x_adminzero_signature, get_settings().siem_max_skew_seconds)
    except siem.SignatureError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    try:
        payload = json.loads(body)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Body must be JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Body must be a JSON object")
    result = siem.build_response(siem.normalise(source, payload))
    log.info("SIEM %s alert %s → %s", source, result.alert_id, result.incident.title if result.incident else "no incident")
    return result


# ------------------------------------------------------------------ SaaS discovery


@app.get("/api/v1/saas/discovery", response_model=SaasDiscoveryResponse, tags=["saas"])
async def saas_discovery() -> SaasDiscoveryResponse:
    apps = [
        SaasAppOut(
            id=a.id,
            name=a.name,
            approved=a.approved,
            provisioned_seats=a.provisioned,
            active_seats=a.provisioned - a.idle,
            idle_seats=a.idle,
            monthly_cost=round(a.provisioned * a.cost_per_seat_monthly, 2),
            annual_spend=round(a.provisioned * a.cost_per_seat_monthly * 12, 2),
            reclaimable_monthly=round(a.idle * a.cost_per_seat_monthly, 2),
            renewal_days=a.renewal_days,
            oauth_risk=a.oauth_risk,
            discovered_via=a.discovered_via,
        )
        for a in SAAS
    ]
    return SaasDiscoveryResponse(
        apps=apps,
        totals={
            "annual_spend": round(sum(a.annual_spend for a in apps), 2),
            "monthly_spend": round(sum(a.monthly_cost for a in apps), 2),
            "reclaimable_monthly": round(sum(a.reclaimable_monthly for a in apps), 2),
            "idle_seats": sum(a.idle_seats for a in apps),
            "shadow_it_apps": sum(1 for a in apps if not a.approved),
        },
    )
