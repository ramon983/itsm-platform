"""Public API request/response models (OpenAPI contract)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import (
    AssetKind,
    ChangeRisk,
    DiscoverySource,
    ElevationStatus,
    LifecycleState,
    MdmStatus,
    TicketStatus,
    TicketType,
)


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ tickets


class TicketCreate(BaseModel):
    type: TicketType
    template_id: str = Field(max_length=64)
    title: str = Field(min_length=3, max_length=300)
    description: str = Field(min_length=1)
    requester_email: EmailStr
    urgency: int = Field(ge=1, le=5)
    swarm_group: str = Field(max_length=64)
    asset_ids: list[int] = Field(default_factory=list)


class TicketOut(ORM):
    id: int
    key: str
    type: TicketType
    template_id: str
    title: str
    description: str
    original_language: str
    original_text: str | None
    requester_email: str
    status: TicketStatus
    urgency: int
    sentiment: str | None
    swarm_group: str
    owner_email: str | None
    swarm_members: list[str]
    required_approvals: list[str]
    resolution_kb_key: str | None
    created_at: datetime
    sla_due_at: datetime
    sla_paused: bool
    sla_remaining_seconds: int


class TicketEventOut(ORM):
    id: int
    kind: str
    actor: str
    from_status: str | None
    to_status: str | None
    body: str | None
    data: dict[str, object]
    created_at: datetime


class TransitionRequest(BaseModel):
    to: TicketStatus
    note: str | None = Field(default=None, max_length=5000)
    kb_key: str | None = Field(default=None, description="Required when resolving")


class HandoffRequest(BaseModel):
    """Structured context note — every field mandatory, so no handoff is ever silent."""

    to_group: str = Field(min_length=2, max_length=64)
    to_owner_email: EmailStr | None = None
    reason: str = Field(min_length=10, max_length=2000)
    what_was_tried: str = Field(min_length=10, max_length=5000)
    next_step: str = Field(min_length=5, max_length=2000)


class NoteRequest(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


class SwarmBoard(BaseModel):
    group: str | None
    columns: dict[TicketStatus, list[TicketOut]]


# ------------------------------------------------------------------ changes


class ChangeCreate(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    description: str
    requester_email: EmailStr
    implementation_plan: str = Field(min_length=10)
    rollback_plan: str | None = None
    impact: int = Field(ge=1, le=5)
    affected_asset_ids: list[int] = Field(default_factory=list)
    tested_in_staging: bool
    outside_maintenance_window: bool = False
    touches_security_controls: bool = False
    recent_failed_changes_on_cis: int = Field(default=0, ge=0)
    jira_release_key: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9]+-\d+$|^[\w.-]+$")
    scheduled_start: datetime | None = None


class ChangeOut(ORM):
    id: int
    ticket_id: int
    risk_score: int
    risk_level: ChangeRisk
    cab_required: bool
    cab_approved_by: str | None
    jira_release_key: str | None
    risk_factors: dict[str, object]
    scheduled_start: datetime | None


# ------------------------------------------------------------------ KB


class KBCreate(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    body: str = Field(min_length=10)
    tags: list[str] = Field(default_factory=list)
    key: str | None = Field(default=None, pattern=r"^KB-\d+$")


class KBRevise(BaseModel):
    body: str = Field(min_length=10)
    change_note: str = Field(min_length=3, max_length=500)


class KBVersionOut(ORM):
    version: int
    body: str
    author: str
    change_note: str | None
    created_at: datetime


class KBOut(ORM):
    key: str
    title: str
    current_version: int
    tags: list[str]
    published: bool
    body: str


# ------------------------------------------------------------------ ITAM


class AssetCreate(BaseModel):
    tag: str = Field(min_length=1, max_length=64)
    kind: AssetKind
    name: str
    model: str | None = None
    serial_number: str | None = None
    hostname: str | None = None
    ip_address: str | None = None
    owner_email: EmailStr | None = None
    mdm_status: MdmStatus = MdmStatus.UNKNOWN
    os_version: str | None = None
    purchase_cost: Decimal | None = None
    warranty_expires: datetime | None = None
    attributes: dict[str, object] = Field(default_factory=dict)

    @field_validator("hostname")
    @classmethod
    def _lower(cls, v: str | None) -> str | None:
        return v.lower() if v else v


class AssetUpdate(BaseModel):
    owner_email: EmailStr | None = None
    mdm_status: MdmStatus | None = None
    os_version: str | None = None
    hostname: str | None = None
    ip_address: str | None = None
    attributes: dict[str, object] | None = None


class AssetOut(ORM):
    id: int
    tag: str
    kind: AssetKind
    name: str
    model: str | None
    serial_number: str | None
    hostname: str | None
    ip_address: str | None
    owner_email: str | None
    lifecycle_state: LifecycleState
    mdm_status: MdmStatus
    os_version: str | None
    purchase_cost: Decimal | None
    attributes: dict[str, object]


class LifecycleRequest(BaseModel):
    to: LifecycleState
    note: str | None = None


# ------------------------------------------------------------------ SaaS


class DiscoverySignalIn(BaseModel):
    user_email: EmailStr
    app_name: str
    domain: str
    source: DiscoverySource
    scopes: list[str] = Field(default_factory=list)
    seen_at: datetime | None = None


class SaaSAppOut(ORM):
    id: int
    name: str
    domain: str
    sanctioned: bool
    discovered_via: DiscoverySource
    cost_per_seat_month: Decimal
    oauth_scopes: list[str]


class SaaSAppUpdate(BaseModel):
    sanctioned: bool | None = None
    cost_per_seat_month: Decimal | None = Field(default=None, ge=0)
    owner_email: EmailStr | None = None


class ShadowItRow(BaseModel):
    app: SaaSAppOut
    active_users: int


class IdleSeatRow(BaseModel):
    seat_id: int
    user_email: str
    app: str
    domain: str
    last_active_at: datetime | None
    monthly_cost: Decimal


class ReclaimRequest(BaseModel):
    seat_ids: list[int] = Field(min_length=1, max_length=500)


class ReclaimResult(BaseModel):
    reclaimed: int
    monthly_savings: Decimal
    annual_savings: Decimal


# ------------------------------------------------------------------ vault


class VaultSecretCreate(BaseModel):
    name: str
    ciphertext: str = Field(description="Base64 AES-GCM blob encrypted client-side")
    key_wrap_id: str
    allowed_roles: list[str] = Field(min_length=1)
    asset_id: int | None = None


class VaultSecretMeta(ORM):
    id: int
    name: str
    allowed_roles: list[str]
    asset_id: int | None
    key_wrap_id: str


class VaultReveal(VaultSecretMeta):
    ciphertext: str
    expires_at: datetime | None = None


class ElevationRequest(BaseModel):
    secret_id: int
    ticket_id: int
    justification: str = Field(min_length=10, max_length=2000)


class ElevationDecision(BaseModel):
    approve: bool


class ElevationOut(ORM):
    id: int
    secret_id: int
    ticket_id: int
    requester_email: str
    status: ElevationStatus
    approver_email: str | None
    expires_at: datetime | None


class AuditOut(ORM):
    id: int
    action: str
    actor: str
    secret_id: int | None
    elevation_id: int | None
    ticket_id: int | None
    outcome: str
    detail: str | None
    created_at: datetime


# ------------------------------------------------------------------ SIEM


class SiemAlertOut(ORM):
    id: int
    source: str
    external_id: str
    title: str
    severity: str
    indicators: dict[str, list[str]]
    matched_asset_ids: list[int]
    linked_ticket_ids: list[int]


# ------------------------------------------------------------------ AI


class IntakeRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=20)
    submit: bool = Field(default=True, description="Create the ticket when the agent says it's ready")


class IntakeResponse(BaseModel):
    reply: str
    ticket: TicketOut | None
    analysis: dict[str, object]
