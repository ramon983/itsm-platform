import { describe, expect, it } from 'vitest';

import { createSeedState } from '@/data/seed';
import { API_MODE, buildSiemResponse, getSaasDiscovery, postIntake, postSiemWebhook, signWebhook } from '@/lib/api';

const seed = createSeedState();

describe('API contract (browser simulation mirrors the FastAPI backend)', () => {
  it('runs in simulated mode when no backend URL is configured', () => {
    expect(API_MODE).toBe('simulated');
  });

  it('signs webhooks exactly like backend/adminzero_api/siem.py', async () => {
    // Reference value produced by: siem.sign('test-secret', '1700000000', b'{"a":1}')
    expect(await signWebhook('test-secret', '1700000000', '{"a":1}')).toBe('sha256=8cb2c3355fca388e9ac2caec004f4d5d7045d74937ab5faad61dc11682247a9f');
  });

  it('correlates a Sentinel alert on maria-mbp to MBP-0942 and drafts a P1', () => {
    const r = buildSiemResponse('sentinel', { properties: { systemAlertId: 's1', alertDisplayName: 'Okta MFA brute force', severity: 'High', entities: [{ kind: 'Host', hostName: 'maria-mbp' }] } }, seed.assets);
    expect(r.matched_assets.map((a) => a.id)).toEqual(['MBP-0942']);
    expect(r.incident).toMatchObject({ priority: 'P1', linked_asset_id: 'MBP-0942', swarm_squad: 'Security & SIEM' });
    expect(r.incident!.recommended_macro!.id).toBe('macro-revoke-okta-sessions');
  });

  it('low-severity Datadog alerts correlate but do not open an incident', () => {
    const r = buildSiemResponse('datadog', { id: 'd1', title: 'Disk 80%', priority: 'low', tags: 'host:lis-f3-core' }, seed.assets);
    expect(r.matched_assets[0]!.id).toBe('MERAKI-SW-01');
    expect(r.incident).toBeNull();
  });

  it('rejects non-JSON webhook bodies', async () => {
    const r = await postSiemWebhook('splunk', 'not json', { assets: seed.assets });
    expect(r.status).toBe(422);
  });

  it('SaaS discovery totals match the backend catalog', async () => {
    const r = await getSaasDiscovery(seed.saasApps);
    const body = r.body as { totals: Record<string, number> };
    expect(body.totals).toMatchObject({ idle_seats: 53, reclaimable_monthly: 2879.5, shadow_it_apps: 1 });
  });

  it('intake returns the Runtime Prompt 1 JSON fields', async () => {
    const r = await postIntake({ message: 'Hola, no puedo conectarme a la VPN y tengo una presentación con un cliente en 45 minutos.', requester_email: 'maria.gonzalez@adminzero.io' }, { assets: seed.assets, saasApps: seed.saasApps });
    const body = r.body as { analysis: Record<string, unknown>; engine: string };
    expect(body.engine).toBe('offline');
    expect(body.analysis).toMatchObject({ detected_language: 'es', selected_template_id: '#INC-NET-04', priority: 'P1', urgency_score: 5, recommended_swarm_group: 'Network & Identity' });
    for (const k of ['sentiment', 'english_summary_for_agent', 'required_approvals']) expect(body.analysis).toHaveProperty(k);
  });
});
