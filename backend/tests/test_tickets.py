from __future__ import annotations

from datetime import datetime, timedelta

from httpx import AsyncClient

from app.core.events import InMemoryEventBus
from app.models import ChangeRisk
from app.services.changes import RiskInputs, score_change
from tests.conftest import AGENT, AGENT2, APPROVER, USER, make_kb, make_ticket


async def test_ticket_starts_ai_triaged_with_sla(client: AsyncClient) -> None:
    t = await make_ticket(client, urgency=4)
    assert t["status"] == "AI_TRIAGED"
    assert t["key"].startswith("INC-")
    assert 7 * 3600 < t["sla_remaining_seconds"] <= 8 * 3600


async def test_disallowed_transition_rejected(client: AsyncClient) -> None:
    t = await make_ticket(client)
    r = await client.post(f"/api/v1/tickets/{t['id']}/transition", json={"to": "WAITING_ON_VENDOR"}, headers=AGENT)
    assert r.status_code == 409


async def test_unknown_status_rejected(client: AsyncClient) -> None:
    t = await make_ticket(client)
    r = await client.post(f"/api/v1/tickets/{t['id']}/transition", json={"to": "PENDING_REVIEW"}, headers=AGENT)
    assert r.status_code == 422


async def test_waiting_statuses_pause_sla_and_resume_extends_due(client: AsyncClient) -> None:
    t = await make_ticket(client)
    tid = t["id"]
    await client.post(f"/api/v1/tickets/{tid}/transition", json={"to": "ACTIVE_SWARM"}, headers=AGENT)
    r = await client.post(f"/api/v1/tickets/{tid}/transition", json={"to": "WAITING_ON_CUSTOMER"}, headers=AGENT)
    paused = r.json()
    assert paused["sla_paused"] is True
    r = await client.post(f"/api/v1/tickets/{tid}/transition", json={"to": "ACTIVE_SWARM"}, headers=AGENT)
    resumed = r.json()
    assert resumed["sla_paused"] is False
    assert datetime.fromisoformat(resumed["sla_due_at"]) >= datetime.fromisoformat(t["sla_due_at"])


async def test_resolution_requires_kb_link(client: AsyncClient) -> None:
    t = await make_ticket(client)
    tid = t["id"]
    await client.post(f"/api/v1/tickets/{tid}/transition", json={"to": "ACTIVE_SWARM"}, headers=AGENT)
    r = await client.post(f"/api/v1/tickets/{tid}/transition", json={"to": "RESOLVED_KB_LINKED"}, headers=AGENT)
    assert r.status_code == 422
    r = await client.post(f"/api/v1/tickets/{tid}/transition",
                          json={"to": "RESOLVED_KB_LINKED", "kb_key": "KB-999"}, headers=AGENT)
    assert r.status_code == 422
    await make_kb(client)
    r = await client.post(f"/api/v1/tickets/{tid}/transition",
                          json={"to": "RESOLVED_KB_LINKED", "kb_key": "KB-402"}, headers=AGENT)
    assert r.status_code == 200
    assert r.json()["resolution_kb_key"] == "KB-402"


async def test_handoff_requires_structured_context(client: AsyncClient) -> None:
    t = await make_ticket(client)
    r = await client.post(f"/api/v1/tickets/{t['id']}/handoff", json={"to_group": "identity"}, headers=AGENT)
    assert r.status_code == 422


