"""Predefined request templates, swarm groups and remediation macros the AI may choose from.

The AI selects from these closed sets (enforced by the structured-output schema); it never
invents a template, group or macro.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, get_args

from app.models import TicketType

TemplateId = Literal[
    "INC-GENERIC",
    "INC-HARDWARE",
    "INC-NETWORK",
    "INC-ACCOUNT-LOCKOUT",
    "INC-SAAS-OUTAGE",
    "INC-SECURITY",
    "SR-ACCESS-REQUEST",
    "SR-SOFTWARE-INSTALL",
    "SR-NEW-HARDWARE",
    "SR-ONBOARDING",
    "CHG-STANDARD",
    "CHG-NORMAL",
]
SwarmGroup = Literal["service-desk", "endpoint", "network", "identity", "saas-ops", "security", "change-mgmt"]
MacroId = Literal[
    "reset-mfa",
    "unlock-ad-account",
    "force-mdm-sync",
    "reprovision-saas-seat",
    "flush-dns-and-renew-dhcp",
    "collect-endpoint-diagnostics",
    "isolate-endpoint",
]


@dataclass(frozen=True)
class Template:
    id: str
    type: TicketType
    description: str
    required_fields: tuple[str, ...]
    default_approvals: tuple[str, ...] = ()


TEMPLATES: dict[str, Template] = {
    t.id: t
    for t in [
        Template("INC-GENERIC", TicketType.INCIDENT, "Something is broken that fits no other incident template",
                 ("what_is_broken", "since_when")),
        Template("INC-HARDWARE", TicketType.INCIDENT, "Laptop, monitor, peripheral or phone fault",
                 ("device", "symptom")),
        Template("INC-NETWORK", TicketType.INCIDENT, "Wi-Fi, VPN, connectivity or DNS problem",
                 ("location_or_network", "symptom")),
        Template("INC-ACCOUNT-LOCKOUT", TicketType.INCIDENT, "Cannot sign in, locked out, MFA problems",
                 ("system",)),
        Template("INC-SAAS-OUTAGE", TicketType.INCIDENT, "A SaaS application is down or erroring",
                 ("application", "symptom")),
        Template("INC-SECURITY", TicketType.INCIDENT, "Phishing, suspected compromise, lost device, malware",
                 ("what_happened",)),
        Template("SR-ACCESS-REQUEST", TicketType.SERVICE_REQUEST, "Access to an app, group, share or repository",
                 ("resource", "business_reason"), ("manager", "resource-owner")),
        Template("SR-SOFTWARE-INSTALL", TicketType.SERVICE_REQUEST, "Install or license software",
                 ("software",), ("manager",)),
        Template("SR-NEW-HARDWARE", TicketType.SERVICE_REQUEST, "New or replacement hardware",
                 ("item", "business_reason"), ("manager", "finance")),
        Template("SR-ONBOARDING", TicketType.SERVICE_REQUEST, "Onboard a new starter", ("start_date", "role"),
                 ("manager",)),
        Template("CHG-STANDARD", TicketType.CHANGE, "Pre-approved, low-risk, repeatable change", ("change",)),
        Template("CHG-NORMAL", TicketType.CHANGE, "Change requiring CAB risk assessment",
                 ("change", "systems_affected"), ("cab",)),
    ]
}

MACROS: dict[str, str] = {
    "reset-mfa": "Reset the user's MFA factors in the IdP and send re-enrolment link",
    "unlock-ad-account": "Unlock the directory account and clear bad-password count",
    "force-mdm-sync": "Push an MDM check-in and policy sync to the device",
    "reprovision-saas-seat": "Remove and re-add the user's SaaS seat via SCIM",
    "flush-dns-and-renew-dhcp": "Run DNS flush and DHCP renew on the endpoint via MDM script",
    "collect-endpoint-diagnostics": "Collect sysdiagnose / logs bundle from the endpoint",
    "isolate-endpoint": "Network-isolate the endpoint via EDR (security incidents only)",
}

assert set(TEMPLATES) == set(get_args(TemplateId))
assert set(MACROS) == set(get_args(MacroId))


def catalog_prompt() -> str:
    lines = ["<templates>"]
    for t in TEMPLATES.values():
        lines.append(f'  <template id="{t.id}" type="{t.type}" required="{", ".join(t.required_fields)}" '
                     f'approvals="{", ".join(t.default_approvals) or "none"}">{t.description}</template>')
    lines.append("</templates>")
    return "\n".join(lines)


def macros_prompt() -> str:
    return "<macros>\n" + "\n".join(f'  <macro id="{k}">{v}</macro>' for k, v in MACROS.items()) + "\n</macros>"
