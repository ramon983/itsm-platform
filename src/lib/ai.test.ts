import { describe, expect, it } from 'vitest';

import { createSeedState } from '@/data/seed';
import { runCopilot, ticketSubject } from '@/lib/copilot';
import { detectPatterns, findDeflectionArticle } from '@/lib/patterns';

const seed = createSeedState(Date.parse('2026-11-17T09:00:00Z'));

describe('knowledge pattern detection', () => {
  const patterns = detectPatterns(seed.closedTickets, seed.tickets, seed.kbArticles, seed.kbStats);
  const byTerm = (term: string) => patterns.find((p) => p.terms.includes(term));

  it('finds recurring topics and whether a KB article covers them', () => {
    expect(byTerm('outlook')).toMatchObject({ coverage: 'uncovered', selfServiceable: true });
    expect(byTerm('outlook')!.members.length).toBe(6);
    expect(byTerm('zoom')).toMatchObject({ coverage: 'uncovered', selfServiceable: true });
    expect(byTerm('okta')).toMatchObject({ coverage: 'uncovered', selfServiceable: false }); // unlocks need an admin
    expect(byTerm('vpn')).toMatchObject({ coverage: 'agent_only', coveringKbId: 'KB-402' });
    expect(byTerm('figma')).toMatchObject({ coverage: 'agent_only', coveringKbId: 'KB-405' });
  });

  it('includes open tickets in the pattern, so live work is linked to history', () => {
    expect(byTerm('vpn')!.members.some((m) => m.id === 'INC-1049' && m.open)).toBe(true);
  });

  it('drafts employee-facing steps (imperative, no outcomes) from agent resolutions', () => {
    const steps = byTerm('outlook')!.draft.steps;
    expect(steps.length).toBeGreaterThanOrEqual(2);
    for (const s of steps) expect(s).toMatch(/^(Remove|Re-add|Clear|Reset|Re-subscribe|Restart|Update)/);
  });
});

describe('self-service deflection matching', () => {
  it('matches only published self-service articles above the threshold', () => {
    const hit = findDeflectionArticle('Salesforce keeps redirecting me in a loop after Okta session expiry', seed.kbArticles, seed.kbStats, 0.8);
    expect(hit?.article.id).toBe('KB-415');
    // KB-402 matches the words but is agent-only, so it must not be offered to employees
    expect(findDeflectionArticle('AnyConnect VPN certificate split-tunnel push', seed.kbArticles, seed.kbStats, 0.8)).toBeNull();
    expect(findDeflectionArticle('hello', seed.kbArticles, seed.kbStats, 0.8)).toBeNull();
  });
});

describe('copilot grounding', () => {
  const ctx = { closed: seed.closedTickets, kbArticles: seed.kbArticles, kbStats: seed.kbStats, assets: seed.assets, settings: seed.aiSettings };

  it('cites similar closed tickets and the KB article that resolved them', () => {
    const r = runCopilot(ticketSubject(seed.tickets.find((t) => t.id === 'INC-1049')!), ctx);
    expect(r.grounded).toBe(true);
    expect(r.similar[0]!.ticket.kbId).toBe('KB-402');
    expect(r.bestKb?.article.id).toBe('KB-402');
    expect(r.aboveThreshold).toBe(true);
    expect(r.sources.some((s) => s.startsWith('CMDB MBP-0942'))).toBe(true);
    expect(r.draftReply.lang).toBe('es');
  });

  it('admits when nothing internal matches, and labels internet fallback for basic IT only', () => {
    const r = runCopilot({ id: 'X', title: 'Printer jammed on floor 9', text: 'paper jam' }, { ...ctx, closed: [], kbArticles: [] });
    expect(r.grounded).toBe(false);
    expect(r.internetFallback).toMatch(/^Public guidance/);
    const off = runCopilot({ id: 'X', title: 'Printer jammed', text: '' }, { ...ctx, closed: [], kbArticles: [], settings: { ...ctx.settings, sources: { ...ctx.settings.sources, internetFallback: false } } });
    expect(off.internetFallback).toBeNull();
  });

  it('respects grounding source toggles from Admin', () => {
    const r = runCopilot(ticketSubject(seed.tickets[0]!), { ...ctx, settings: { ...ctx.settings, sources: { ...ctx.settings.sources, closedTickets: false } } });
    expect(r.similar).toHaveLength(0);
  });
});
