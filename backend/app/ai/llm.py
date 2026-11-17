"""Thin, testable wrapper around the Anthropic SDK for structured-output calls."""

from __future__ import annotations

import logging
from typing import Literal, Protocol, TypeVar

import anthropic
from anthropic.types import MessageParam
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.secrets import get_secret

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)
Effort = Literal["low", "medium", "high", "xhigh", "max"]


class AIUnavailable(RuntimeError):
    """Raised when the model refuses, is truncated, or the API fails. Callers fall back to humans."""


class StructuredLLM(Protocol):
    async def parse(
        self, *, system: str, messages: list[MessageParam], output_model: type[T], effort: Effort,
        max_tokens: int,
    ) -> T: ...


class AnthropicLLM:
    def __init__(self, client: anthropic.AsyncAnthropic | None = None, model: str | None = None) -> None:
        settings = get_settings()
        self._client = client or anthropic.AsyncAnthropic(
            api_key=get_secret(settings.anthropic_api_key_secret), max_retries=3, timeout=60.0
        )
        self._model = model or settings.claude_model

    async def parse(
        self, *, system: str, messages: list[MessageParam], output_model: type[T], effort: Effort,
        max_tokens: int,
    ) -> T:
        try:
            response = await self._client.messages.parse(
                model=self._model,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
                output_format=output_model,
                output_config={"effort": effort},
                # Server-side refusal fallback: if a safety classifier declines, the API retries on a
                # fallback model inside the same call.
                extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
                extra_body={"fallbacks": "default"},
            )
        except anthropic.RateLimitError as exc:
            log.warning("Claude rate limited (request %s)", getattr(exc, "request_id", None))
            raise AIUnavailable("AI assistant is busy; routed to a human") from exc
        except anthropic.APIStatusError as exc:
            log.error("Claude API error %s (request %s): %s", exc.status_code, exc.request_id, exc.message)
            raise AIUnavailable("AI assistant error") from exc
        except anthropic.APIConnectionError as exc:
            log.error("Claude connection error: %s", exc)
            raise AIUnavailable("AI assistant unreachable") from exc

        if response.stop_reason == "refusal":
            log.warning("Claude refusal (request %s): %s", response._request_id, response.stop_details)
            raise AIUnavailable("AI declined this request; routed to a human")
        if response.stop_reason == "max_tokens" or response.parsed_output is None:
            raise AIUnavailable("AI response incomplete")
        return response.parsed_output


_llm: StructuredLLM | None = None


def get_llm() -> StructuredLLM:
    global _llm
    if _llm is None:
        _llm = AnthropicLLM()
    return _llm
