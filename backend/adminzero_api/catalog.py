"""Reference data shared with the frontend: predefined templates, macros, a CMDB snapshot and SaaS licences.

The CMDB and SaaS data mirror the frontend seed (`src/data/seed.ts`) so a SIEM alert or discovery call
against the live API correlates with the same assets and apps the dashboard shows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

SwarmSquad = Literal["Network & Identity", "Endpoint & Mac", "SaaS & Cloud Ops", "Security & SIEM"]
TicketType = Literal["INCIDENT", "SERVICE_REQUEST", "CHANGE"]
TemplateId = Literal["#INC-NET-04", "#SR-HW-01", "#SR-SAAS-09", "#CHG-SEC-02", "#INC-SEC-01", "#INC-GEN-01"]
MacroId = Literal[
    "macro-push-split-tunnel",
    "macro-assign-loaner",
    "macro-revoke-okta-sessions",
    "macro-isolate-endpoint",
    "macro-reuse-saas-seat",
]


@dataclass(frozen=True)
class Template:
    id: str
    name: str
    ticket_type: TicketType
    squad: SwarmSquad
    base_urgency: int
    approvals: tuple[str, ...]
    keywords: tuple[str, ...]


TEMPLATES: tuple[Template, ...] = (
    Template(
        "#INC-SEC-01",
        "Security incident (phishing / account compromise)",
        "INCIDENT",
        "Security & SIEM",
        5,
        ("Security on-call",),
        ("phishing", "hacked", "suspicious", "malware", "compromised", "mfa push", "sospechos", "piraté", "gehackt", "不審"),
    ),
    Template(
        "#CHG-SEC-02",
        "Emergency security change",
        "CHANGE",
        "Network & Identity",
        4,
        ("CAB (emergency)", "Service owner"),
        (
            "maintenance",
            "mantenimiento",
            "wartung",
            "fenêtre",
            "change request",
            "änderung",
            "certificat",
            "certific",
            "zertifikat",
            "証明書",
            "saml",
            "rotation",
            "rotate",
            "メンテナンス",
        ),
    ),
    Template(
        "#INC-NET-04",
        "VPN / network connectivity",
        "INCIDENT",
        "Network & Identity",
        4,
        (),
        ("vpn", "anyconnect", "wifi", "wi-fi", "network", "connect", "conect", "connexion", "réseau", "netz", "verbind", "接続", "rede"),
    ),
    Template(
        "#SR-HW-01",
        "Hardware damage / loaner device",
        "SERVICE_REQUEST",
        "Endpoint & Mac",
        3,
        ("Manager",),
        (
            "screen",
            "pantalla",
            "écran",
            "bildschirm",
            "画面",
            "cracked",
            "broken",
            "fissur",
            "roto",
            "kaputt",
            "laptop",
            "macbook",
            "ordinateur",
            "loaner",
            "prêt",
            "préstamo",
            "leihgerät",
            "代替機",
        ),
    ),
    Template(
        "#SR-SAAS-09",
        "SaaS licence / access request",
        "SERVICE_REQUEST",
        "SaaS & Cloud Ops",
        2,
        ("Manager (auto-approved: standard catalogue)",),
        (
            "licen",
            "lizenz",
            "ライセンス",
            "seat",
            "access",
            "acceso",
            "accès",
            "zugang",
            "figma",
            "slack",
            "salesforce",
            "notion",
            "datadog",
            "付与",
            "permission",
        ),
    ),
)
GENERIC = Template("#INC-GEN-01", "General IT request", "INCIDENT", "Endpoint & Mac", 3, (), ())
TEMPLATE_BY_ID = {t.id: t for t in (*TEMPLATES, GENERIC)}

MACROS: dict[str, str] = {
    "macro-push-split-tunnel": "Push the AnyConnect split-tunnel certificate to the device via Jamf",
    "macro-assign-loaner": "Assign a pre-imaged loaner and open an AppleCare+ claim",
    "macro-revoke-okta-sessions": "Revoke Okta sessions and force MFA re-enrolment",
    "macro-isolate-endpoint": "Network-isolate the endpoint via CrowdStrike (security incidents only)",
    "macro-reuse-saas-seat": "Reassign an idle SaaS seat via the Okta group",
}


@dataclass(frozen=True)
class Asset:
    id: str
    name: str
    hostname: str
    serial: str
    ip: str | None
    owner_email: str | None
    owner_name: str | None
    filevault: str


CMDB: tuple[Asset, ...] = (
    Asset(
        "MBP-0942",
        'MacBook Pro 14" M3 Pro',
        "maria-mbp",
        "C02FK3ZHMD6T",
        "10.20.4.42",
        "maria.gonzalez@adminzero.io",
        "María González",
        "Encrypted",
    ),
    Asset(
        "MBP-1004",
        'MacBook Pro 16" M3 Max',
        "camille-mbp",
        "C02GT1ABQ05D",
        "10.30.2.17",
        "camille.laurent@adminzero.io",
        "Camille Laurent",
        "Encrypted",
    ),
    Asset(
        "MBP-1188", 'MacBook Air 13" M3', "priya-mba", "FVFHK2Q1Q6L4", "10.40.1.88", "priya.shah@adminzero.io", "Priya Shah", "Encrypted"
    ),
    Asset("MBP-1120", 'MacBook Pro 14" M3 (Loaner)', "loaner-1120", "C02HN8LLMD6R", None, None, None, "Encrypted"),
    Asset("MERAKI-SW-01", "Meraki MS250-48FP Core Switch", "lis-f3-core", "Q2QN-7Y4L-9TZK", "10.50.0.1", None, None, "N/A"),
    Asset("IPH-0311", "iPhone 15 Pro", "lukas-iphone", "F4GZK9P2N7", None, "lukas.becker@adminzero.io", "Lukas Becker", "N/A"),
)


@dataclass
class SaasApp:
    id: str
    name: str
    approved: bool
    provisioned: int
    idle: int
    cost_per_seat_monthly: float
    renewal_days: int
    oauth_risk: Literal["Low", "Medium", "High"]
    discovered_via: str = "Okta SSO"
    owner: str = field(default="IT")


SAAS: tuple[SaasApp, ...] = (
    SaasApp("saas-figma", "Figma Enterprise", True, 48, 7, 75, 21, "Low", owner="Design Ops"),
    SaasApp(
        "saas-notion", "Notion AI (Shadow IT)", False, 23, 5, 20, 9, "High", discovered_via="Expense Report", owner="Unassigned (Marketing)"
    ),
    SaasApp("saas-okta", "Okta Workforce", True, 410, 8, 6, 200, "Low", owner="IAM"),
    SaasApp("saas-salesforce", "Salesforce Sales Cloud", True, 85, 12, 165, 14, "Medium", owner="RevOps"),
    SaasApp("saas-slack", "Slack Pro", True, 420, 18, 8.75, 120, "Low"),
    SaasApp("saas-datadog", "Datadog", True, 30, 3, 23, 45, "Medium", discovered_via="Google OAuth", owner="Platform Eng"),
)

# Minimal KB used by the offline engine when the caller doesn't send its own knowledge base.
DEFAULT_KB: tuple[dict[str, object], ...] = (
    {
        "id": "KB-402",
        "title": "Cisco AnyConnect drops: re-push split-tunnel certificate",
        "steps": [
            "Confirm the device cert expiry in Jamf.",
            "Run the split-tunnel certificate macro.",
            "Quit and reopen Cisco AnyConnect.",
        ],
    },
    {
        "id": "KB-388",
        "title": "MacBook screen damage: AppleCare+ claim and loaner swap",
        "steps": ["Check AppleCare+ coverage.", "Assign a pre-imaged loaner.", "Open the AppleCare+ repair."],
    },
    {
        "id": "KB-405",
        "title": "Granting a Figma Enterprise editor seat",
        "steps": ["Reclaim an idle Figma seat if available.", "Add the user to Okta group Figma Editors."],
    },
    {
        "id": "KB-421",
        "title": "Okta SAML signing certificate rotation (emergency change)",
        "steps": ["Generate the new signing cert.", "Stage metadata on all SPs.", "Activate during the approved window."],
    },
    {
        "id": "KB-430",
        "title": "MFA push-fatigue attack response",
        "steps": ["Revoke all Okta sessions and force factor re-enrolment.", "Isolate the endpoint if an approval succeeded."],
    },
)
