"""Module 1 — ITSM foundation: tickets, swarming, changes, knowledge base."""

from __future__ import annotations

from fastapi import APIRouter, Query, status
from sqlalchemy import select

from app.api.deps import Session, ticket_out
from app.core.auth import Actor, CurrentActor, Role, require_roles
from app.core.errors import Forbidden, NotFound, PolicyViolation
from app.models import ChangeRecord, TicketType
from app.schemas import (
    ChangeCreate,
    ChangeOut,
    HandoffRequest,
    KBCreate,
    KBOut,
    KBRevise,
    KBVersionOut,
    NoteRequest,
    SwarmBoard,
    TicketCreate,
    TicketEventOut,
    TicketOut,
    TransitionRequest,
)
from app.services import changes, itam, kb, tickets

router = APIRouter()
AgentOnly = require_roles(Role.AGENT)


# ------------------------------------------------------------------ tickets


@router.post("/tickets", response_model=TicketOut, status_code=status.HTTP_201_CREATED, tags=["tickets"])
async def create_ticket(body: TicketCreate, session: Session, actor: CurrentActor) -> TicketOut:
    if not actor.has(Role.AGENT) and body.requester_email.lower() != actor.email:
        raise Forbidden("End users may only raise tickets for themselves")
    t = await tickets.create_ticket(
        session,
        tickets.NewTicket(type=body.type, template_id=body.template_id, title=body.title,
                          description=body.description, requester_email=body.requester_email,
                          urgency=body.urgency, swarm_group=body.swarm_group),
        actor.email,
    )
    for aid in body.asset_ids:
        await itam.get_asset(session, aid)
        await itam.link_ticket(session, aid, t.id)
    return ticket_out(t)


@router.get("/tickets/board", response_model=SwarmBoard, tags=["tickets"])
async def board(session: Session, group: str | None = None, actor: Actor = AgentOnly) -> SwarmBoard:
    """Collaborative swarm Kanban — the default agent view. Columns are statuses, not assignees."""
    cols = await tickets.swarm_board(session, group)
    return SwarmBoard(group=group, columns={k: [ticket_out(t) for t in v] for k, v in cols.items()})


@router.get("/tickets/{ticket_id}", response_model=TicketOut, tags=["tickets"])
async def get_ticket(ticket_id: int, session: Session, actor: CurrentActor) -> TicketOut:
    t = await tickets.get_ticket(session, ticket_id)
    if not actor.has(Role.AGENT) and t.requester_email != actor.email:
        raise NotFound(f"Ticket {ticket_id} not found")
    return ticket_out(t)


@router.get("/tickets/{ticket_id}/timeline", response_model=list[TicketEventOut], tags=["tickets"])
async def timeline(ticket_id: int, session: Session, actor: Actor = AgentOnly) -> list[TicketEventOut]:
    t = await tickets.get_ticket(session, ticket_id, with_events=True)
    return [TicketEventOut.model_validate(e) for e in t.events]


@router.post("/tickets/{ticket_id}/transition", response_model=TicketOut, tags=["tickets"])
async def transition(ticket_id: int, body: TransitionRequest, session: Session,
                     actor: Actor = AgentOnly) -> TicketOut:
    t = await tickets.get_ticket(session, ticket_id)
    await tickets.transition(session, t, body.to, actor.email, note=body.note, kb_key=body.kb_key)
    return ticket_out(t)


@router.post("/tickets/{ticket_id}/handoff", response_model=TicketOut, tags=["tickets"])
async def handoff(ticket_id: int, body: HandoffRequest, session: Session, actor: Actor = AgentOnly) -> TicketOut:
    """The only way to change a ticket's owning group or owner."""
    t = await tickets.get_ticket(session, ticket_id)
    note = tickets.HandoffNote(to_group=body.to_group, to_owner_email=body.to_owner_email, reason=body.reason,
                               what_was_tried=body.what_was_tried, next_step=body.next_step)
    await tickets.handoff(session, t, note, actor.email)
    return ticket_out(t)


@router.post("/tickets/{ticket_id}/swarm", response_model=TicketOut, tags=["tickets"])
async def join_swarm(ticket_id: int, session: Session, actor: Actor = AgentOnly) -> TicketOut:
    t = await tickets.get_ticket(session, ticket_id)
    await tickets.join_swarm(session, t, actor.email)
    return ticket_out(t)


@router.post("/tickets/{ticket_id}/notes", status_code=status.HTTP_204_NO_CONTENT, tags=["tickets"])
async def add_note(ticket_id: int, body: NoteRequest, session: Session, actor: CurrentActor) -> None:
    t = await tickets.get_ticket(session, ticket_id)
    if not actor.has(Role.AGENT) and t.requester_email != actor.email:
        raise NotFound(f"Ticket {ticket_id} not found")
    await tickets.add_note(session, t, actor.email, body.body)


