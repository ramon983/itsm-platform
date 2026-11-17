from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

os.environ["ADMINZERO_ENV"] = "test"
os.environ.pop("GCP_PROJECT_ID", None)
os.environ["SIEM_WEBHOOK_SIGNING_KEY"] = "test-signing-key"
os.environ.pop("REDIS_URL", None)

from httpx import ASGITransport, AsyncClient  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from app.ai.llm import get_llm  # noqa: E402
from app.core import db  # noqa: E402
from app.core.events import InMemoryEventBus, set_event_bus  # noqa: E402

AGENT = {"X-Actor-Email": "alex.agent@corp.com", "X-Actor-Roles": "agent"}
AGENT2 = {"X-Actor-Email": "sam.swarm@corp.com", "X-Actor-Roles": "agent"}
APPROVER = {"X-Actor-Email": "pat.approver@corp.com", "X-Actor-Roles": "agent,approver"}
ADMIN = {"X-Actor-Email": "root.admin@corp.com", "X-Actor-Roles": "admin"}
USER = {"X-Actor-Email": "maria@corp.com", "X-Actor-Roles": "end_user"}


class FakeLLM:
    """Returns a canned structured output and records what the agent sent."""

    def __init__(self) -> None:
        self.responses: dict[str, BaseModel] = {}
        self.calls: list[dict[str, Any]] = []

    async def parse(self, *, system: str, messages: list[Any], output_model: type[BaseModel],
                    effort: str, max_tokens: int) -> BaseModel:
        self.calls.append({"system": system, "messages": messages, "effort": effort})
        return self.responses[output_model.__name__].model_copy(deep=True)


@pytest.fixture
async def engine(tmp_path: Path) -> AsyncIterator[Any]:
    eng = db.init_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    async with eng.begin() as conn:
        await conn.run_sync(db.Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
def events() -> InMemoryEventBus:
    bus = InMemoryEventBus()
    set_event_bus(bus)
    return bus


@pytest.fixture
def fake_llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
async def client(engine: Any, events: InMemoryEventBus, fake_llm: FakeLLM) -> AsyncIterator[AsyncClient]:
    from app.main import app

    app.dependency_overrides[get_llm] = lambda: fake_llm
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def make_ticket(client: AsyncClient, **overrides: Any) -> dict[str, Any]:
    body = {"type": "INC", "template_id": "INC-GENERIC", "title": "VPN drops every 10 minutes",
            "description": "VPN disconnects", "requester_email": "maria@corp.com", "urgency": 3,
            "swarm_group": "network", **overrides}
    r = await client.post("/api/v1/tickets", json=body, headers=AGENT)
    assert r.status_code == 201, r.text
    return r.json()


async def make_kb(client: AsyncClient, key: str = "KB-402", title: str = "Fix VPN disconnects",
                  body: str = "Flush DNS and renew DHCP, then reconnect the VPN client.") -> dict[str, Any]:
    r = await client.post("/api/v1/kb", json={"key": key, "title": title, "body": body, "tags": ["vpn"]},
                          headers=AGENT)
    assert r.status_code == 201, r.text
    return r.json()
