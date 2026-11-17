from __future__ import annotations

import json
import time

import pytest
from httpx import AsyncClient

from adminzero_api import siem
from adminzero_api.llm import ClaudeUnavailable
from adminzero_api.schemas import AssistOutput, IntakeOutput, MacroSuggestion, Recommendation
from adminzero_api.secrets import GcpSecretManagerProvider
from tests.conftest import FakeClaude

PRESETS = [
    (
        "Hola, no puedo conectarme a la VPN desde esta mañana y tengo una presentación con un cliente en 45 minutos.",
        "es",
        "#INC-NET-04",
        "P1",
    ),
    (
        "Bonjour, mon écran MacBook Pro est fissuré, j'ai besoin d'un ordinateur de prêt avant mon déplacement jeudi.",
        "fr",
        "#SR-HW-01",
        "P3",
    ),
    ("来週のデザインスプリントのためにFigmaの編集ライセンスを付与してください。", "ja", "#SR-SAAS-09", "P4"),
    ("Wir benötigen heute Abend um 22:00 Uhr ein Notfall-Wartungsfenster für das Okta SAML-Zertifikat.", "de", "#CHG-SEC-02", "P2"),
]


async def test_health_reports_secret_names_never_values(client: AsyncClient) -> None:
    r = await client.get("/api/v1/health")
    body = r.json()
    assert body["secrets"]["source"] == "env_local"
    assert body["secrets"]["resolved"] == {
        "ANTHROPIC_API_KEY": False,
        "DATABASE_URL": False,
        "SIEM_WEBHOOK_SECRET": True,
        "VAULT_KMS_KEY": False,
    }
    assert "test-siem-secret" not in r.text
    assert body["ai"] == {"engine": "offline", "model": None}


@pytest.mark.parametrize(("message", "lang", "template", "priority"), PRESETS)
async def test_intake_offline_maps_presets(client: AsyncClient, message: str, lang: str, template: str, priority: str) -> None:
    r = await client.post("/api/v1/tickets/intake", json={"message": message, "requester_name": "Test User"})
    body = r.json()
    assert body["engine"] == "offline" and body["fallback_reason"] == "no_api_key"
    a = body["analysis"]
    assert (a["detected_language"], a["selected_template_id"], a["priority"]) == (lang, template, priority)
    assert body["reply"].startswith({"es": "Hola Test", "fr": "Bonjour Test", "ja": "Testさん", "de": "Hallo Test"}[lang])


async def test_intake_offline_offers_only_kb_backed_self_service(client: AsyncClient) -> None:
    r = await client.post("/api/v1/tickets/intake", json={"message": PRESETS[0][0], "requester_name": "María"})
    assert r.json()["analysis"]["self_service_kb_ids"] == ["KB-402"]
    assert "KB-402" in r.json()["reply"]


async def test_intake_uses_claude_with_exact_prompt_and_guards_citations(client: AsyncClient, fake_claude: FakeClaude) -> None:
    fake_claude.outputs["IntakeOutput"] = IntakeOutput(
        reply="¡Hola María! Lo siento mucho…",
        detected_language="es",
        urgency_score=9,
        sentiment="Urgent Client Impact",
        selected_template_id="#INC-NET-04",
        english_summary_for_agent="VPN down before client pitch",
        required_approvals=[],
        recommended_swarm_group="Network & Identity",
        clarifying_question=None,
        self_service_kb_ids=["KB-402", "KB-999"],
    )
    r = await client.post(
        "/api/v1/tickets/intake",
        json={"message": PRESETS[0][0], "context": {"kb_articles": [{"id": "KB-402", "title": "VPN", "steps": ["Reopen AnyConnect"]}]}},
    )
    body = r.json()
    assert body["engine"] == "claude" and body["model"] == "claude-opus-5-5"
    assert body["analysis"]["urgency_score"] == 5 and body["analysis"]["priority"] == "P1"
    assert body["analysis"]["self_service_kb_ids"] == ["KB-402"]  # hallucinated KB-999 stripped
    call = fake_claude.calls[0]
    assert call["system"].startswith("You are the AdminZero Conversational Intake Agent.")
    assert "Ask at most ONE clarifying question" in call["system"]
    assert call["effort"] == "low"
    assert "<user_message>" in call["messages"][-1]["content"]


