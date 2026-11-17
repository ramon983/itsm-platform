"""Claude client wrapper: structured outputs, refusal fallback, and errors that degrade to the offline engine."""

from __future__ import annotations

import json
import logging
from html import escape
from typing import Literal, Protocol, TypeVar

import anthropic
from anthropic.types import MessageParam
from pydantic import BaseModel

from adminzero_api.config import get_settings
from adminzero_api.schemas import AssistRequest, IntakeRequest
from adminzero_api.secrets import get_secret

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)
Effort = Literal["low", "medium", "high"]


class ClaudeUnavailable(RuntimeError):
    """Claude could not produce a usable answer. Callers fall back to the deterministic engine."""


class StructuredLLM(Protocol):
    model: str

    async def structured(
        self, *, system: str, messages: list[MessageParam], output_model: type[T], effort: Effort, max_tokens: int
    ) -> T: ...


class ClaudeEngine:
    def __init__(self, api_key: str, model: str, client: anthropic.AsyncAnthropic | None = None) -> None:
        self.model = model
        self._client = client or anthropic.AsyncAnthropic(api_key=api_key, max_retries=2, timeout=45.0)

    async def structured(self, *, system: str, messages: list[MessageParam], output_model: type[T], effort: Effort, max_tokens: int) -> T:
        try:
            response = await self._client.messages.parse(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
                output_format=output_model,
                output_config={"effort": effort},
                # Server-side refusal fallback: if a safety classifier declines, the API retries on a fallback model.
                extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
                extra_body={"fallbacks": "default"},
            )
        except anthropic.RateLimitError as exc:
            raise ClaudeUnavailable("rate_limited") from exc
        except anthropic.AuthenticationError as exc:
            log.error("Anthropic authentication failed — check ANTHROPIC_API_KEY in Secret Manager")
            raise ClaudeUnavailable("auth_error") from exc
        except anthropic.APIStatusError as exc:
            log.error("Claude API error %s (request %s)", exc.status_code, exc.request_id)
            raise ClaudeUnavailable(f"api_error_{exc.status_code}") from exc
        except anthropic.APIConnectionError as exc:
            raise ClaudeUnavailable("connection_error") from exc

        if response.stop_reason == "refusal":
            log.warning("Claude declined (request %s)", response._request_id)
            raise ClaudeUnavailable("refusal")
        if response.stop_reason == "max_tokens" or response.parsed_output is None:
            raise ClaudeUnavailable("incomplete_response")
        return response.parsed_output


_engine: StructuredLLM | None = None
_engine_loaded = False


def get_llm() -> StructuredLLM | None:
    """Claude when ANTHROPIC_API_KEY resolves (Secret Manager or .env.local), otherwise None → offline engine."""
    global _engine, _engine_loaded
    if not _engine_loaded:
        key = get_secret("ANTHROPIC_API_KEY")
        _engine = ClaudeEngine(key, get_settings().claude_model) if key else None
        _engine_loaded = True
    return _engine


def set_llm(engine: StructuredLLM | None) -> None:
    global _engine, _engine_loaded
    _engine, _engine_loaded = engine, True


# ------------------------------------------------------------------ prompt context (data in tags, never instructions)


def _tag(name: str, value: object) -> str:
    return f"<{name}>{escape(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str))}</{name}>"


def intake_messages(req: IntakeRequest) -> list[MessageParam]:
    kb = [k.model_dump() for k in req.context.kb_articles]
    context = "\n".join(
        [
            _tag("cmdb_context", {"assets": req.context.assets, "saas_apps": req.context.saas_apps, "requester": req.requester_name}),
            _tag("knowledge_base", kb or "No verified articles were provided."),
        ]
    )
    turns: list[MessageParam] = [{"role": t.role, "content": t.content} for t in req.history]
    turns.append({"role": "user", "content": f"{context}\n\n{_tag('user_message', req.message)}"})
    return turns


def assist_messages(req: AssistRequest) -> list[MessageParam]:
    blocks = [
        _tag("ticket", req.ticket.model_dump()),
        _tag("cmdb_assets", req.cmdb_assets),
        _tag("siem_alerts", req.siem_alerts),
        _tag("closed_tickets", [c.model_dump() for c in req.closed_tickets]),
        _tag("knowledge_base", [k.model_dump() for k in req.kb_articles]),
    ]
    return [{"role": "user", "content": "\n".join(blocks)}]
