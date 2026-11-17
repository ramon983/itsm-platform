"""Modules 3-6: SaaS management, ITAM/CMDB, vault, SIEM, plus the AI agent endpoints."""

from __future__ import annotations

from typing import Annotated, Literal

from anthropic.types import MessageParam
from fastapi import APIRouter, Header, Request, status
from sqlalchemy import select

from app.ai import agents
from app.ai.catalog import TEMPLATES
from app.ai.llm import AIUnavailable
from app.api.deps import LLM, Session, ticket_out
from app.core.auth import Actor, CurrentActor, Role, require_roles
from app.core.config import get_settings
from app.core.errors import DomainError, NotFound, PolicyViolation
from app.core.secrets import get_secret
from app.models import Asset, SaaSApp, SiemAlert, VaultAuditLog, VaultElevation, VaultSecret
from app.schemas import (
    AssetCreate,
    AssetOut,
    AssetUpdate,
    AuditOut,
    DiscoverySignalIn,
    ElevationDecision,
    ElevationOut,
    ElevationRequest,
    IdleSeatRow,
    IntakeRequest,
    IntakeResponse,
    LifecycleRequest,
    ReclaimRequest,
    ReclaimResult,
    SaaSAppOut,
    SaaSAppUpdate,
    ShadowItRow,
    SiemAlertOut,
    TicketOut,
    VaultReveal,
    VaultSecretCreate,
    VaultSecretMeta,
)
from app.services import itam, saas, siem, tickets, vault

AgentOnly = require_roles(Role.AGENT)
AdminOnly = require_roles(Role.ADMIN)

# ================================================================== ITAM / CMDB
itam_router = APIRouter(prefix="/assets", tags=["itam"])


