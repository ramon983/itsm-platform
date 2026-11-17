"""ITAM / CMDB, SaaS management, vault and SIEM records."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import JSON, Column, ForeignKey, Numeric, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

# ---------------------------------------------------------------- ITAM / CMDB


class AssetKind(StrEnum):
    HARDWARE = "hardware"
    SOFTWARE = "software"


class LifecycleState(StrEnum):
    PROCUREMENT = "PROCUREMENT"
    RECEIVED = "RECEIVED"
    DEPLOYED = "DEPLOYED"
    IN_REPAIR = "IN_REPAIR"
    RETIRED = "RETIRED"
    DISPOSED = "DISPOSED"


class MdmStatus(StrEnum):
    ENROLLED = "ENROLLED"
    NOT_ENROLLED = "NOT_ENROLLED"
    NON_COMPLIANT = "NON_COMPLIANT"
    UNKNOWN = "UNKNOWN"


asset_ticket_links = Table(
    "asset_ticket_links",
    Base.metadata,
    Column("asset_id", ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True),
    Column("ticket_id", ForeignKey("tickets.id", ondelete="CASCADE"), primary_key=True),
)


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    tag: Mapped[str] = mapped_column(String(64), unique=True)
    kind: Mapped[AssetKind] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(200))
    model: Mapped[str | None] = mapped_column(String(200))
    serial_number: Mapped[str | None] = mapped_column(String(128), index=True)
    hostname: Mapped[str | None] = mapped_column(String(255), index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), index=True)
    owner_email: Mapped[str | None] = mapped_column(String(320), index=True)
    lifecycle_state: Mapped[LifecycleState] = mapped_column(String(16), default=LifecycleState.PROCUREMENT)
    mdm_status: Mapped[MdmStatus] = mapped_column(String(16), default=MdmStatus.UNKNOWN)
    os_version: Mapped[str | None] = mapped_column(String(64))
    purchase_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    warranty_expires: Mapped[datetime | None]
    attributes: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class AssetLifecycleEvent(Base):
    __tablename__ = "asset_lifecycle_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), index=True)
    from_state: Mapped[str | None] = mapped_column(String(16))
    to_state: Mapped[str] = mapped_column(String(16))
    actor: Mapped[str] = mapped_column(String(320))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


# ---------------------------------------------------------------- SaaS management


class DiscoverySource(StrEnum):
    SSO = "sso"
    OAUTH = "oauth"
    EXPENSE = "expense"
    BROWSER = "browser"


class SaaSApp(Base):
    __tablename__ = "saas_apps"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    domain: Mapped[str] = mapped_column(String(255), unique=True)
    sanctioned: Mapped[bool] = mapped_column(default=False)
    discovered_via: Mapped[DiscoverySource] = mapped_column(String(16))
    cost_per_seat_month: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    owner_email: Mapped[str | None] = mapped_column(String(320))
    oauth_scopes: Mapped[list[str]] = mapped_column(JSON, default=list)
    first_seen_at: Mapped[datetime] = mapped_column(default=utcnow)


class SeatStatus(StrEnum):
    ACTIVE = "ACTIVE"
    RECLAIMED = "RECLAIMED"


class SaaSSeat(Base):
    __tablename__ = "saas_seats"
    __table_args__ = (UniqueConstraint("app_id", "user_email"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    app_id: Mapped[int] = mapped_column(ForeignKey("saas_apps.id", ondelete="CASCADE"), index=True)
    user_email: Mapped[str] = mapped_column(String(320), index=True)
    status: Mapped[SeatStatus] = mapped_column(String(16), default=SeatStatus.ACTIVE)
    last_active_at: Mapped[datetime | None]
    reclaimed_at: Mapped[datetime | None]
    reclaimed_by: Mapped[str | None] = mapped_column(String(320))


# ---------------------------------------------------------------- Zero-knowledge vault


class VaultSecret(Base):
    """Client-side encrypted credential. The server stores ciphertext only and never sees plaintext."""

    __tablename__ = "vault_secrets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    allowed_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    ciphertext: Mapped[str] = mapped_column(Text)  # base64 AES-GCM blob produced by the client
    key_wrap_id: Mapped[str] = mapped_column(String(128))  # identifies the client-held key envelope
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"))
    created_by: Mapped[str] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class ElevationStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    REVOKED = "REVOKED"


class VaultElevation(Base):
    __tablename__ = "vault_elevations"

    id: Mapped[int] = mapped_column(primary_key=True)
    secret_id: Mapped[int] = mapped_column(ForeignKey("vault_secrets.id"), index=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"), index=True)
    requester_email: Mapped[str] = mapped_column(String(320))
    justification: Mapped[str] = mapped_column(Text)
    status: Mapped[ElevationStatus] = mapped_column(String(16), default=ElevationStatus.PENDING)
    approver_email: Mapped[str | None] = mapped_column(String(320))
    requested_at: Mapped[datetime] = mapped_column(default=utcnow)
    approved_at: Mapped[datetime | None]
    expires_at: Mapped[datetime | None]


class VaultAuditLog(Base):
    """Append-only. Never updated or deleted by application code."""

    __tablename__ = "vault_audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    action: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(320))
    secret_id: Mapped[int | None]
    elevation_id: Mapped[int | None]
    ticket_id: Mapped[int | None]
    outcome: Mapped[str] = mapped_column(String(16))  # allowed | denied
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


# ---------------------------------------------------------------- SIEM


class SiemAlert(Base):
    __tablename__ = "siem_alerts"
    __table_args__ = (UniqueConstraint("source", "external_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(32))  # splunk | sentinel | datadog
    external_id: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(500))
    severity: Mapped[str] = mapped_column(String(16))
    indicators: Mapped[dict[str, list[str]]] = mapped_column(JSON, default=dict)
    matched_asset_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    linked_ticket_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    raw: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    received_at: Mapped[datetime] = mapped_column(default=utcnow)
