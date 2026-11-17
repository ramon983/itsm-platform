"""SIEM webhook normalisation, signature verification and CMDB/ticket correlation."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden, PolicyViolation
from app.core.events import DomainEvent, get_event_bus
from app.models import SiemAlert, Ticket, TicketStatus, TicketType
from app.services import itam
from app.services.tickets import NewTicket, add_note, create_ticket

SEVERITY_TO_URGENCY = {"critical": 5, "high": 4, "medium": 3, "low": 2, "informational": 1}
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


@dataclass
class NormalisedAlert:
    source: str
    external_id: str
    title: str
    severity: str
    hosts: list[str] = field(default_factory=list)
    ips: list[str] = field(default_factory=list)
    users: list[str] = field(default_factory=list)


def verify_signature(secret: str, body: bytes, timestamp: str | None, signature: str | None,
                     max_skew: int) -> None:
    """HMAC-SHA256 over `{timestamp}.{body}`; header format `sha256=<hex>`."""
    if not timestamp or not signature:
        raise Forbidden("Missing signature headers")
    try:
        ts = int(timestamp)
    except ValueError as exc:
        raise Forbidden("Invalid timestamp") from exc
    if abs(time.time() - ts) > max_skew:
        raise Forbidden("Signature timestamp outside allowed window")
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(f"sha256={expected}", signature):
        raise Forbidden("Invalid signature")


def _norm_sev(value: Any) -> str:
    s = str(value or "medium").lower()
    return {"sev1": "critical", "sev2": "high", "sev3": "medium", "1": "critical", "2": "high", "3": "medium",
            "4": "low", "warn": "medium", "warning": "medium", "error": "high", "alert": "high",
            "info": "informational"}.get(s, s if s in SEVERITY_TO_URGENCY else "medium")


def _split_ips(values: list[str]) -> tuple[list[str], list[str]]:
    ips, hosts = [], []
    for v in values:
        try:
            ipaddress.ip_address(v)
            ips.append(v)
        except ValueError:
            hosts.append(v)
    return ips, hosts


def normalise(source: str, payload: dict[str, Any]) -> NormalisedAlert:
    if source == "splunk":
        r = payload.get("result", {})
        ips, hosts = _split_ips([x for x in [r.get("host"), r.get("src"), r.get("dest")] if x])
        return NormalisedAlert(
            "splunk", str(payload.get("sid") or payload.get("search_name")),
            str(payload.get("search_name", "Splunk alert")), _norm_sev(r.get("severity") or r.get("urgency")),
            hosts, ips, [u for u in [r.get("user")] if u],
        )
    if source == "sentinel":
        props = payload.get("properties", payload)
        hosts, ips, users = [], [], []
        for e in props.get("entities", []) or []:
            kind = str(e.get("kind") or e.get("type", "")).lower()
            if kind == "host" and e.get("hostName"):
                hosts.append(e["hostName"])
            elif kind == "ip" and e.get("address"):
                ips.append(e["address"])
            elif kind == "account":
                upn = e.get("upnSuffix") and e.get("accountName") and f"{e['accountName']}@{e['upnSuffix']}"
                if upn:
                    users.append(upn)
        return NormalisedAlert(
            "sentinel", str(props.get("systemAlertId") or props.get("incidentNumber") or payload.get("name")),
            str(props.get("alertDisplayName") or props.get("title", "Sentinel alert")),
            _norm_sev(props.get("severity")), hosts, ips, users,
        )
    if source == "datadog":
        tags = payload.get("tags", "")
        tag_list = tags.split(",") if isinstance(tags, str) else list(tags)
        hosts = [payload["hostname"]] if payload.get("hostname") else []
        hosts += [t.split(":", 1)[1] for t in tag_list if t.startswith("host:")]
        users = EMAIL_RE.findall(str(payload.get("body", "")))
        return NormalisedAlert(
            "datadog", str(payload.get("alert_id") or payload.get("id")),
            str(payload.get("title", "Datadog alert")), _norm_sev(payload.get("priority") or payload.get("alert_type")),
            sorted(set(hosts)), [], users,
        )
    raise PolicyViolation(f"Unsupported SIEM source {source!r}")


async def correlate(session: AsyncSession, alert: NormalisedAlert) -> SiemAlert:
    existing = (
        await session.execute(
            select(SiemAlert).where(SiemAlert.source == alert.source, SiemAlert.external_id == alert.external_id)
        )
    ).scalar_one_or_none()
    if existing:
        return existing  # idempotent re-delivery

    assets = await itam.match_indicators(session, alert.hosts, alert.ips, alert.users)
    open_ticket_ids: set[int] = set()
    for a in assets:
        open_ticket_ids.update(await itam.ticket_ids_for_asset(session, a.id))
    if open_ticket_ids:
        rows = await session.execute(
            select(Ticket).where(Ticket.id.in_(open_ticket_ids), Ticket.status != TicketStatus.RESOLVED_KB_LINKED)
        )
        open_tickets = list(rows.scalars())
    else:
        open_tickets = []

    record = SiemAlert(
        source=alert.source, external_id=alert.external_id, title=alert.title, severity=alert.severity,
        indicators={"hosts": alert.hosts, "ips": alert.ips, "users": alert.users},
        matched_asset_ids=[a.id for a in assets], linked_ticket_ids=[t.id for t in open_tickets],
    )
    session.add(record)
    await session.flush()

    for t in open_tickets:
        await add_note(session, t, f"siem:{alert.source}", f"[{alert.severity.upper()}] {alert.title}", kind="siem")

    urgency = SEVERITY_TO_URGENCY.get(alert.severity, 3)
    if not open_tickets and urgency >= 4:
        owner = next((a.owner_email for a in assets if a.owner_email), None) or "security@internal"
        ticket = await create_ticket(
            session,
            NewTicket(type=TicketType.INCIDENT, template_id="INC-SECURITY", title=f"[SIEM] {alert.title}",
                      description=f"Auto-created from {alert.source} alert {alert.external_id}.",
                      requester_email=owner, urgency=urgency, swarm_group="security"),
            actor=f"siem:{alert.source}",
        )
        for a in assets:
            await itam.link_ticket(session, a.id, ticket.id)
        record.linked_ticket_ids = [ticket.id]

    await session.flush()
    await get_event_bus().publish(
        DomainEvent("siem.alert_correlated", "siem_alert", str(record.id), f"siem:{alert.source}",
                    {"assets": record.matched_asset_ids, "tickets": record.linked_ticket_ids})
    )
    return record