# ------------------------------------------------------------------ changes


@router.post("/changes", response_model=ChangeOut, status_code=status.HTTP_201_CREATED, tags=["changes"])
async def create_change(body: ChangeCreate, session: Session, actor: Actor = AgentOnly) -> ChangeOut:
    inputs = changes.RiskInputs(
        impact=body.impact, affected_ci_count=len(body.affected_asset_ids),
        has_rollback_plan=bool(body.rollback_plan), tested_in_staging=body.tested_in_staging,
        outside_maintenance_window=body.outside_maintenance_window,
        recent_failed_changes_on_cis=body.recent_failed_changes_on_cis,
        touches_security_controls=body.touches_security_controls,
    )
    risk = changes.score_change(inputs)
    t = await tickets.create_ticket(
        session,
        tickets.NewTicket(type=TicketType.CHANGE, template_id="CHG-NORMAL" if risk.cab_required else "CHG-STANDARD",
                          title=body.title, description=body.description, requester_email=body.requester_email,
                          urgency=min(5, max(1, body.impact)), swarm_group="change-mgmt",
                          required_approvals=("cab",) if risk.cab_required else ()),
        actor.email,
    )
    for aid in body.affected_asset_ids:
        await itam.get_asset(session, aid)
        await itam.link_ticket(session, aid, t.id)
    change = ChangeRecord(
        ticket_id=t.id, risk_score=risk.score, risk_level=risk.level, cab_required=risk.cab_required,
        jira_release_key=body.jira_release_key, implementation_plan=body.implementation_plan,
        rollback_plan=body.rollback_plan, scheduled_start=body.scheduled_start,
        risk_factors={"inputs": changes.inputs_dict(inputs), "points": risk.factors},
    )
    session.add(change)
    await session.flush()
    return ChangeOut.model_validate(change)


@router.post("/changes/{change_id}/cab-approve", response_model=ChangeOut, tags=["changes"])
async def cab_approve(change_id: int, session: Session, actor: Actor = require_roles(Role.APPROVER)) -> ChangeOut:
    change = await session.get(ChangeRecord, change_id)
    if change is None:
        raise NotFound(f"Change {change_id} not found")
    if not change.cab_required:
        raise PolicyViolation("Standard change — no CAB approval needed")
    t = await tickets.get_ticket(session, change.ticket_id)
    if t.requester_email == actor.email:
        raise Forbidden("Change requester cannot approve their own change")
    change.cab_approved_by = actor.email
    await tickets.add_note(session, t, actor.email, "CAB approved", kind="approval")
    return ChangeOut.model_validate(change)


@router.get("/changes", response_model=list[ChangeOut], tags=["changes"])
async def list_changes(session: Session, jira_release_key: str | None = None,
                       actor: Actor = AgentOnly) -> list[ChangeOut]:
    stmt = select(ChangeRecord).order_by(ChangeRecord.id.desc())
    if jira_release_key:
        stmt = stmt.where(ChangeRecord.jira_release_key == jira_release_key)
    return [ChangeOut.model_validate(c) for c in (await session.execute(stmt)).scalars()]


# ------------------------------------------------------------------ knowledge base


def _kb_out(a: object) -> KBOut:
    return KBOut.model_validate({**{k: getattr(a, k) for k in ("key", "title", "current_version", "tags",
                                                                "published")}, "body": kb.current_body(a)})  # type: ignore[arg-type]


@router.post("/kb", response_model=KBOut, status_code=status.HTTP_201_CREATED, tags=["knowledge-base"])
async def create_kb(body: KBCreate, session: Session, actor: Actor = AgentOnly) -> KBOut:
    a = await kb.create_article(session, body.title, body.body, body.tags, actor.email, key=body.key)
    return _kb_out(a)


@router.get("/kb/search", response_model=list[KBOut], tags=["knowledge-base"])
async def search_kb(session: Session, actor: CurrentActor, q: str = Query(min_length=2)) -> list[KBOut]:
    return [_kb_out(a) for a in await kb.search(session, q, limit=10)]


@router.get("/kb/{key}", response_model=KBOut, tags=["knowledge-base"])
async def get_kb(key: str, session: Session, actor: CurrentActor) -> KBOut:
    return _kb_out(await kb.get_article(session, key))


@router.put("/kb/{key}", response_model=KBOut, tags=["knowledge-base"])
async def revise_kb(key: str, body: KBRevise, session: Session, actor: Actor = AgentOnly) -> KBOut:
    return _kb_out(await kb.revise_article(session, key, body.body, actor.email, body.change_note))


@router.get("/kb/{key}/versions", response_model=list[KBVersionOut], tags=["knowledge-base"])
async def kb_versions(key: str, session: Session, actor: Actor = AgentOnly) -> list[KBVersionOut]:
    a = await kb.get_article(session, key)
    return [KBVersionOut.model_validate(v) for v in a.versions]
