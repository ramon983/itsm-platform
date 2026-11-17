"""Domain event bus: Redis Streams in deployed environments, in-memory for dev/tests."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.core.db import utcnow

log = logging.getLogger(__name__)

STREAM = "adminzero:events"


@dataclass(frozen=True)
class DomainEvent:
    type: str
    entity: str
    entity_id: str
    actor: str
    data: dict[str, Any] = field(default_factory=dict)

    def to_wire(self) -> dict[str, str]:
        return {
            "type": self.type,
            "entity": self.entity,
            "entity_id": self.entity_id,
            "actor": self.actor,
            "at": utcnow().isoformat(),
            "data": json.dumps(self.data, default=str),
        }


class EventBus(Protocol):
    async def publish(self, event: DomainEvent) -> None: ...


class InMemoryEventBus:
    def __init__(self) -> None:
        self.events: list[DomainEvent] = []

    async def publish(self, event: DomainEvent) -> None:
        self.events.append(event)
        log.debug("event %s %s:%s", event.type, event.entity, event.entity_id)


class RedisEventBus:
    def __init__(self, url: str) -> None:
        from redis.asyncio import Redis

        self._redis = Redis.from_url(url)

    async def publish(self, event: DomainEvent) -> None:
        try:
            await self._redis.xadd(STREAM, event.to_wire(), maxlen=100_000, approximate=True)  # type: ignore[arg-type]
        except Exception:
            # Event streaming must never break the transactional write path.
            log.exception("Failed to publish %s to Redis", event.type)


_bus: EventBus = InMemoryEventBus()


def set_event_bus(bus: EventBus) -> None:
    global _bus
    _bus = bus


def get_event_bus() -> EventBus:
    return _bus
