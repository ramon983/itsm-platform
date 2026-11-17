from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from tests.conftest import ADMIN, AGENT, AGENT2, APPROVER, make_ticket

# ------------------------------------------------------------------ ITAM


async def _asset(client: AsyncClient, **kw: object) -> dict[str, object]:
    body = {"tag": "LT-0042", "kind": "hardware", "name": "MacBook Pro 14", "hostname": "MARIA-MBP",
            "ip_address": "10.1.2.3", "owner_email": "maria@corp.com", "mdm_status": "ENROLLED", **kw}
    r = await client.post("/api/v1/assets", json=body, headers=AGENT)
    assert r.status_code == 201, r.text
    return r.json()


async def test_asset_lifecycle(client: AsyncClient) -> None:
    a = await _asset(client)
    assert a["hostname"] == "maria-mbp"
    r = await client.post(f"/api/v1/assets/{a['id']}/lifecycle", json={"to": "DISPOSED"}, headers=AGENT)
    assert r.status_code == 409
    for state in ["RECEIVED", "DEPLOYED", "IN_REPAIR", "DEPLOYED", "RETIRED", "DISPOSED"]:
        r = await client.post(f"/api/v1/assets/{a['id']}/lifecycle", json={"to": state}, headers=AGENT)
        assert r.status_code == 200, (state, r.text)


async def test_asset_ticket_bidirectional_link(client: AsyncClient) -> None:
    a = await _asset(client)
    t = await make_ticket(client, asset_ids=[a["id"]])
    linked = (await client.get(f"/api/v1/assets/{a['id']}/tickets", headers=AGENT)).json()
    assert [x["id"] for x in linked] == [t["id"]]


# ------------------------------------------------------------------ SaaS


async def test_saas_discovery_shadow_it_and_reclaim(client: AsyncClient) -> None:
    old = (datetime.now(UTC) - timedelta(days=60)).isoformat()
    signals = [
        {"user_email": "maria@corp.com", "app_name": "Figma", "domain": "figma.com", "source": "sso"},
        {"user_email": "joe@corp.com", "app_name": "Figma", "domain": "figma.com", "source": "sso", "seen_at": old},
        {"user_email": "joe@corp.com", "app_name": "NotionAI", "domain": "notion.so", "source": "oauth",
         "scopes": ["drive.readonly"]},
    ]
    r = await client.post("/api/v1/saas/discovery", json=signals, headers=ADMIN)
    assert r.json() == {"new_apps": 2, "new_seats": 3}

    apps = {a["domain"]: a for a in (await client.get("/api/v1/saas/apps", headers=AGENT)).json()}
    await client.patch(f"/api/v1/saas/apps/{apps['figma.com']['id']}", headers=ADMIN,
                       json={"sanctioned": True, "cost_per_seat_month": "15.00"})

    shadow = (await client.get("/api/v1/saas/shadow-it", headers=AGENT)).json()
    assert [s["app"]["domain"] for s in shadow] == ["notion.so"]

    idle = (await client.get("/api/v1/saas/idle-seats", params={"idle_days": 30}, headers=AGENT)).json()
    assert [(s["user_email"], s["domain"]) for s in idle] == [("joe@corp.com", "figma.com")]

    assert (await client.post("/api/v1/saas/reclaim", json={"seat_ids": [idle[0]["seat_id"]]},
                              headers=AGENT)).status_code == 403
    r = await client.post("/api/v1/saas/reclaim", json={"seat_ids": [idle[0]["seat_id"]]}, headers=ADMIN)
    assert r.json() == {"reclaimed": 1, "monthly_savings": "15.00", "annual_savings": "180.00"}


# ------------------------------------------------------------------ Vault