async def test_handoff_records_context_and_updates_status(client: AsyncClient, events: InMemoryEventBus) -> None:
    t = await make_ticket(client)
    tid = t["id"]
    await client.post(f"/api/v1/tickets/{tid}/transition", json={"to": "ACTIVE_SWARM"}, headers=AGENT)
    await client.post(f"/api/v1/tickets/{tid}/transition", json={"to": "WAITING_ON_CUSTOMER"}, headers=AGENT)
    r = await client.post(
        f"/api/v1/tickets/{tid}/handoff",
        json={"to_group": "identity", "reason": "Looks like a certificate auth failure",
              "what_was_tried": "Reinstalled VPN client, flushed DNS", "next_step": "Check RADIUS logs"},
        headers=AGENT,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["swarm_group"] == "identity"
    assert body["status"] == "ACTIVE_SWARM"
    assert body["sla_paused"] is False

    tl = (await client.get(f"/api/v1/tickets/{tid}/timeline", headers=AGENT)).json()
    handoffs = [e for e in tl if e["kind"] == "handoff"]
    assert handoffs and handoffs[0]["data"]["what_was_tried"].startswith("Reinstalled")
    assert any(e.type == "ticket.handed_off" for e in events.events)


async def test_swarm_board_groups_by_status_not_assignee(client: AsyncClient) -> None:
    t = await make_ticket(client)
    await client.post(f"/api/v1/tickets/{t['id']}/swarm", headers=AGENT)
    await client.post(f"/api/v1/tickets/{t['id']}/swarm", headers=AGENT2)
    board = (await client.get("/api/v1/tickets/board", headers=AGENT)).json()
    assert set(board["columns"]) == {"AI_TRIAGED", "ACTIVE_SWARM", "WAITING_ON_CUSTOMER", "WAITING_ON_VENDOR",
                                     "RESOLVED_KB_LINKED"}
    card = board["columns"]["AI_TRIAGED"][0]
    assert set(card["swarm_members"]) == {"alex.agent@corp.com", "sam.swarm@corp.com"}


async def test_end_user_cannot_see_others_tickets_or_board(client: AsyncClient) -> None:
    t = await make_ticket(client, requester_email="someone.else@corp.com")
    assert (await client.get(f"/api/v1/tickets/{t['id']}", headers=USER)).status_code == 404
    assert (await client.get("/api/v1/tickets/board", headers=USER)).status_code == 403
    assert (await client.get("/api/v1/tickets/1")).status_code == 401


def test_cab_risk_scoring() -> None:
    low = score_change(RiskInputs(impact=1, affected_ci_count=1, has_rollback_plan=True, tested_in_staging=True,
                                  outside_maintenance_window=False))
    high = score_change(RiskInputs(impact=5, affected_ci_count=12, has_rollback_plan=False,
                                   tested_in_staging=False, outside_maintenance_window=True,
                                   touches_security_controls=True))
    assert low.level == ChangeRisk.LOW and not low.cab_required
    assert high.level == ChangeRisk.HIGH and high.cab_required and high.score <= 100


async def test_change_cab_flow(client: AsyncClient) -> None:
    r = await client.post("/api/v1/changes", headers=AGENT, json={
        "title": "Rotate firewall rules", "description": "Replace legacy ACLs", "requester_email": "alex.agent@corp.com",
        "implementation_plan": "Apply new ruleset via Terraform", "impact": 5, "tested_in_staging": False,
        "touches_security_controls": True, "jira_release_key": "NET-142",
        "scheduled_start": (datetime.now().astimezone() + timedelta(days=2)).isoformat()})
    assert r.status_code == 201, r.text
    change = r.json()
    assert change["cab_required"] and change["jira_release_key"] == "NET-142"
    r = await client.post(f"/api/v1/changes/{change['id']}/cab-approve", headers=AGENT)
    assert r.status_code == 403
    r = await client.post(f"/api/v1/changes/{change['id']}/cab-approve", headers=APPROVER)
    assert r.status_code == 200 and r.json()["cab_approved_by"] == "pat.approver@corp.com"


async def test_kb_versioning(client: AsyncClient) -> None:
    await make_kb(client)
    r = await client.put("/api/v1/kb/KB-402", headers=AGENT,
                         json={"body": "Updated: also check the VPN certificate expiry.", "change_note": "cert step"})
    assert r.json()["current_version"] == 2
    versions = (await client.get("/api/v1/kb/KB-402/versions", headers=AGENT)).json()
    assert [v["version"] for v in versions] == [1, 2]
    hits = (await client.get("/api/v1/kb/search", params={"q": "vpn certificate"}, headers=USER)).json()
    assert hits[0]["key"] == "KB-402"
