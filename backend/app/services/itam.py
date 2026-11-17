"""Hardware & software asset lifecycle and CMDB lookups."""

from __future__ import annotations

from sqlalchemy import insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidTransition, NotFound
from app.models import Asset, AssetLifecycleEvent, LifecycleState, asset_ticket_links

L = LifecycleState
LIFECYCLE: dict[LifecycleState, frozenset[LifecycleState]] = {
    L.PROCUREMENT: frozenset({L.RECEIVED}),
    L.RECEIVED: frozenset({L.DEPLOYED, L.RETIRED}),
    L.DEPLOYED: frozenset({L.IN_REPAIR, L.RETIRED}),
    L.IN_REPAIR: frozenset({L.DEPLOYED, L.RETIRED}),
    L.RETIRED: frozenset({L.DISPOSED, L.DEPLOYED}),
    L.DISPOSED: frozenset(),
}


async def get_asset(session: AsyncSession, asset_id: int) -> Asset:
    asset = await session.get(Asset, asset_id)
    if asset is None:
        raise NotFound(f"Asset {asset_id} not found")
    return asset


async def transition_asset(
    session: AsyncSession, asset: Asset, to: LifecycleState, actor: str, note: str | None = None
) -> Asset:
    if to not in LIFECYCLE[asset.lifecycle_state]:
        raise InvalidTransition(f"{asset.lifecycle_state} -> {to} is not an allowed lifecycle transition")
    session.add(
        AssetLifecycleEvent(asset_id=asset.id, from_state=asset.lifecycle_state, to_state=to, actor=actor, note=note)
    )
    asset.lifecycle_state = to
    await session.flush()
    return asset


async def link_ticket(session: AsyncSession, asset_id: int, ticket_id: int) -> None:
    exists = await session.execute(
        select(asset_ticket_links).where(
            asset_ticket_links.c.asset_id == asset_id, asset_ticket_links.c.ticket_id == ticket_id
        )
    )
    if exists.first() is None:
        await session.execute(insert(asset_ticket_links).values(asset_id=asset_id, ticket_id=ticket_id))


async def assets_for_ticket(session: AsyncSession, ticket_id: int) -> list[Asset]:
    stmt = select(Asset).join(asset_ticket_links).where(asset_ticket_links.c.ticket_id == ticket_id)
    return list((await session.execute(stmt)).scalars())


async def ticket_ids_for_asset(session: AsyncSession, asset_id: int) -> list[int]:
    stmt = select(asset_ticket_links.c.ticket_id).where(asset_ticket_links.c.asset_id == asset_id)
    return list((await session.execute(stmt)).scalars())


async def assets_for_user(session: AsyncSession, email: str) -> list[Asset]:
    stmt = select(Asset).where(Asset.owner_email == email.lower(), Asset.lifecycle_state != L.DISPOSED)
    return list((await session.execute(stmt)).scalars())


async def match_indicators(
    session: AsyncSession, hosts: list[str], ips: list[str], users: list[str]
) -> list[Asset]:
    conds = []
    if hosts:
        lowered = [h.lower() for h in hosts]
        conds += [Asset.hostname.in_(lowered), Asset.serial_number.in_(hosts)]
    if ips:
        conds.append(Asset.ip_address.in_(ips))
    if users:
        conds.append(Asset.owner_email.in_([u.lower() for u in users]))
    if not conds:
        return []
    return list((await session.execute(select(Asset).where(or_(*conds)))).scalars())
