"""Read-only GraphQL view over the unified data graph (tickets ↔ assets ↔ alerts)."""

from __future__ import annotations

from datetime import datetime

import strawberry
from sqlalchemy import select
from strawberry.fastapi import GraphQLRouter
from strawberry.types import Info

from app.core.auth import Actor, Role, get_actor
from app.core.db import get_session
from app.models import Asset as AssetModel
from app.models import Ticket as TicketModel
from app.services import itam


@strawberry.type
class Asset:
    id: int
    tag: str
    name: str
    hostname: str | None
    owner_email: str | None
    lifecycle_state: str
    mdm_status: str


@strawberry.type
class Ticket:
    id: int
    key: str
    title: str
    status: str
    urgency: int
    swarm_group: str
    sla_due_at: datetime

    @strawberry.field
    async def assets(self, info: Info) -> list[Asset]:
        session = info.context["session"]
        return [_asset(a) for a in await itam.assets_for_ticket(session, self.id)]


def _asset(a: AssetModel) -> Asset:
    return Asset(id=a.id, tag=a.tag, name=a.name, hostname=a.hostname, owner_email=a.owner_email,
                 lifecycle_state=a.lifecycle_state, mdm_status=a.mdm_status)


def _ticket(t: TicketModel) -> Ticket:
    return Ticket(id=t.id, key=t.key, title=t.title, status=t.status, urgency=t.urgency,
                  swarm_group=t.swarm_group, sla_due_at=t.sla_due_at)


def _require_agent(info: Info) -> None:
    actor: Actor = info.context["actor"]
    if not actor.has(Role.AGENT):
        raise PermissionError("agent role required")


@strawberry.type
class Query:
    @strawberry.field
    async def tickets(self, info: Info, status: str | None = None, limit: int = 50) -> list[Ticket]:
        _require_agent(info)
        stmt = select(TicketModel).order_by(TicketModel.id.desc()).limit(min(limit, 200))
        if status:
            stmt = stmt.where(TicketModel.status == status)
        return [_ticket(t) for t in (await info.context["session"].execute(stmt)).scalars()]

    @strawberry.field
    async def asset(self, info: Info, tag: str) -> Asset | None:
        _require_agent(info)
        a = (await info.context["session"].execute(select(AssetModel).where(AssetModel.tag == tag))).scalar()
        return _asset(a) if a else None


schema = strawberry.Schema(query=Query)


def build_graphql_router() -> GraphQLRouter:  # type: ignore[type-arg]
    from fastapi import Depends
    from sqlalchemy.ext.asyncio import AsyncSession

    async def context(
        actor: Actor = Depends(get_actor), session: AsyncSession = Depends(get_session)
    ) -> dict[str, object]:
        return {"actor": actor, "session": session}

    return GraphQLRouter(schema, context_getter=context)
