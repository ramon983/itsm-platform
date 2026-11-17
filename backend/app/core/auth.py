"""Caller identity.

Cloud Run sits behind Identity-Aware Proxy / an OIDC gateway in production, which injects a
verified identity header. This module trusts only that header and the role claims mapped to it;
swap `get_actor` for full JWT verification if the API is exposed without such a gateway.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status


class Role(StrEnum):
    END_USER = "end_user"
    AGENT = "agent"
    APPROVER = "approver"
    ADMIN = "admin"


@dataclass(frozen=True)
class Actor:
    email: str
    roles: frozenset[Role]

    def has(self, *roles: Role) -> bool:
        return bool(self.roles & set(roles)) or Role.ADMIN in self.roles


async def get_actor(
    x_actor_email: Annotated[str | None, Header()] = None,
    x_actor_roles: Annotated[str | None, Header()] = None,
) -> Actor:
    if not x_actor_email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing authenticated identity")
    try:
        roles = frozenset(Role(r.strip()) for r in (x_actor_roles or "end_user").split(",") if r.strip())
    except ValueError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Unknown role") from exc
    return Actor(email=x_actor_email.lower(), roles=roles)


CurrentActor = Annotated[Actor, Depends(get_actor)]


def require_roles(*roles: Role):  # type: ignore[no-untyped-def]
    async def _dep(actor: CurrentActor) -> Actor:
        if not actor.has(*roles):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires one of: {', '.join(roles)}")
        return actor

    return Depends(_dep)
