"""Torii-style SaaS management: discovery, shadow IT, spend, idle seats, reclamation."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.events import DomainEvent, get_event_bus
from app.models import DiscoverySource, SaaSApp, SaaSSeat, SeatStatus

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class DiscoverySignal:
    user_email: str
    app_name: str
    domain: str
    source: DiscoverySource
    scopes: tuple[str, ...] = ()
    seen_at: datetime | None = None


class LicenseConnector(Protocol):
    """Vendor-specific seat removal (Slack SCIM, Google Workspace, Okta app unassign, ...)."""

    async def revoke_seat(self, app: SaaSApp, user_email: str) -> None: ...


class LoggingConnector:
    async def revoke_seat(self, app: SaaSApp, user_email: str) -> None:
        log.info("Reclaim requested for %s on %s (no vendor connector configured)", user_email, app.domain)


_connectors: dict[str, LicenseConnector] = {}


def register_connector(domain: str, connector: LicenseConnector) -> None:
    _connectors[domain] = connector


async def ingest_signals(session: AsyncSession, signals: list[DiscoverySignal]) -> dict[str, int]:
    new_apps = new_seats = 0
    for sig in signals:
        domain = sig.domain.lower()
        app = (await session.execute(select(SaaSApp).where(SaaSApp.domain == domain))).scalar_one_or_none()
        if app is None:
            app = SaaSApp(name=sig.app_name, domain=domain, discovered_via=sig.source, sanctioned=False)
            app.oauth_scopes = sorted(set(sig.scopes))
            session.add(app)
            await session.flush()
            new_apps += 1
            await get_event_bus().publish(
                DomainEvent("saas.discovered", "saas_app", domain, "discovery", {"source": sig.source})
            )
        elif sig.scopes:
            app.oauth_scopes = sorted(set(app.oauth_scopes) | set(sig.scopes))

        email = sig.user_email.lower()
        seat = (
            await session.execute(select(SaaSSeat).where(SaaSSeat.app_id == app.id, SaaSSeat.user_email == email))
        ).scalar_one_or_none()
        seen = sig.seen_at or utcnow()
        if seat is None:
            session.add(SaaSSeat(app_id=app.id, user_email=email, last_active_at=seen))
            new_seats += 1
        elif seat.last_active_at is None or seen > seat.last_active_at:
            seat.last_active_at = seen
    await session.flush()
    return {"new_apps": new_apps, "new_seats": new_seats}


async def shadow_it(session: AsyncSession) -> list[tuple[SaaSApp, int]]:
    stmt = (
        select(SaaSApp, func.count(SaaSSeat.id))
        .outerjoin(SaaSSeat, (SaaSSeat.app_id == SaaSApp.id) & (SaaSSeat.status == SeatStatus.ACTIVE))
        .where(SaaSApp.sanctioned.is_(False))
        .group_by(SaaSApp.id)
        .order_by(func.count(SaaSSeat.id).desc())
    )
    return [(a, int(n)) for a, n in (await session.execute(stmt)).all()]


async def idle_seats(session: AsyncSession, idle_days: int = 30) -> list[tuple[SaaSSeat, SaaSApp]]:
    cutoff = utcnow() - timedelta(days=idle_days)
    stmt = (
        select(SaaSSeat, SaaSApp)
        .join(SaaSApp)
        .where(
            SaaSSeat.status == SeatStatus.ACTIVE,
            (SaaSSeat.last_active_at.is_(None)) | (SaaSSeat.last_active_at < cutoff),
        )
        .order_by(SaaSApp.cost_per_seat_month.desc())
    )
    return [(s, a) for s, a in (await session.execute(stmt)).all()]


async def spend_summary(session: AsyncSession) -> list[dict[str, object]]:
    stmt = (
        select(SaaSApp, func.count(SaaSSeat.id))
        .join(SaaSSeat, (SaaSSeat.app_id == SaaSApp.id) & (SaaSSeat.status == SeatStatus.ACTIVE))
        .group_by(SaaSApp.id)
    )
    rows = []
    for app, seats in (await session.execute(stmt)).all():
        monthly = app.cost_per_seat_month * seats
        rows.append(
            {"app": app.name, "domain": app.domain, "active_seats": seats, "monthly_cost": monthly,
             "annual_cost": monthly * 12, "sanctioned": app.sanctioned}
        )
    return sorted(rows, key=lambda r: r["annual_cost"], reverse=True)  # type: ignore[arg-type,return-value]


async def reclaim(session: AsyncSession, seat_ids: list[int], actor: str) -> tuple[int, Decimal]:
    """1-click reclamation. Returns (seats reclaimed, monthly saving)."""
    stmt = select(SaaSSeat, SaaSApp).join(SaaSApp).where(SaaSSeat.id.in_(seat_ids))
    saved = Decimal("0")
    count = 0
    now = utcnow()
    for seat, app in (await session.execute(stmt)).all():
        if seat.status != SeatStatus.ACTIVE:
            continue
        await _connectors.get(app.domain, LoggingConnector()).revoke_seat(app, seat.user_email)
        seat.status = SeatStatus.RECLAIMED
        seat.reclaimed_at = now
        seat.reclaimed_by = actor
        saved += app.cost_per_seat_month
        count += 1
        await get_event_bus().publish(
            DomainEvent("saas.seat_reclaimed", "saas_seat", str(seat.id), actor, {"app": app.domain,
                        "user": seat.user_email})
        )
    await session.flush()
    return count, saved


async def seats_for_user(session: AsyncSession, email: str) -> list[tuple[SaaSSeat, SaaSApp]]:
    stmt = select(SaaSSeat, SaaSApp).join(SaaSApp).where(
        SaaSSeat.user_email == email.lower(), SaaSSeat.status == SeatStatus.ACTIVE
    )
    return [(s, a) for s, a in (await session.execute(stmt)).all()]