async def test_intake_falls_back_when_claude_refuses(client: AsyncClient, fake_claude: FakeClaude) -> None:
    fake_claude.outputs["IntakeOutput"] = ClaudeUnavailable("refusal")
    body = (await client.post("/api/v1/tickets/intake", json={"message": PRESETS[1][0]})).json()
    assert body["engine"] == "offline" and body["fallback_reason"] == "refusal"
    assert body["analysis"]["selected_template_id"] == "#SR-HW-01"


ASSIST = {
    "ticket": {
        "id": "INC-1049",
        "title": "VPN failing before client pitch",
        "requester_name": "María González",
        "requester_language": "es",
        "linked_asset_id": "MBP-0942",
        "messages": [
            {
                "sender": "María",
                "role": "end_user",
                "text": "No puedo conectarme a la VPN",
                "lang": "es",
                "translation": "I can't connect to the VPN",
            }
        ],
    },
    "kb_articles": [
        {
            "id": "KB-402",
            "title": "Cisco AnyConnect drops: re-push split-tunnel certificate",
            "summary": "VPN fails when the certificate expires",
            "steps": ["Confirm the device cert expiry in Jamf.", "Run the split-tunnel certificate macro."],
        }
    ],
    "closed_tickets": [
        {"id": "INC-975", "title": "AnyConnect VPN fails at authentication", "resolution": "Re-pushed certificate", "kb_id": "KB-402"}
    ],
}


async def test_assist_offline_is_grounded_and_bilingual(client: AsyncClient) -> None:
    body = (await client.post("/api/v1/agent/assist", json=ASSIST)).json()
    assert body["engine"] == "offline"
    assert body["recommendations"] and all(r["kb_citations"] == ["KB-402"] for r in body["recommendations"])
    assert body["macro"]["macro_id"] == "macro-push-split-tunnel"
    assert body["jit_elevation"]["credential"] == "Local Admin · MBP-0942"
    assert body["draft_reply"].startswith("Hola María") and body["draft_reply_english"].startswith("Hi María")


async def test_assist_claude_uses_exact_prompt_and_drops_ungrounded(client: AsyncClient, fake_claude: FakeClaude) -> None:
    fake_claude.outputs["AssistOutput"] = AssistOutput(
        summary="Expired split-tunnel cert on MBP-0942.",
        recommendations=[
            Recommendation(action="Run the split-tunnel macro", rationale="KB-402", kb_citations=["KB-402"]),
            Recommendation(action="netsh winsock reset", rationale="guess", kb_citations=[]),
        ],
        macro=MacroSuggestion(macro_id="macro-isolate-endpoint", reason="?", kb_citations=["KB-777"]),
        jit_elevation=None,
        draft_reply="Hola María…",
        draft_reply_english="Hi María…",
        knowledge_gaps=[],
    )
    body = (await client.post("/api/v1/agent/assist", json=ASSIST)).json()
    assert body["engine"] == "claude"
    assert [r["action"] for r in body["recommendations"]] == ["Run the split-tunnel macro"]
    assert body["macro"] is None
    assert set(body["rejected_ungrounded"]) == {"netsh winsock reset", "macro:macro-isolate-endpoint"}
    assert fake_claude.calls[0]["system"].startswith("You are the AdminZero Agent-Assist Copilot.")
    assert fake_claude.calls[0]["effort"] == "medium"


def _signed(payload: dict, secret: str = "test-siem-secret", ts: int | None = None) -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(payload).encode()
    stamp = str(ts or int(time.time()))
    return raw, {"X-AdminZero-Timestamp": stamp, "X-AdminZero-Signature": siem.sign(secret, stamp, raw), "Content-Type": "application/json"}