@itam_router.post("", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
async def create_asset(body: AssetCreate, session: Session, actor: Actor = AgentOnly) -> AssetOut:
    if (await session.execute(select(Asset.id).where(Asset.tag == body.tag))).first():
        raise PolicyViolation(f"Asset tag {body.tag} already exists")
    asset = Asset(**body.model_dump())
    session.add(asset)
    await session.flush()
    return AssetOut.model_validate(asset)


@itam_router.get("", response_model=list[AssetOut])
async def list_assets(session: Session, owner_email: str | None = None, q: str | None = None,
                      limit: int = 100, offset: int = 0, actor: Actor = AgentOnly) -> list[AssetOut]:
    """Unlimited asset tracking — paginated, never capped by plan."""
    stmt = select(Asset).order_by(Asset.id).limit(min(limit, 500)).offset(offset)
    if owner_email:
        stmt = stmt.where(Asset.owner_email == owner_email.lower())
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(Asset.name.ilike(like) | Asset.tag.ilike(like) | Asset.hostname.ilike(like))
    return [AssetOut.model_validate(a) for a in (await session.execute(stmt)).scalars()]


@itam_router.get("/{asset_id}", response_model=AssetOut)
async def get_asset(asset_id: int, session: Session, actor: Actor = AgentOnly) -> AssetOut:
    return AssetOut.model_validate(await itam.get_asset(session, asset_id))


@itam_router.patch("/{asset_id}", response_model=AssetOut)
async def update_asset(asset_id: int, body: AssetUpdate, session: Session, actor: Actor = AgentOnly) -> AssetOut:
    asset = await itam.get_asset(session, asset_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(asset, k, v.lower() if k in {"owner_email", "hostname"} and v else v)
    await session.flush()
    return AssetOut.model_validate(asset)


@itam_router.post("/{asset_id}/lifecycle", response_model=AssetOut)
async def lifecycle(asset_id: int, body: LifecycleRequest, session: Session, actor: Actor = AgentOnly) -> AssetOut:
    asset = await itam.get_asset(session, asset_id)
    return AssetOut.model_validate(await itam.transition_asset(session, asset, body.to, actor.email, body.note))


@itam_router.get("/{asset_id}/tickets", response_model=list[TicketOut])
async def asset_tickets(asset_id: int, session: Session, actor: Actor = AgentOnly) -> list[TicketOut]:
    await itam.get_asset(session, asset_id)
    ids = await itam.ticket_ids_for_asset(session, asset_id)
    return [ticket_out(await tickets.get_ticket(session, i)) for i in ids]


@itam_router.post("/{asset_id}/tickets/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
async def link_asset_ticket(asset_id: int, ticket_id: int, session: Session, actor: Actor = AgentOnly) -> None:
    await itam.get_asset(session, asset_id)
    await tickets.get_ticket(session, ticket_id)
    await itam.link_ticket(session, asset_id, ticket_id)


# ================================================================== SaaS management
saas_router = APIRouter(prefix="/saas", tags=["saas"])


@saas_router.post("/discovery", status_code=status.HTTP_202_ACCEPTED)
async def ingest_discovery(signals: list[DiscoverySignalIn], session: Session,
                           actor: Actor = AdminOnly) -> dict[str, int]:
    """Ingest SSO/OAuth/expense discovery signals (from IdP log collectors, Google/M365 OAuth audits)."""
    return await saas.ingest_signals(
        session, [saas.DiscoverySignal(s.user_email, s.app_name, s.domain, s.source, tuple(s.scopes), s.seen_at)
                  for s in signals]
    )


@saas_router.get("/apps", response_model=list[SaaSAppOut])
async def list_apps(session: Session, actor: Actor = AgentOnly) -> list[SaaSAppOut]:
    rows = (await session.execute(select(SaaSApp).order_by(SaaSApp.name))).scalars()
    return [SaaSAppOut.model_validate(a) for a in rows]


@saas_router.patch("/apps/{app_id}", response_model=SaaSAppOut)
async def update_app(app_id: int, body: SaaSAppUpdate, session: Session, actor: Actor = AdminOnly) -> SaaSAppOut:
    app = await session.get(SaaSApp, app_id)
    if app is None:
        raise NotFound(f"App {app_id} not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(app, k, v)
    await session.flush()
    return SaaSAppOut.model_validate(app)


@saas_router.get("/shadow-it", response_model=list[ShadowItRow])
async def shadow_it(session: Session, actor: Actor = AgentOnly) -> list[ShadowItRow]:
    return [ShadowItRow(app=SaaSAppOut.model_validate(a), active_users=n) for a, n in await saas.shadow_it(session)]


@saas_router.get("/idle-seats", response_model=list[IdleSeatRow])
async def idle_seats(session: Session, idle_days: int = 30, actor: Actor = AgentOnly) -> list[IdleSeatRow]:
    return [
        IdleSeatRow(seat_id=s.id, user_email=s.user_email, app=a.name, domain=a.domain,
                    last_active_at=s.last_active_at, monthly_cost=a.cost_per_seat_month)
        for s, a in await saas.idle_seats(session, idle_days)
    ]


@saas_router.get("/spend")
async def spend(session: Session, actor: Actor = AgentOnly) -> list[dict[str, object]]:
    return await saas.spend_summary(session)


@saas_router.post("/reclaim", response_model=ReclaimResult)
async def reclaim(body: ReclaimRequest, session: Session, actor: Actor = AdminOnly) -> ReclaimResult:
    count, saved = await saas.reclaim(session, body.seat_ids, actor.email)
    return ReclaimResult(reclaimed=count, monthly_savings=saved, annual_savings=saved * 12)


# ================================================================== Vault
vault_router = APIRouter(prefix="/vault", tags=["vault"])


@vault_router.post("/secrets", response_model=VaultSecretMeta, status_code=status.HTTP_201_CREATED)
async def create_secret(body: VaultSecretCreate, session: Session, actor: Actor = AdminOnly) -> VaultSecretMeta:
    for r in body.allowed_roles:
        Role(r)  # validates
    secret = VaultSecret(**body.model_dump(), created_by=actor.email)
    session.add(secret)
    await session.flush()
    session.add(VaultAuditLog(action="create", actor=actor.email, secret_id=secret.id, outcome="allowed"))
    return VaultSecretMeta.model_validate(secret)


@vault_router.get("/secrets", response_model=list[VaultSecretMeta])
async def list_secrets(session: Session, actor: Actor = AgentOnly) -> list[VaultSecretMeta]:
    return [VaultSecretMeta.model_validate(s) for s in (await session.execute(select(VaultSecret))).scalars()]


@vault_router.post("/elevations", response_model=ElevationOut, status_code=status.HTTP_201_CREATED)
async def request_elevation(body: ElevationRequest, session: Session, actor: Actor = AgentOnly) -> ElevationOut:
    el = await vault.request_elevation(session, actor, body.secret_id, body.ticket_id, body.justification)
    return ElevationOut.model_validate(el)


@vault_router.post("/elevations/{elevation_id}/decision", response_model=ElevationOut)
async def decide(elevation_id: int, body: ElevationDecision, session: Session,
                 actor: Actor = require_roles(Role.APPROVER)) -> ElevationOut:
    return ElevationOut.model_validate(await vault.decide_elevation(session, actor, elevation_id, body.approve))


@vault_router.get("/elevations", response_model=list[ElevationOut])
async def list_elevations(session: Session, actor: Actor = AgentOnly) -> list[ElevationOut]:
    rows = await session.execute(select(VaultElevation).order_by(VaultElevation.id.desc()).limit(200))
    return [ElevationOut.model_validate(e) for e in rows.scalars()]


@vault_router.post("/secrets/{secret_id}/reveal", response_model=VaultReveal)
async def reveal(secret_id: int, session: Session, actor: Actor = AgentOnly) -> VaultReveal:
    secret = await vault.reveal(session, actor, secret_id)
    return VaultReveal.model_validate(secret)


@vault_router.get("/audit", response_model=list[AuditOut])
async def audit(session: Session, limit: int = 200, actor: Actor = AdminOnly) -> list[AuditOut]:
    rows = await session.execute(select(VaultAuditLog).order_by(VaultAuditLog.id.desc()).limit(min(limit, 1000)))
    return [AuditOut.model_validate(r) for r in rows.scalars()]


# ================================================================== SIEM
siem_router = APIRouter(prefix="/siem", tags=["siem"])


@siem_router.post("/webhook", response_model=SiemAlertOut, status_code=status.HTTP_202_ACCEPTED)
async def siem_webhook(
    request: Request,
    session: Session,
    source: Literal["splunk", "sentinel", "datadog"],
    x_adminzero_timestamp: Annotated[str | None, Header()] = None,
    x_adminzero_signature: Annotated[str | None, Header()] = None,
) -> SiemAlertOut:
    """Signed webhook for Splunk / Microsoft Sentinel / Datadog.

    Sign `{timestamp}.{raw_body}` with HMAC-SHA256 using the shared key stored in Secret Manager and send
    `X-AdminZero-Timestamp: <unix>` and `X-AdminZero-Signature: sha256=<hex>`.
    """
    settings = get_settings()
    raw = await request.body()
    siem.verify_signature(get_secret(settings.siem_signing_key_secret), raw, x_adminzero_timestamp,
                          x_adminzero_signature, settings.siem_max_clock_skew_seconds)
    try:
        payload = await request.json()
    except ValueError as exc:
        raise PolicyViolation("Body must be JSON") from exc
    if not isinstance(payload, dict):
        raise PolicyViolation("Body must be a JSON object")
    record = await siem.correlate(session, siem.normalise(source, payload))
    return SiemAlertOut.model_validate(record)


@siem_router.get("/alerts", response_model=list[SiemAlertOut])
async def list_alerts(session: Session, limit: int = 100, actor: Actor = AgentOnly) -> list[SiemAlertOut]:
    rows = await session.execute(select(SiemAlert).order_by(SiemAlert.id.desc()).limit(min(limit, 500)))
    return [SiemAlertOut.model_validate(a) for a in rows.scalars()]


# ================================================================== AI agents
ai_router = APIRouter(prefix="/ai", tags=["ai"])


class AIUnavailableHTTP(DomainError):
    status_code = 503


@ai_router.post("/intake", response_model=IntakeResponse)
async def intake(body: IntakeRequest, session: Session, llm: LLM, actor: CurrentActor) -> IntakeResponse:
    """End-user conversational intake (portal, Slack, Teams). Replies in the user's language."""
    history: list[MessageParam] = [
        {"role": "assistant" if m.get("role") == "assistant" else "user", "content": m.get("content", "")}
        for m in body.history
    ]
    try:
        result = await agents.run_intake(session, llm, actor.email, body.message, history)
    except AIUnavailable as exc:
        raise AIUnavailableHTTP(str(exc)) from exc

    ticket = None
    if body.submit and result.ready_to_submit:
        tpl = TEMPLATES[result.selected_template_id]
        t = await tickets.create_ticket(
            session,
            tickets.NewTicket(type=tpl.type, template_id=tpl.id, title=result.title_for_agent,
                              description=result.english_summary_for_agent, requester_email=actor.email,
                              urgency=result.urgency_score, swarm_group=result.recommended_swarm_group,
                              original_language=result.detected_language, original_text=body.message,
                              sentiment=result.sentiment, required_approvals=tuple(result.required_approvals)),
            actor="ai:intake",
        )
        for a in await itam.assets_for_user(session, actor.email):
            if tpl.id in {"INC-HARDWARE", "INC-NETWORK", "INC-SECURITY"}:
                await itam.link_ticket(session, a.id, t.id)
        ticket = ticket_out(t)
    reply = result.reply_to_user
    return IntakeResponse(reply=reply, ticket=ticket,
                          analysis=result.model_dump(exclude={"reply_to_user"}))


@ai_router.post("/copilot/{ticket_id}", response_model=agents.CopilotResponse)
async def copilot(ticket_id: int, session: Session, llm: LLM, actor: Actor = AgentOnly) -> agents.CopilotResponse:
    """Agent-assist side panel: KB-grounded diagnostics, macros, JIT suggestions and a drafted reply."""
    try:
        result = await agents.run_copilot(session, llm, ticket_id)
    except AIUnavailable as exc:
        raise AIUnavailableHTTP(str(exc)) from exc
    t = await tickets.get_ticket(session, ticket_id)
    await tickets.add_note(session, t, "ai:copilot", f"Copilot summary: {result.ticket_summary}", kind="ai")
    return result
