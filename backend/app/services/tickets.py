"""Ticket workflow rules.

Enforced anti-patterns:
* No status zoo — only the five `TicketStatus` values and the transitions in `ALLOWED_TRANSITIONS`.
* SLA auto-pauses in WAITING_ON_CUSTOMER / WAITING_ON_VENDOR and the due date shifts by the paused time.
* No silent handoffs — ownership/group changes only via `handoff()`, which requires a structured
  context note and always writes a timeline event + status update + domain event.
* Resolution must link a published KB article.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.errors import InvalidTransition, NotFound, PolicyViolation
from app.core.events import DomainEvent, get_event_bus
from app.models import SLA_PAUSING_STATUSES, KBArticle, Ticket, TicketEvent, TicketStatus, TicketType

S = TicketStatus
ALLOWED_TRANSITIONS: dict[TicketStatus, frozenset[TicketStatus]] = {
    S.AI_TRIAGED: frozenset({S.ACTIVE_SWARM, S.WAITING_ON_CUSTOMER, S.RESOLVED_KB_LINKED}),
    S.ACTIVE_SWARM: frozenset({S.WAITING_ON_CUSTOMER, S.WAITING_ON_VENDOR, S.RESOLVED_KB_LINKED}),
    S.WAITING_ON_CUSTOMER: frozenset({S.ACTIVE_SWARM, S.RESOLVED_KB_LINKED}),
    S.WAITING_ON_VENDOR: frozenset({S.ACTIVE_SWARM, S.RESOLVED_KB_LINKED}),
    S.RESOLVED_KB_LINKED: frozenset({S.ACTIVE_SWARM}),  # reopen
}


@dataclass(frozen=True)
class NewTicket:
    type: TicketType
    template_id: str
    title: str
    description: str
    requester_email: str
    urgency: int
    swarm_group: str
    original_language: str = "en"
    original_text: str | None = None
    sentiment: str | None = None
    required_approvals: tuple[str, ...] = ()


@dataclass(frozen=True)
class HandoffNote:
    to_group: str
    to_owner_email: str | None
    reason: str
    what_was_tried: str
    next_step: str


def sla_due(urgency: int, start: datetime) -> datetime:
    hours = get_settings().sla_hours_by_urgency.get(urgency, 24)
    return start + timedelta(hours=hours)


async def get_ticket(session: AsyncSession, ticket_id: int, *, with_events: bool = False) -> Ticket:
    stmt = select(Ticket).where(Ticket.id == ticket_id)
    if with_events:
        stmt = stmt.options(selectinload(Ticket.events))
    ticket = (await session.execute(stmt)).scalar_one_or_none()
    if ticket is None:
        raise NotFound(f"Ticket {ticket_id} not found")
    return ticket


def _event(ticket: Ticket, kind: str, actor: str, **kw: object) -> TicketEvent:
    ev = TicketEvent(ticket_id=ticket.id, kind=kind, actor=actor, **kw)
    return ev


async def create_ticket(session: AsyncSession, data: NewTicket, actor: str) -> Ticket:
    if not 1 <= data.urgency <= 5:
        raise PolicyViolation("urgency must be 1..5")
    now = utcnow()
    ticket = Ticket(
        type=data.type,
        template_id=data.template_id,
        title=data.title,
        description=data.description,
        requester_email=data.requester_email.lower(),
        urgency=data.urgency,
        swarm_group=data.swarm_group,
        original_language=data.original_language,
        original_text=data.original_text,
        sentiment=data.sentiment,
        required_approvals=list(data.required_approvals),
        status=TicketStatus.AI_TRIAGED,
        swarm_members=[],
        created_at=now,
        sla_due_at=sla_due(data.urgency, now),
    )
    session.add(ticket)
    await session.flush()
    session.add(_event(ticket, "status_change", actor, to_status=ticket.status, body="Ticket created"))
    await session.flush()
    await get_event_bus().publish(
        DomainEvent("ticket.created", "ticket", ticket.key, actor, {"swarm_group": ticket.swarm_group})
    )
    return ticket


def _apply_sla_clock(ticket: Ticket, new_status: TicketStatus, now: datetime) -> None:
    pausing_now = new_status in SLA_PAUSING_STATUSES
    if pausing_now and ticket.sla_paused_at is None:
        ticket.sla_paused_at = now
    elif not pausing_now and ticket.sla_paused_at is not None:
        ticket.sla_due_at = ticket.sla_due_at + (now - ticket.sla_paused_at)
        ticket.sla_paused_at = None


async def transition(
    session: AsyncSession,
    ticket: Ticket,
    to: TicketStatus,
    actor: str,
    *,
    note: str | None = None,
    kb_key: str | None = None,
) -> Ticket:
    if to == ticket.status:
        raise InvalidTransition(f"Ticket already {to}")
    if to not in ALLOWED_TRANSITIONS[ticket.status]:
        raise InvalidTransition(f"{ticket.status} -> {to} is not an allowed transition")

    now = utcnow()
    if to == TicketStatus.RESOLVED_KB_LINKED:
        if not kb_key:
            raise PolicyViolation("Resolving requires linking a Knowledge Base article (kb_key)")
        kb = (await session.execute(select(KBArticle).where(KBArticle.key == kb_key))).scalar_one_or_none()
        if kb is None or not kb.published:
            raise PolicyViolation(f"KB article {kb_key} does not exist or is unpublished")
        ticket.resolution_kb_key = kb_key
        ticket.resolution_note = note
        ticket.resolved_at = now
    elif ticket.status == TicketStatus.RESOLVED_KB_LINKED:  # reopen
        ticket.resolved_at = None
        ticket.sla_due_at = sla_due(ticket.urgency, now)

    _apply_sla_clock(ticket, to, now)
    prev = ticket.status
    ticket.status = to
    ticket.updated_at = now
    session.add(
        _event(ticket, "status_change", actor, from_status=prev, to_status=to, body=note, data={"kb": kb_key})
    )
    await session.flush()
    await get_event_bus().publish(
        DomainEvent("ticket.status_changed", "ticket", ticket.key, actor, {"from": prev, "to": to})
    )
    return ticket


async def handoff(session: AsyncSession, ticket: Ticket, note: HandoffNote, actor: str) -> Ticket:
    if ticket.status == TicketStatus.RESOLVED_KB_LINKED:
        raise InvalidTransition("Reopen the ticket before handing it off")
    if note.to_group == ticket.swarm_group and note.to_owner_email == ticket.owner_email:
        raise PolicyViolation("Handoff must change the owning group or owner")

    prev_status, prev_group, prev_owner = ticket.status, ticket.swarm_group, ticket.owner_email
    now = utcnow()
    ticket.swarm_group = note.to_group
    ticket.owner_email = note.to_owner_email.lower() if note.to_owner_email else None
    # Automatic status update: the receiving team actively owns the work.
    if ticket.status != TicketStatus.ACTIVE_SWARM:
        _apply_sla_clock(ticket, TicketStatus.ACTIVE_SWARM, now)
        ticket.status = TicketStatus.ACTIVE_SWARM
    ticket.updated_at = now

    body = (
        f"Handoff {prev_group} → {note.to_group}\n"
        f"Reason: {note.reason}\nTried: {note.what_was_tried}\nNext step: {note.next_step}"
    )
    session.add(
        _event(
            ticket,
            "handoff",
            actor,
            from_status=prev_status,
            to_status=ticket.status,
            body=body,
            data={
                "from_group": prev_group,
                "to_group": note.to_group,
                "from_owner": prev_owner,
                "to_owner": ticket.owner_email,
                "reason": note.reason,
                "what_was_tried": note.what_was_tried,
                "next_step": note.next_step,
            },
        )
    )
    await session.flush()
    await get_event_bus().publish(
        DomainEvent(
            "ticket.handed_off",
            "ticket",
            ticket.key,
            actor,
            {"from_group": prev_group, "to_group": note.to_group, "notify": ticket.requester_email},
        )
    )
    return ticket


async def join_swarm(session: AsyncSession, ticket: Ticket, actor: str) -> Ticket:
    if actor not in ticket.swarm_members:
        ticket.swarm_members = [*ticket.swarm_members, actor]
        session.add(_event(ticket, "note", actor, body=f"{actor} joined the swarm"))
        await session.flush()
    return ticket


async def add_note(session: AsyncSession, ticket: Ticket, actor: str, body: str, kind: str = "note") -> None:
    session.add(_event(ticket, kind, actor, body=body))
    await session.flush()


async def swarm_board(session: AsyncSession, group: str | None = None) -> dict[TicketStatus, list[Ticket]]:
    """Kanban columns keyed by status — deliberately not by assignee."""
    stmt = select(Ticket).order_by(Ticket.sla_due_at)
    if group:
        stmt = stmt.where(Ticket.swarm_group == group)
    board: dict[TicketStatus, list[Ticket]] = {s: [] for s in TicketStatus}
    for t in (await session.execute(stmt)).scalars():
        board[t.status].append(t)
    return board


def sla_remaining_seconds(ticket: Ticket, now: datetime | None = None) -> int:
    now = now or utcnow()
    reference = ticket.sla_paused_at or now
    return int((ticket.sla_due_at - reference).total_seconds())
