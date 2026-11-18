import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computeKpis } from '@/lib/metrics';
import { liveSlaSeconds } from '@/lib/sla';
import { usePlatformStore } from '@/store/usePlatformStore';

const store = () => usePlatformStore.getState();
const ticket = (id: string) => store().tickets.find((t) => t.id === id)!;

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  store().resetDemo();
});

describe('seed data', () => {
  it('pre-seeds the interconnected demo graph', () => {
    const s = store();
    expect(s.tickets).toHaveLength(10); // 8 multilingual + 2 seeded changes
    expect(new Set(s.tickets.map((t) => t.detectedLanguage))).toEqual(new Set(['es', 'fr', 'ja', 'de', 'en', 'pt']));
    expect(s.assets).toHaveLength(6);
    expect(s.saasApps.map((a) => a.name)).toEqual([
      'Figma Enterprise', 'Notion AI (Shadow IT)', 'Okta Workforce', 'Salesforce Sales Cloud', 'Slack Pro', 'Datadog',
    ]);
    expect(s.vault).toHaveLength(5);
    expect(Object.keys(s.flags)).toEqual(['itsm_core', 'ai_agents', 'torii_saas', 'itam_cmdb', 'password_vault']);
    for (const app of s.saasApps) expect(app.provisionedSeats - app.activeSeats).toBe(app.inactiveUsers.length);
  });
});

describe('no status zoo (§3.1)', () => {
  it('pauses and freezes the SLA when waiting, and resumes from the frozen value', () => {
    vi.useFakeTimers({ now: Date.now() });
    store().transitionTicket('INC-1049', 'WAITING_ON_CUSTOMER');
    const paused = ticket('INC-1049');
    expect(paused.slaPaused).toBe(true);
    const frozen = paused.slaRemainingSeconds;

    vi.advanceTimersByTime(10 * 60_000);
    expect(liveSlaSeconds(ticket('INC-1049'), store().slaAnchors['INC-1049'], Date.now())).toBe(frozen);

    store().transitionTicket('INC-1049', 'ACTIVE_SWARM');
    expect(ticket('INC-1049').slaPaused).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(liveSlaSeconds(ticket('INC-1049'), store().slaAnchors['INC-1049'], Date.now())).toBe(frozen - 60);
  });

  it('rejects transitions outside the allowed map', () => {
    const r = store().transitionTicket('INC-1046', 'WAITING_ON_VENDOR');
    expect(r.ok).toBe(false);
    expect(ticket('INC-1046').status).toBe('AI_TRIAGED');
  });

  it('requires a real KB article to resolve', () => {
    expect(store().transitionTicket('INC-1049', 'RESOLVED_KB_LINKED').ok).toBe(false);
    expect(store().transitionTicket('INC-1049', 'RESOLVED_KB_LINKED', { kbId: 'KB-999' }).ok).toBe(false);
    expect(store().transitionTicket('INC-1049', 'RESOLVED_KB_LINKED', { kbId: 'KB-402' }).ok).toBe(true);
    expect(ticket('INC-1049').linkedKbId).toBe('KB-402');
  });
});

describe('no silent handoffs (§3.2)', () => {
  const context = {
    handoffReason: 'Cert chain is fine, failure is at Okta device trust',
    diagnosticsAttempted: 'Re-pushed cert, flushed DNS, AnyConnect logs show IKE ok',
    recommendedNextStep: 'Check Okta device assurance policy',
  };

  it('rejects a handoff without full context', () => {
    const r = store().handoffTicket('INC-1049', { toSquad: 'Endpoint & Mac', handoffReason: 'x', diagnosticsAttempted: '', recommendedNextStep: '' });
    expect(r.ok).toBe(false);
    expect(ticket('INC-1049').swarmSquad).toBe('Network & Identity');
  });

  it('moves the squad, sets Active Swarm, resumes SLA and appends an audit card', () => {
    const r = store().handoffTicket('CHG-301', { toSquad: 'Security & SIEM', ...context });
    expect(r.ok).toBe(true);
    const t = ticket('CHG-301');
    expect(t.swarmSquad).toBe('Security & SIEM');
    expect(t.status).toBe('ACTIVE_SWARM');
    expect(t.slaPaused).toBe(false);
    const audit = t.messages.at(-1)!;
    expect(audit.role).toBe('handoff_audit');
    expect(audit.metadata).toMatchObject({ fromSquad: 'Network & Identity', toSquad: 'Security & SIEM', ...context });
  });
});

describe('cross-module actions', () => {
  it('Sentinel simulation spawns a P1 linked to MBP-0942', () => {
    const id = store().simulateSentinelAlert();
    const t = ticket(id);
    expect(t).toMatchObject({ priority: 'P1', channel: 'SIEM Webhook', swarmSquad: 'Security & SIEM', linkedAssetId: 'MBP-0942' });
    expect(store().assets.find((a) => a.id === 'MBP-0942')!.linkedTicketIds).toContain(id);
    expect(store().telemetry[0]).toMatchObject({ source: 'Microsoft Sentinel', severity: 'critical', ticketId: id });
  });

  it('reclaiming idle seats lowers platform SaaS spend', () => {
    const k = () => computeKpis(store().tickets, store().slaAnchors, store().saasApps, store().baseline, Date.now());
    const before = k();
    store().reclaimIdleSeats('saas-salesforce');
    const after = k();
    expect(before.monthlySaasSpend - after.monthlySaasSpend).toBe(12 * 165);
    expect(after.reclaimableMonthly).toBe(before.reclaimableMonthly - 12 * 165);
    expect(store().reclaimedMonthlySavings).toBe(12 * 165);
    expect(store().reclaimIdleSeats('saas-salesforce').ok).toBe(false);
  });

  it('JIT access needs a real, open ticket from an allowed squad and expires in 1 hour', () => {
    expect(store().grantJitAccess('vault-la-mbp0942', 'INC-9999', 'Alex Rivera').ok).toBe(false);
    expect(store().grantJitAccess('vault-la-mbp0942', 'INC-1044', 'Alex Rivera').ok).toBe(false); // resolved
    expect(store().grantJitAccess('vault-prod-db', 'INC-1049', 'Alex Rivera').ok).toBe(false); // wrong squad
    expect(store().grantJitAccess('vault-la-mbp0942', 'inc-1049', 'Alex Rivera').ok).toBe(true);
    const grant = store().vault.find((v) => v.id === 'vault-la-mbp0942')!.activeGrant!;
    expect(Date.parse(grant.expiresAt) - Date.parse(grant.grantedAt)).toBe(3600_000);
    expect(grant.ticketId).toBe('INC-1049');
  });

  it('macro execution logs telemetry on the ticket and awards 50 XP', () => {
    const xp = store().profile.xp;
    store().executeMacro('INC-1049');
    expect(ticket('INC-1049').messages.at(-1)!.metadata?.macroId).toBe('macro-push-split-tunnel');
    expect(store().profile.xp).toBe(xp + 50);
  });

  it('ITSM Core cannot be disabled; other modules toggle', () => {
    expect(store().toggleFlag('itsm_core').ok).toBe(false);
    store().toggleFlag('torii_saas');
    expect(store().flags.torii_saas).toBe(false);
  });
});
