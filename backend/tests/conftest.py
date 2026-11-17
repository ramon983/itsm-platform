from __future__ import annotations

import os

os.environ["ADMINZERO_ENV"] = "test"
os.environ.pop("GCP_PROJECT_ID", None)
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["SIEM_WEBHOOK_SECRET"] = "test-siem-secret"
os.environ["ADMINZERO_ALLOWED_ORIGINS"] = "https://ramon983.github.io,http://localhost:3000"

from collections.abc import AsyncIterator  # noqa: E402
from typing import Any  # noqa: E402

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import main  # noqa: E402
from adminzero_api import llm  # noqa: E402


class FakeClaude:
    """Stands in for ClaudeEngine: returns canned structured output or raises ClaudeUnavailable."""

    model = "claude-opus-5-5"

    def __init__(self) -> None:
        self.outputs: dict[str, BaseModel | Exception] = {}
        self.calls: list[dict[str, Any]] = []

    async def structured(
        self, *, system: str, messages: list[Any], output_model: type[BaseModel], effort: str, max_tokens: int
    ) -> BaseModel:
        self.calls.append({"system": system, "messages": messages, "effort": effort})
        out = self.outputs[output_model.__name__]
        if isinstance(out, Exception):
            raise out
        return out


@pytest.fixture(autouse=True)
def offline_by_default() -> None:
    llm.set_llm(None)
    main._hits.clear()


@pytest.fixture
def fake_claude() -> FakeClaude:
    fake = FakeClaude()
    llm.set_llm(fake)
    return fake


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test") as c:
        yield c
