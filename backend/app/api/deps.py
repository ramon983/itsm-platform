from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.llm import StructuredLLM, get_llm
from app.core.db import get_session
from app.models import Ticket
from app.schemas import TicketOut
from app.services.tickets import sla_remaining_seconds

Session = Annotated[AsyncSession, Depends(get_session)]
LLM = Annotated[StructuredLLM, Depends(get_llm)]


def ticket_out(t: Ticket) -> TicketOut:
    return TicketOut.model_validate(
        {
            **{c: getattr(t, c) for c in TicketOut.model_fields if hasattr(t, c)},
            "sla_paused": t.sla_paused_at is not None,
            "sla_remaining_seconds": sla_remaining_seconds(t),
        }
    )
