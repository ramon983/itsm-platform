import { beforeEach, describe, expect, it } from 'vitest';

import { detectPatterns, findDeflectionArticle } from '@/lib/patterns';
import { usePlatformStore } from '@/store/usePlatformStore';

const store = () => usePlatformStore.getState();
const ticket = (id: string) => store().tickets.find((t) => t.id === id)!;

beforeEach(() => {
  localStorage.clear();
  store().resetDemo();
});

describe('problems', () => {
  it('creates a problem linked to incidents and enforces root cause before known error', () => {
    const id = store().createProblem({ title: 'Zoom audio after macOS update', description: 'Recurring Zoom audio failures', priority: 'P3', swarmSquad: 'Endpoint & Mac', linkedTicketIds: ['INC-1046'], linkedClosedTicketIds: ['INC-971'] });
    expect(ticket('INC-1046').messages.at(-1)!.metadata?.problem).toBe(id);
    expect(store().transitionProblem(id, 'KNOWN_ERROR').ok).toBe(false);
    store().updateProblem(id, { rootCause: 'coreaudiod regression in 15.4', workaround: 'Restart Core Audio. Update Zoom.' });
    expect(store().transitionProblem(id, 'KNOWN_ERROR').ok).toBe(true);
    expect(store().publishKnownError(id).ok).toBe(true);
    const kbId = store().problems.find((p) => p.id === id)!.linkedKbId!;
    expect(store().kbArticles.find((k) => k.id === kbId)!.steps).toEqual(['Restart Core Audio.', 'Update Zoom.']);
  });
});

describe('changes & CAB', () => {
  it('scores risk, routes risky changes to CAB, and blocks self-approval', () => {
    const id = store().createChange({
      title: 'Rotate firewall ruleset company-wide', description: 'Replace legacy ACLs', swarmSquad: 'Network & Identity', impact: 5,
      affectedAssetIds: ['MERAKI-SW-01'], testedInStaging: false, outsideMaintenanceWindow: true, touchesSecurityControls: true,
      windowStart: new Date().toISOString(), windowEnd: new Date(Date.now() + 3600_000).toISOString(), implementationPlan: 'Apply via Meraki API', rollbackPlan: null,
    });
    const d = store().changeDetails[id]!;
    expect(d).toMatchObject({ cabStatus: 'PENDING', riskLevel: 'HIGH' });
    expect(store().decideCab(id, true).ok).toBe(false); // requester is the current user
    expect(store().decideCab('CHG-301', true).ok).toBe(true); // Alex is Admin and not the requester
    expect(store().changeDetails['CHG-301']!.cabStatus).toBe('APPROVED');
  });

  it('standard low-risk changes skip CAB entirely', () => {
    const id = store().createChange({
      title: 'Update Slack desktop on loaner pool', description: 'Routine app update', swarmSquad: 'Endpoint & Mac', impact: 1,
      affectedAssetIds: [], testedInStaging: true, outsideMaintenanceWindow: false, touchesSecurityControls: false,
      windowStart: new Date().toISOString(), windowEnd: new Date(Date.now() + 3600_000).toISOString(), implementationPlan: 'Jamf policy push', rollbackPlan: 'Previous version pinned',
    });
    expect(store().changeDetails[id]!.cabStatus).toBe('NOT_REQUIRED');
  });
});

describe('knowledge → self-service deflection loop', () => {
  it('publishing an AI-drafted article from a pattern lets the portal answer that question without a human', () => {
    const s = store();
    const outlook = detectPatterns(s.closedTickets, s.tickets, s.kbArticles, s.kbStats).find((p) => p.terms.includes('outlook'))!;
    const message = 'My Outlook calendar is not syncing with Exchange again — meetings are missing.';
    expect(findDeflectionArticle(message, s.kbArticles, s.kbStats, s.aiSettings.confidenceThreshold)).toBeNull();

    const article = s.publishArticle({ title: outlook.draft.title, summary: outlook.draft.summary, squad: outlook.squad, steps: outlook.draft.steps, keywords: outlook.draft.keywords, selfService: true, sourcePattern: outlook.label });
    const after = store();
    expect(findDeflectionArticle(message, after.kbArticles, after.kbStats, after.aiSettings.confidenceThreshold)?.article.id).toBe(article.id);
    expect(detectPatterns(after.closedTickets, after.tickets, after.kbArticles, after.kbStats).find((p) => p.terms.includes('outlook'))).toBeDefined();

    after.recordDeflection(article.id, 'Priya Shah');
    expect(store().kbStats[article.id]!.deflections).toBe(1);
    expect(store().auditLog[0]).toMatchObject({ action: 'Deflected by self-service', category: 'ai' });
  });

  it('"Suggest only" autonomy blocks self-service everywhere', () => {
    store().updateAiSettings({ autonomy: 'suggest_only' });
    expect(Object.values(store().kbStats).some((k) => k.selfServiceEnabled)).toBe(false);
    expect(store().setSelfService('KB-415', true).ok).toBe(false);
  });
});

describe('automations', () => {
  it('runs matching rules on SIEM alerts: adds the SOC analyst and logs it, without changing status', () => {
    const id = store().simulateSentinelAlert();
    const t = ticket(id);
    expect(t.activeSwarmAgents).toContain('Noor Haddad');
    expect(t.status).toBe('AI_TRIAGED');
    expect(t.messages.some((m) => m.sender.startsWith('Automation · SIEM alert'))).toBe(true);
    expect(t.messages.some((m) => m.sender.startsWith('Automation · P1'))).toBe(true);
    expect(store().automations.find((r) => r.id === 'auto-siem')!.runs).toBe(10);
  });

  it('disabled rules never run', () => {
    store().toggleAutomation('auto-siem');
    const id = store().simulateSentinelAlert();
    expect(ticket(id).activeSwarmAgents).not.toContain('Noor Haddad');
  });
});

describe('admin guardrails', () => {
  it('caps custom fields (anti "Jira trap")', () => {
    for (let i = 0; i < 5; i += 1) store().addCustomField({ label: `Field ${i}`, type: 'text', appliesTo: ['INCIDENT'], required: false });
    expect(store().customFields).toHaveLength(12);
    expect(store().addCustomField({ label: 'One too many', type: 'text', appliesTo: ['INCIDENT'], required: false }).ok).toBe(false);
  });

  it('SLA policy changes apply to new tickets and reject nonsense', () => {
    expect(store().updateSlaPolicy('P1', { responseMinutes: 300 }).ok).toBe(false); // response >= resolution
    store().updateSlaPolicy('P1', { resolutionMinutes: 120 });
    const id = store().simulateSentinelAlert();
    expect(ticket(id).slaRemainingSeconds).toBe(120 * 60);
  });

  it('you cannot remove your own admin access, and every admin change is audited', () => {
    expect(store().updateUser('alex.rivera@adminzero.io', { role: 'Agent' }).ok).toBe(false);
    store().updateUser('mei.chen@adminzero.io', { role: 'Approver' });
    expect(store().auditLog[0]).toMatchObject({ category: 'admin', action: 'User updated', entity: 'mei.chen@adminzero.io' });
  });

  it('vault denials are audited too', () => {
    store().grantJitAccess('vault-prod-db', 'INC-1049', 'Alex Rivera');
    expect(store().auditLog[0]).toMatchObject({ category: 'vault', action: 'JIT access denied' });
  });
});