async def test_vault_jit_flow_and_audit(client: AsyncClient) -> None:
    r = await client.post("/api/v1/vault/secrets", headers=ADMIN, json={
        "name": "Core switch admin", "ciphertext": "QUVTLUdDTS1ibG9i", "key_wrap_id": "kw-1",
        "allowed_roles": ["agent"]})
    secret = r.json()
    t = await make_ticket(client)

    # Ticket not yet active → denied
    req = {"secret_id": secret["id"], "ticket_id": t["id"], "justification": "Need to reset uplink port"}
    assert (await client.post("/api/v1/vault/elevations", json=req, headers=AGENT)).status_code == 422
    await client.post(f"/api/v1/tickets/{t['id']}/transition", json={"to": "ACTIVE_SWARM"}, headers=AGENT)

    el = (await client.post("/api/v1/vault/elevations", json=req, headers=AGENT)).json()
    assert el["status"] == "PENDING"
    assert (await client.post(f"/api/v1/vault/secrets/{secret['id']}/reveal", headers=AGENT)).status_code == 403

    approver_self = {"X-Actor-Email": "alex.agent@corp.com", "X-Actor-Roles": "agent,approver"}
    r = await client.post(f"/api/v1/vault/elevations/{el['id']}/decision", json={"approve": True},
                          headers=approver_self)
    assert r.status_code == 403  # no self-approval

    r = await client.post(f"/api/v1/vault/elevations/{el['id']}/decision", json={"approve": True}, headers=APPROVER)
    approved = r.json()
    expires = datetime.fromisoformat(approved["expires_at"])
    assert timedelta(minutes=59) < expires - datetime.now(UTC) <= timedelta(minutes=60)

    r = await client.post(f"/api/v1/vault/secrets/{secret['id']}/reveal", headers=AGENT)
    assert r.status_code == 200 and r.json()["ciphertext"] == "QUVTLUdDTS1ibG9i"
    assert (await client.post(f"/api/v1/vault/secrets/{secret['id']}/reveal", headers=AGENT2)).status_code == 403

    # Closing the ticket revokes access immediately.
    await client.post("/api/v1/kb", headers=AGENT, json={"key": "KB-500", "title": "Uplink reset",
                                                          "body": "Reset the uplink port via the console."})
    await client.post(f"/api/v1/tickets/{t['id']}/transition",
                      json={"to": "RESOLVED_KB_LINKED", "kb_key": "KB-500"}, headers=AGENT)
    assert (await client.post(f"/api/v1/vault/secrets/{secret['id']}/reveal", headers=AGENT)).status_code == 403

    audit = (await client.get("/api/v1/vault/audit", headers=ADMIN)).json()
    outcomes = [(a["action"], a["outcome"]) for a in reversed(audit)]
    assert ("reveal", "allowed") in outcomes and ("approve", "denied") in outcomes
    assert outcomes.count(("reveal", "denied")) == 3


# ------------------------------------------------------------------ SIEM


def _signed(body: dict[str, object], key: str = "test-signing-key", ts: int | None = None) -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(body).encode()
    ts = ts or int(time.time())
    sig = hmac.new(key.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    return raw, {"X-AdminZero-Timestamp": str(ts), "X-AdminZero-Signature": f"sha256={sig}",
                 "Content-Type": "application/json"}


async def test_siem_rejects_bad_signature(client: AsyncClient) -> None:
    raw, headers = _signed({"sid": "1"}, key="wrong")
    r = await client.post("/api/v1/siem/webhook?source=splunk", content=raw, headers=headers)
    assert r.status_code == 403
    raw, headers = _signed({"sid": "1"}, ts=int(time.time()) - 3600)
    assert (await client.post("/api/v1/siem/webhook?source=splunk", content=raw, headers=headers)).status_code == 403


async def test_siem_links_alert_to_open_ticket(client: AsyncClient) -> None:
    a = await _asset(client)
    t = await make_ticket(client, asset_ids=[a["id"]])
    raw, headers = _signed({"sid": "scheduler__abc", "search_name": "Suspicious PowerShell",
                            "result": {"host": "MARIA-MBP", "severity": "high"}})
    r = await client.post("/api/v1/siem/webhook?source=splunk", content=raw, headers=headers)
    assert r.status_code == 202, r.text
    alert = r.json()
    assert alert["matched_asset_ids"] == [a["id"]] and alert["linked_ticket_ids"] == [t["id"]]
    # idempotent redelivery
    r2 = await client.post("/api/v1/siem/webhook?source=splunk", content=raw, headers=headers)
    assert r2.json()["id"] == alert["id"]


async def test_siem_high_severity_without_ticket_opens_security_incident(client: AsyncClient) -> None:
    await _asset(client)
    raw, headers = _signed({"properties": {"systemAlertId": "sent-1", "alertDisplayName": "Impossible travel",
                                           "severity": "High",
                                           "entities": [{"kind": "Ip", "address": "10.1.2.3"}]}})
    alert = (await client.post("/api/v1/siem/webhook?source=sentinel", content=raw, headers=headers)).json()
    assert len(alert["linked_ticket_ids"]) == 1
    t = (await client.get(f"/api/v1/tickets/{alert['linked_ticket_ids'][0]}", headers=AGENT)).json()
    assert t["swarm_group"] == "security" and t["urgency"] == 4 and t["requester_email"] == "maria@corp.com"


async def test_graphql_tickets_with_assets(client: AsyncClient) -> None:
    a = await _asset(client)
    await make_ticket(client, asset_ids=[a["id"]])
    q = {"query": "{ tickets { key status assets { tag } } }"}
    r = await client.post("/graphql", json=q, headers=AGENT)
    assert r.status_code == 200, r.text
    data = r.json()["data"]["tickets"][0]
    assert data["status"] == "AI_TRIAGED" and data["assets"] == [{"tag": "LT-0042"}]
