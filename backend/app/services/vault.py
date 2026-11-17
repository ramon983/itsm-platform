"""Zero-knowledge vault with Just-In-Time elevation tied to approved tickets.

The server stores client-encrypted ciphertext only. Access to that ciphertext requires an
APPROVED, unexpired elevation bound to an open ticket, approved by someone other than the
requester. Every attempt (allowed or denied) is written to the append-only audit log.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import Actor, Role
from app.core.config import get_settings
from app.core.db import independent_session, utcnow
from app.core.errors import Forbidden, InvalidTransition, NotFound, PolicyViolation
from app.core.events import DomainEvent, get_event_bus
from app.models import ElevationStatus, Ticket, TicketStatus, VaultAuditLog, VaultElevation, VaultSecret

OPEN_TICKET_STATUSES = frozenset({TicketStatus.ACTIVE_SWARM, TicketStatus.WAITING_ON_VENDOR})


async def _audit(
    session: AsyncSession, action: str, actor: str, outcome: str, *, secret_id: int | None = None,
    elevation_id: int | None = None, ticket_id: int | None = None, detail: str | None = None,
) -> None:
    entry = VaultAuditLog(action=action, actor=actor, outcome=outcome, secret_id=secret_id,
                          elevation_id=elevation_id, ticket_id=ticket_id, detail=detail)
    if outcome == "denied":
        # Denials are followed by an exception that rolls back the request transaction;
        # commit them separately so failed access attempts are never lost from the audit trail.
        async with independent_session() as audit_session:
            audit_session.add(entry)
            await audit_session.commit()
    else:
        session.add(entry)


async def _get_secret(session: AsyncSession, secret_id: int) -> VaultSecret:
    secret = await session.get(VaultSecret, secret_id)
    if secret is None:
        raise NotFound(f"Secret {secret_id} not found")
    return secret


async def request_elevation(
    session: AsyncSession, actor: Actor, secret_id: int, ticket_id: int, justification: str
) -> VaultElevation:
    secret = await _get_secret(session, secret_id)
    ticket = await session.get(Ticket, ticket_id)
    if ticket is None:
        raise NotFound(f"Ticket {ticket_id} not found")
    if ticket.status not in OPEN_TICKET_STATUSES:
        await _audit(session, "request", actor.email, "denied", secret_id=secret_id, ticket_id=ticket_id,
               detail=f"ticket status {ticket.status}")
        await session.flush()
        raise PolicyViolation("JIT elevation requires a ticket in ACTIVE_SWARM or WAITING_ON_VENDOR")
    if not any(r in actor.roles for r in map(Role, secret.allowed_roles)) and Role.ADMIN not in actor.roles:
        await _audit(session, "request", actor.email, "denied", secret_id=secret_id, ticket_id=ticket_id,
               detail="role not permitted")
        await session.flush()
        raise Forbidden("Your role may not request this credential")

    elevation = VaultElevation(secret_id=secret.id, ticket_id=ticket.id, requester_email=actor.email,
                               justification=justification)
    session.add(elevation)
    await session.flush()
    await _audit(session, "request", actor.email, "allowed", secret_id=secret.id, elevation_id=elevation.id,
           ticket_id=ticket.id, detail=justification)
    await session.flush()
    await get_event_bus().publish(
        DomainEvent("vault.elevation_requested", "vault_elevation", str(elevation.id), actor.email,
                    {"ticket_id": ticket.id, "secret": secret.name})
    )
    return elevation


async def decide_elevation(
    session: AsyncSession, actor: Actor, elevation_id: int, approve: bool
) -> VaultElevation:
    el = await session.get(VaultElevation, elevation_id)
    if el is None:
        raise NotFound(f"Elevation {elevation_id} not found")
    if el.status != ElevationStatus.PENDING:
        raise InvalidTransition(f"Elevation already {el.status}")
    if el.requester_email == actor.email:
        await _audit(session, "approve", actor.email, "denied", elevation_id=el.id, detail="self-approval")
        await session.flush()
        raise Forbidden("Requesters cannot approve their own elevation")
    now = utcnow()
    el.approver_email = actor.email
    if approve:
        el.status = ElevationStatus.APPROVED
        el.approved_at = now
        el.expires_at = now + timedelta(minutes=get_settings().jit_elevation_minutes)
    else:
        el.status = ElevationStatus.DENIED
    await _audit(session, "approve" if approve else "deny", actor.email, "allowed", secret_id=el.secret_id,
           elevation_id=el.id, ticket_id=el.ticket_id)
    await session.flush()
    return el


async def reveal(session: AsyncSession, actor: Actor, secret_id: int) -> VaultSecret:
    """Release ciphertext to a requester holding an active elevation. Decryption happens client-side."""
    secret = await _get_secret(session, secret_id)
    now = utcnow()
    stmt = select(VaultElevation).where(
        VaultElevation.secret_id == secret_id,
        VaultElevation.requester_email == actor.email,
        VaultElevation.status == ElevationStatus.APPROVED,
        VaultElevation.expires_at > now,
    )
    el = (await session.execute(stmt)).scalars().first()
    if el is not None:
        ticket = await session.get(Ticket, el.ticket_id)
        if ticket is None or ticket.status not in OPEN_TICKET_STATUSES:
            el.status = ElevationStatus.REVOKED  # ticket closed → access ends immediately
            el = None
    if el is None:
        await _audit(session, "reveal", actor.email, "denied", secret_id=secret_id, detail="no active elevation")
        await session.flush()
        raise Forbidden("No active JIT elevation for this credential")
    await _audit(session, "reveal", actor.email, "allowed", secret_id=secret_id, elevation_id=el.id,
           ticket_id=el.ticket_id)
    await session.flush()
    return secret
