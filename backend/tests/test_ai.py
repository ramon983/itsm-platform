from __future__ import annotations

from httpx import AsyncClient

from app.ai.agents import CopilotResult, IntakeResult, JitSuggestion, MacroSuggestion, Recommendation
from tests.conftest import ADMIN, AGENT, USER, FakeLLM, make_kb, make_ticket


def _intake(**kw: object) -> IntakeResult:
    base = dict(
        reply_to_user="¡Hola María! Siento mucho lo del VPN. Ya estoy preparando tu ticket.",
        detected_language="es", urgency_score=9, sentiment="frustrated", selected_template_id="INC-NETWORK",
        title_for_agent="VPN drops every 10 minutes", english_summary_for_agent="User's VPN disconnects.",
        required_approvals=[], recommended_swarm_group="network", self_service_kb_ids=["KB-402", "KB-999"],
        clarifying_question=None, ready_to_submit=True,
    )
    return IntakeResult.model_validate({**base, **kw})


async def test_intake_creates_ticket_in_user_language(client: AsyncClient, fake_llm: FakeLLM) -> None:
    await make_kb(client)
    await client.post("/api/v1/assets", headers=AGENT, json={"tag": "LT-1", "kind": "hardware",
                                                              "name": "ThinkPad", "owner_email": "maria@corp.com"})
    fake_llm.responses["IntakeResult"] = _intake()
    r = await client.post("/api/v1/ai/intake", headers=USER,
                          json={"message": "El VPN se desconecta cada 10 minutos y no puedo trabajar"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply"].startswith("¡Hola")
    t = body["ticket"]
    assert t["status"] == "AI_TRIAGED" and t["original_language"] == "es" and t["urgency"] == 5
    assert t["original_text"].startswith("El VPN")
    assert body["analysis"]["self_service_kb_ids"] == ["KB-402"]  # hallucinated KB-999 stripped

    sent = fake_llm.calls[0]["messages"][-1]["content"]
    assert "<cmdb_context>" in sent and "ThinkPad" in sent and "KB-402" in sent


async def test_intake_clarifying_question_does_not_create_ticket(client: AsyncClient, fake_llm: FakeLLM) -> None:
    fake_llm.responses["IntakeResult"] = _intake(ready_to_submit=False, clarifying_question="¿Qué aplicación?")
    r = await client.post("/api/v1/ai/intake", headers=USER, json={"message": "no funciona"})
    assert r.json()["ticket"] is None


async def test_copilot_drops_ungrounded_recommendations(client: AsyncClient, fake_llm: FakeLLM) -> None:
    await make_kb(client)
    a = (await client.post("/api/v1/assets", headers=AGENT, json={
        "tag": "LT-9", "kind": "hardware", "name": "MacBook", "hostname": "maria-mbp"})).json()
    secret = (await client.post("/api/v1/vault/secrets", headers=ADMIN, json={
        "name": "Local admin", "ciphertext": "eA==", "key_wrap_id": "kw", "allowed_roles": ["agent"],
        "asset_id": a["id"]})).json()
    t = await make_ticket(client, asset_ids=[a["id"]])

    fake_llm.responses["CopilotResult"] = CopilotResult(
        ticket_summary="VPN drops on maria-mbp.",
        recommendations=[
            Recommendation(action="Flush DNS and renew DHCP", rationale="Per KB", kb_citations=["KB-402"],
                           evidence=["mdm: ENROLLED"]),
            Recommendation(action="Run netsh winsock reset", rationale="guess", kb_citations=[], evidence=[]),
        ],
        macros=[MacroSuggestion(macro_id="flush-dns-and-renew-dhcp", reason="KB step", kb_citations=["KB-402"]),
                MacroSuggestion(macro_id="isolate-endpoint", reason="?", kb_citations=["KB-777"])],
        jit_elevation=JitSuggestion(secret_id=secret["id"], reason="Needs local admin"),
        draft_reply="Hola María, ...", draft_reply_english="Hi Maria, ...", knowledge_gaps=[],
    )
    r = await client.post(f"/api/v1/ai/copilot/{t['id']}", headers=AGENT)
    assert r.status_code == 200, r.text
    out = r.json()
    assert [x["action"] for x in out["recommendations"]] == ["Flush DNS and renew DHCP"]
    assert [m["macro_id"] for m in out["macros"]] == ["flush-dns-and-renew-dhcp"]
    assert out["jit_elevation"]["secret_id"] == secret["id"]
    assert set(out["rejected_ungrounded"]) == {"Run netsh winsock reset", "macro:isolate-endpoint"}
    assert fake_llm.calls[0]["effort"] == "medium"
    assert "<vault_credentials>" in fake_llm.calls[0]["messages"][0]["content"]


async def test_copilot_requires_agent(client: AsyncClient) -> None:
    t = await make_ticket(client)
    assert (await client.post(f"/api/v1/ai/copilot/{t['id']}", headers=USER)).status_code == 403
