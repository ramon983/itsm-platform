"""ITSM core: tickets, timeline, handoffs, changes, knowledge base."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import JSON, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, utcnow


class TicketType(StrEnum):
    INCIDENT = "INC"
    SERVICE_REQUEST = "SR"
    CHANGE = "CHG"


class TicketStatus(StrEnum):
    """The only five statuses a ticket can ever be in. No status zoo."""

    AI_TRIAGED = "AI_TRIAGED"
    ACTIVE_SWARM = "ACTIVE_SWARM"
    WAITING_ON_CUSTOMER = "WAITING_ON_CUSTOMER"  # SLA paused
    WAITING_ON_VENDOR = "WAITING_ON_VENDOR"  # SLA paused
    RESOLVED_KB_LINKED = "RESOLVED_KB_LINKED"


SLA_PAUSING_STATUSES = frozenset({TicketStatus.WAITING_ON_CUSTOMER, TicketStatus.WAITING_ON_VENDOR})


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[TicketType] = mapped_column(String(8))
    template_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text)
    original_language: Mapped[str] = mapped_column(String(16), default="en")
    original_text: Mapped[str | None] = mapped_column(Text)
    requester_email: Mapped[str] = mapped_column(String(320), index=True)
    status: Mapped[TicketStatus] = mapped_column(String(32), default=TicketStatus.AI_TRIAGED, index=True)
    urgency: Mapped[int] = mapped_column(default=3)  # 1 (low) .. 5 (critical)
    sentiment: Mapped[str | None] = mapped_column(String(32))
    swarm_group: Mapped[str] = mapped_column(String(64), index=True)
    owner_email: Mapped[str | None] = mapped_column(String(320))
    swarm_members: Mapped[list[str]] = mapped_column(JSON, default=list)
    required_approvals: Mapped[list[str]] = mapped_column(JSON, default=list)
    resolution_kb_key: Mapped[str | None] = mapped_column(ForeignKey("kb_articles.key"))
    resolution_note: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    sla_due_at: Mapped[datetime]
    sla_paused_at: Mapped[datetime | None]
    resolved_at: Mapped[datetime | None]

    events: Mapped[list[TicketEvent]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan", order_by="TicketEvent.id"
    )

    @property
    def key(self) -> str:
        return f"{self.type}-{1000 + self.id}"


class TicketEvent(Base):
    """Append-only ticket timeline (status changes, handoffs, notes, AI actions)."""

    __tablename__ = "ticket_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))  # status_change | handoff | note | ai | link
    actor: Mapped[str] = mapped_column(String(320))
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str | None] = mapped_column(String(32))
    body: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    ticket: Mapped[Ticket] = relationship(back_populates="events")


class ChangeRisk(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class ChangeRecord(Base):
    __tablename__ = "changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"), unique=True)
    risk_score: Mapped[int]
    risk_level: Mapped[ChangeRisk] = mapped_column(String(8))
    cab_required: Mapped[bool]
    cab_approved_by: Mapped[str | None] = mapped_column(String(320))
    jira_release_key: Mapped[str | None] = mapped_column(String(64))
    implementation_plan: Mapped[str] = mapped_column(Text)
    rollback_plan: Mapped[str | None] = mapped_column(Text)
    scheduled_start: Mapped[datetime | None]
    risk_factors: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)


class KBArticle(Base):
    __tablename__ = "kb_articles"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(32), unique=True)  # e.g. KB-402
    title: Mapped[str] = mapped_column(String(300))
    current_version: Mapped[int] = mapped_column(default=1)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    published: Mapped[bool] = mapped_column(default=True)

    versions: Mapped[list[KBArticleVersion]] = relationship(
        back_populates="article", cascade="all, delete-orphan", order_by="KBArticleVersion.version"
    )


class KBArticleVersion(Base):
    __tablename__ = "kb_article_versions"
    __table_args__ = (UniqueConstraint("article_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("kb_articles.id", ondelete="CASCADE"))
    version: Mapped[int]
    body: Mapped[str] = mapped_column(Text)
    author: Mapped[str] = mapped_column(String(320))
    change_note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    article: Mapped[KBArticle] = relationship(back_populates="versions")
