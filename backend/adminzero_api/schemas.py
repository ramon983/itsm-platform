"""Open API contract. Field names are snake_case on the wire; the frontend adapter maps them."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from adminzero_api.catalog import MacroId, SwarmSquad, TemplateId

Sentiment = Literal["Calm", "Frustrated", "Urgent Client Impact"]
Priority = Literal["P1", "P2", "P3", "P4"]
Engine = Literal["claude", "offline"]

# ------------------------------------------------------------------ intake


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class KbArticleIn(BaseModel):
    id: str = Field(pattern=r"^KB-\d+$")
    title: str
    summary: str = ""
    steps: list[str] = Field(default_factory=list)


class IntakeContext(BaseModel):
    assets: list[dict[str, Any]] = Field(default_factory=list, max_length=50)
    saas_apps: list[str] = Field(default_factory=list, max_length=50)
    kb_articles: list[KbArticleIn] = Field(default_factory=list, max_length=30)


class IntakeRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    requester_name: str = Field(default="there", max_length=200)
    requester_email: str | None = Field(default=None, max_length=320)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)
    context: IntakeContext = Field(default_factory=IntakeContext)


class IntakeOutput(BaseModel):
    """What Claude must return (structured output) — the JSON block from Runtime System Prompt 1."""

    reply: str
    detected_language: str = Field(description="BCP-47 code such as es, fr, ja, de, pt-BR")
    urgency_score: int = Field(description="1 (low) to 5 (critical)")
    sentiment: Sentiment
    selected_template_id: TemplateId
    english_summary_for_agent: str
    required_approvals: list[str]
    recommended_swarm_group: SwarmSquad
    clarifying_question: str | None
    self_service_kb_ids: list[str]


class IntakeAnalysis(BaseModel):
    detected_language: str
    urgency_score: int
    sentiment: Sentiment
    selected_template_id: TemplateId
    template_name: str
    ticket_type: Literal["INCIDENT", "SERVICE_REQUEST", "CHANGE"]
    priority: Priority
    english_summary_for_agent: str
    required_approvals: list[str]
    recommended_swarm_group: SwarmSquad
    clarifying_question: str | None
    self_service_kb_ids: list[str]


class IntakeResponse(BaseModel):
    reply: str
    analysis: IntakeAnalysis
    engine: Engine
    model: str | None = None
    fallback_reason: str | None = None


# ------------------------------------------------------------------ agent assist


class AssistMessage(BaseModel):
    sender: str
    role: str
    text: str
    lang: str = "en"
    translation: str | None = None


class AssistTicket(BaseModel):
    id: str
    title: str
    requester_name: str = "there"
    requester_language: str = "en"
    priority: Priority = "P3"
    linked_asset_id: str | None = None
    messages: list[AssistMessage] = Field(default_factory=list, max_length=60)


class ClosedTicketIn(BaseModel):
    id: str
    title: str
    resolution: str
    kb_id: str | None = None


class AssistRequest(BaseModel):
    ticket: AssistTicket
    kb_articles: list[KbArticleIn] = Field(default_factory=list, max_length=30)
    closed_tickets: list[ClosedTicketIn] = Field(default_factory=list, max_length=40)
    cmdb_assets: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    siem_alerts: list[dict[str, Any]] = Field(default_factory=list, max_length=20)


class Recommendation(BaseModel):
    action: str
    rationale: str
    kb_citations: list[str]


class MacroSuggestion(BaseModel):
    macro_id: MacroId
    reason: str
    kb_citations: list[str]


class JitSuggestion(BaseModel):
    credential: str
    reason: str


class AssistOutput(BaseModel):
    """What Claude must return for Runtime System Prompt 2."""

    summary: str
    recommendations: list[Recommendation]
    macro: MacroSuggestion | None
    jit_elevation: JitSuggestion | None
    draft_reply: str = Field(description="In the requester's language")
    draft_reply_english: str | None = Field(description="English side-by-side version, or null when the requester writes English")
    knowledge_gaps: list[str]


class AssistResponse(AssistOutput):
    rejected_ungrounded: list[str] = Field(default_factory=list)
    engine: Engine
    model: str | None = None
    fallback_reason: str | None = None


# ------------------------------------------------------------------ SIEM / SaaS / health


class MatchedAsset(BaseModel):
    id: str
    name: str
    owner_name: str | None
    owner_email: str | None


class IncidentDraft(BaseModel):
    """A ready-to-create P1. The caller (dashboard or ITSM DB) assigns the ticket ID."""

    priority: Priority
    title: str
    template_id: str
    swarm_squad: SwarmSquad
    requester_name: str
    requester_email: str
    linked_asset_id: str | None
    summary: str
    recommended_macro: dict[str, str] | None


class SiemAlertResponse(BaseModel):
    alert_id: str
    source: Literal["sentinel", "splunk", "datadog"]
    title: str
    severity: Literal["critical", "high", "medium", "low", "informational"]
    indicators: dict[str, list[str]]
    matched_assets: list[MatchedAsset]
    incident: IncidentDraft | None


class SaasAppOut(BaseModel):
    id: str
    name: str
    approved: bool
    provisioned_seats: int
    active_seats: int
    idle_seats: int
    monthly_cost: float
    annual_spend: float
    reclaimable_monthly: float
    renewal_days: int
    oauth_risk: str
    discovered_via: str


class SaasDiscoveryResponse(BaseModel):
    apps: list[SaasAppOut]
    totals: dict[str, float]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    environment: str
    secrets: dict[str, Any]
    ai: dict[str, Any]
