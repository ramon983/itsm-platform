"""Signed SIEM webhook: HMAC verification, vendor normalisation, CMDB correlation, P1 incident draft."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from adminzero_api.catalog import CMDB, Asset
from adminzero_api.schemas import IncidentDraft, MatchedAsset, SiemAlertResponse

Source = Literal["sentinel", "splunk", "datadog"]
Severity = Literal["critical", "high", "medium", "low", "informational"]
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


class SignatureError(Exception):
    pass


def sign(secret: str, timestamp: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def verify_signature(
    secret: str, body: bytes, timestamp: str | None, signature: str | None, max_skew: int, now: float | None = None
) -> None:
    """HMAC-SHA256 over `{timestamp}.{raw body}`; header `X-AdminZero-Signature: sha256=<hex>`. Rejects replays outside the window."""
    if not timestamp or not signature:
        raise SignatureError("Missing X-AdminZero-Timestamp or X-AdminZero-Signature")
    if not timestamp.isdigit():
        raise SignatureError("Invalid timestamp")
    if abs((now or time.time()) - int(timestamp)) > max_skew:
        raise SignatureError("Timestamp outside the allowed window (possible replay)")
    if not hmac.compare_digest(sign(secret, timestamp, body), signature):
        raise SignatureError("Invalid signature")


@dataclass
class Normalised:
    source: Source
    alert_id: str
    title: str
    severity: Severity
    hosts: list[str] = field(default_factory=list)
    ips: list[str] = field(default_factory=list)
    users: list[str] = field(default_factory=list)


def _sev(value: Any) -> Severity:
    s = str(value or "medium").lower()
    mapped = {
        "sev1": "critical",
        "sev2": "high",
        "1": "critical",
        "2": "high",
        "3": "medium",
        "4": "low",
        "warning": "medium",
        "error": "high",
        "info": "informational",
    }.get(s, s)
    return mapped if mapped in {"critical", "high", "medium", "low", "informational"} else "medium"  # type: ignore[return-value]


def _split(values: list[str]) -> tuple[list[str], list[str]]:
    ips, hosts = [], []
    for v in values:
        try:
            ipaddress.ip_address(v)
            ips.append(v)
        except ValueError:
            hosts.append(v)
    return ips, hosts


def normalise(source: Source, payload: dict[str, Any]) -> Normalised:
    if source == "sentinel":
        props = payload.get("properties", payload)
        hosts, ips, users = [], [], []
        for e in props.get("entities") or []:
            kind = str(e.get("kind") or e.get("type", "")).lower()
            if kind == "host" and e.get("hostName"):
                hosts.append(str(e["hostName"]))
            elif kind == "ip" and e.get("address"):
                ips.append(str(e["address"]))
            elif kind == "account":
                if e.get("upn"):
                    users.append(str(e["upn"]))
                elif e.get("accountName") and e.get("upnSuffix"):
                    users.append(f"{e['accountName']}@{e['upnSuffix']}")
        return Normalised(
            "sentinel",
            str(props.get("systemAlertId") or props.get("alertId") or "sentinel-alert"),
            str(props.get("alertDisplayName") or props.get("title") or "Sentinel alert"),
            _sev(props.get("severity")),
            hosts,
            ips,
            users,
        )
    if source == "splunk":
        r = payload.get("result", {})
        ips, hosts = _split([str(x) for x in (r.get("host"), r.get("src"), r.get("dest")) if x])
        return Normalised(
            "splunk",
            str(payload.get("sid") or payload.get("search_name") or "splunk-alert"),
            str(payload.get("search_name") or "Splunk alert"),
            _sev(r.get("severity") or r.get("urgency")),
            hosts,
            ips,
            [str(r["user"])] if r.get("user") else [],
        )
    tags = payload.get("tags", "")
    tag_list = tags.split(",") if isinstance(tags, str) else list(tags)
    hosts = ([str(payload["hostname"])] if payload.get("hostname") else []) + [
        t.split(":", 1)[1] for t in tag_list if t.startswith("host:")
    ]
    return Normalised(
        "datadog",
        str(payload.get("alert_id") or payload.get("id") or "datadog-alert"),
        str(payload.get("title") or "Datadog alert"),
        _sev(payload.get("priority") or payload.get("alert_type")),
        sorted(set(hosts)),
        [],
        EMAIL.findall(str(payload.get("body", ""))),
    )


def correlate(alert: Normalised, cmdb: tuple[Asset, ...] = CMDB) -> list[Asset]:
    hosts = {h.lower() for h in alert.hosts}
    users = {u.lower() for u in alert.users}
    return [
        a
        for a in cmdb
        if a.hostname.lower() in hosts
        or a.id.lower() in hosts
        or a.serial.lower() in hosts
        or (a.ip and a.ip in alert.ips)
        or (a.owner_email and a.owner_email.lower() in users)
    ]


def build_response(alert: Normalised) -> SiemAlertResponse:
    matched = correlate(alert)
    primary = next((a for a in matched if a.owner_email), matched[0] if matched else None)
    incident = None
    if alert.severity in {"critical", "high"}:
        mfa = any(w in alert.title.lower() for w in ("mfa", "brute", "fatigue", "push"))
        incident = IncidentDraft(
            priority="P1",
            title=f"{alert.source.title()}: {alert.title}"
            + (f" on {primary.id} ({primary.owner_name})" if primary and primary.owner_name else f" on {primary.id}" if primary else ""),
            template_id="#INC-SEC-01",
            swarm_squad="Security & SIEM",
            requester_name={"sentinel": "Microsoft Sentinel", "splunk": "Splunk", "datadog": "Datadog"}[alert.source],
            requester_email="soc-alerts@adminzero.io",
            linked_asset_id=primary.id if primary else None,
            summary=f"{alert.severity.upper()} alert {alert.alert_id}. Indicators — hosts: {', '.join(alert.hosts) or '—'}; IPs: {', '.join(alert.ips) or '—'}; users: {', '.join(alert.users) or '—'}. "
            + (f"Correlated with CMDB {primary.id} ({primary.name}, FileVault {primary.filevault})." if primary else "No CMDB match."),
            recommended_macro=(
                {
                    "id": "macro-revoke-okta-sessions",
                    "label": "Revoke Okta sessions & force MFA re-enrolment",
                    "command": f"okta users sessions revoke {primary.owner_email}",
                }
                if mfa and primary and primary.owner_email
                else {
                    "id": "macro-isolate-endpoint",
                    "label": f"Isolate {primary.id} via CrowdStrike",
                    "command": f"falconctl contain --host {primary.hostname}",
                }
                if primary
                else None
            ),
        )
    return SiemAlertResponse(
        alert_id=alert.alert_id,
        source=alert.source,
        title=alert.title,
        severity=alert.severity,
        indicators={"hosts": alert.hosts, "ips": alert.ips, "users": alert.users},
        matched_assets=[MatchedAsset(id=a.id, name=a.name, owner_name=a.owner_name, owner_email=a.owner_email) for a in matched],
        incident=incident,
    )