SENTINEL = {
    "properties": {
        "systemAlertId": "sent-77",
        "alertDisplayName": "Okta MFA brute force",
        "severity": "High",
        "entities": [{"kind": "Host", "hostName": "maria-mbp"}, {"kind": "Ip", "address": "45.83.12.9"}],
    }
}


async def test_siem_webhook_correlates_to_mbp_0942_and_drafts_p1(client: AsyncClient) -> None:
    raw, headers = _signed(SENTINEL)
    r = await client.post("/api/v1/siem/webhook?source=sentinel", content=raw, headers=headers)
    assert r.status_code == 202, r.text
    body = r.json()
    assert [a["id"] for a in body["matched_assets"]] == ["MBP-0942"]
    inc = body["incident"]
    assert inc["priority"] == "P1" and inc["linked_asset_id"] == "MBP-0942" and inc["swarm_squad"] == "Security & SIEM"
    assert inc["recommended_macro"]["id"] == "macro-revoke-okta-sessions"


@pytest.mark.parametrize(("secret", "age"), [("wrong-secret", 0), ("test-siem-secret", 3600)])
async def test_siem_webhook_rejects_bad_or_replayed_signatures(client: AsyncClient, secret: str, age: int) -> None:
    raw, headers = _signed(SENTINEL, secret=secret, ts=int(time.time()) - age)
    assert (await client.post("/api/v1/siem/webhook?source=sentinel", content=raw, headers=headers)).status_code == 401


async def test_siem_splunk_and_datadog_normalise(client: AsyncClient) -> None:
    raw, headers = _signed({"sid": "s1", "search_name": "Suspicious PowerShell", "result": {"host": "10.40.1.88", "severity": "critical"}})
    assert (await client.post("/api/v1/siem/webhook?source=splunk", content=raw, headers=headers)).json()["matched_assets"][0][
        "id"
    ] == "MBP-1188"
    raw, headers = _signed({"id": "d1", "title": "Disk full", "priority": "low", "tags": "host:lis-f3-core,env:prod"})
    body = (await client.post("/api/v1/siem/webhook?source=datadog", content=raw, headers=headers)).json()
    assert body["matched_assets"][0]["id"] == "MERAKI-SW-01" and body["incident"] is None  # low severity → no P1


async def test_saas_discovery_totals(client: AsyncClient) -> None:
    body = (await client.get("/api/v1/saas/discovery")).json()
    assert len(body["apps"]) == 6
    assert body["totals"]["idle_seats"] == 53
    assert body["totals"]["reclaimable_monthly"] == 2879.5  # dashboard KPI shows this rounded: $2,880
    assert body["totals"]["shadow_it_apps"] == 1


async def test_cors_allows_github_pages_only(client: AsyncClient) -> None:
    ok = await client.options("/api/v1/health", headers={"Origin": "https://ramon983.github.io", "Access-Control-Request-Method": "GET"})
    assert ok.headers["access-control-allow-origin"] == "https://ramon983.github.io"
    bad = await client.options("/api/v1/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


async def test_ai_endpoints_are_rate_limited(client: AsyncClient) -> None:
    codes = [(await client.post("/api/v1/tickets/intake", json={"message": "help"})).status_code for _ in range(21)]
    assert codes[:20] == [200] * 20 and codes[20] == 429


def test_secret_manager_provider_reads_latest_version() -> None:
    class Payload:
        data = b"sk-from-secret-manager"

    class FakeSM:
        def __init__(self) -> None:
            self.paths: list[str] = []

        def access_secret_version(self, request: dict[str, str]) -> object:
            self.paths.append(request["name"])
            return type("Resp", (), {"payload": Payload()})()

    sm = FakeSM()
    provider = GcpSecretManagerProvider("adminzero-prod", client=sm)
    assert provider.get("ANTHROPIC_API_KEY") == "sk-from-secret-manager"
    provider.get("ANTHROPIC_API_KEY")  # cached
    assert sm.paths == ["projects/adminzero-prod/secrets/ANTHROPIC_API_KEY/versions/latest"]
