/**
 * Knowledge pattern detection: clusters recent tickets by meaning, finds recurring topics with no
 * self-service article, and drafts one from the resolutions agents actually used.
 */
import { TfIdf, addInto, cosine, sharedTerms, tokenize, type Vector } from '@/lib/similarity';
import type { ClosedTicket, KbArticle, KbStats, SwarmSquad, Ticket } from '@/types/platform';

export interface PatternMember {
  id: string;
  title: string;
  resolution?: string;
  minutesToResolve?: number;
  kbId?: string;
  open: boolean;
}

export type Coverage = 'uncovered' | 'agent_only' | 'self_service';

export interface Pattern {
  id: string;
  label: string;
  terms: string[];
  squad: SwarmSquad;
  members: PatternMember[];
  coverage: Coverage;
  coveringKbId?: string;
  avgMinutes: number;
  humanHoursPerMonth: number;
  selfServiceable: boolean; // no privileged steps in the resolutions
  draft: { title: string; summary: string; steps: string[]; keywords: string[] };
}

export const MIN_PATTERN_SIZE = 3;
const CLUSTER_THRESHOLD = 0.28;

// Steps that need an admin/agent — an article containing these should not be offered as self-service by default.
const PRIVILEGED = ['jamf', 'macro', 'pushed', 'okta "', 'group', 'unlocked the okta account', 'reset okta verify', 'verified identity', 'replaced', 'power-cycled'];

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// Agents write resolutions in the past tense ("Cleared…"); articles need instructions ("Clear…").
const IMPERATIVE: Record<string, string> = {
  removed: 'Remove', 're-added': 're-add', added: 'Add', cleared: 'Clear', reset: 'Reset', restarted: 'Restart',
  're-granted': 'Re-grant', granted: 'Grant', updated: 'Update', reused: 'Reuse', moved: 'Move', ran: 'Run',
  're-pushed': 'Re-push', pushed: 'Push', unlocked: 'Unlock', verified: 'Verify', replaced: 'Replace', enabled: 'Enable',
  're-subscribed': 're-subscribe', subscribed: 'Subscribe', 'power-cycled': 'Power-cycle', 're-enrolled': 're-enrol',
  reminded: 'Remind', advised: 'Advise', opened: 'Open', signed: 'Sign',
};

function toImperative(fragment: string): string | null {
  const words = fragment.split(' ');
  const first = IMPERATIVE[words[0]!.toLowerCase()];
  if (!first) return null; // outcomes ("Audio stable", "VPN connected") are not steps
  const rest = words.slice(1).map((w) => IMPERATIVE[w.toLowerCase()]?.toLowerCase() ?? w).join(' ');
  return `${first} ${rest}`.replace(/\s*\(KB-\d+\)/g, '').trim();
}

function draftSteps(resolutions: string[]): string[] {
  const steps: { text: string; tokens: Set<string>; n: number; pos: number }[] = [];
  for (const r of resolutions) {
    const parts = r.split(/;|\. |, then |\bthen\b| and (?=[a-z-]+ed\b)/);
    parts.forEach((raw, idx) => {
      const position = parts.length > 1 ? idx / (parts.length - 1) : 0; // where in the fix this step usually happens
      const text = toImperative(raw.trim().replace(/\.$/, '').replace(/^and /i, ''));
      if (!text || text.length < 10) return;
      const tokens = new Set(tokenize(text));
      const dup = steps.find((s) => {
        const inter = [...tokens].filter((t) => s.tokens.has(t)).length;
        return inter / Math.min(tokens.size || 1, s.tokens.size || 1) >= 0.6;
      });
      if (dup) {
        dup.pos = (dup.pos * dup.n + position) / (dup.n + 1);
        dup.n += 1;
        if (text.length < dup.text.length) dup.text = text; // keep the clearest (shortest) wording
      } else steps.push({ text, tokens, n: 1, pos: position });
    });
  }
  // Keep the most common steps, then present them in the order agents performed them.
  return steps
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .sort((a, b) => a.pos - b.pos)
    .map((s) => s.text.charAt(0).toUpperCase() + s.text.slice(1));
}

export function detectPatterns(
  closed: readonly ClosedTicket[],
  open: readonly Ticket[],
  kbArticles: readonly KbArticle[],
  kbStats: Readonly<Record<string, KbStats>>,
): Pattern[] {
  const docs: (PatternMember & { text: string; squad: SwarmSquad; at: number })[] = [
    ...closed.map((t) => ({
      id: t.id, title: t.title, resolution: t.resolution, minutesToResolve: t.minutesToResolve, kbId: t.kbId, open: false,
      text: `${t.title}. ${t.summary}`, squad: t.swarmSquad, at: Date.parse(t.closedAt),
    })),
    ...open.filter((t) => t.status !== 'RESOLVED_KB_LINKED').map((t) => ({
      id: t.id, title: t.title, kbId: t.linkedKbId, open: true, text: t.title, squad: t.swarmSquad, at: Date.parse(t.messages[0]?.timestamp ?? '0'),
    })),
  ];
  const engine = new TfIdf(docs.map((d) => d.text));
  const clusters: { centroid: Vector; members: typeof docs; vectors: Vector[] }[] = [];

  for (const doc of [...docs].sort((a, b) => b.at - a.at)) {
    const v = engine.vector(doc.text);
    let best: (typeof clusters)[number] | null = null;
    let bestScore = 0;
    for (const c of clusters) {
      const score = cosine(v, c.centroid);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    if (best && bestScore >= CLUSTER_THRESHOLD) {
      best.members.push(doc);
      best.vectors.push(v);
      addInto(best.centroid, v);
    } else {
      clusters.push({ centroid: new Map(v), members: [doc], vectors: [v] });
    }
  }

  return clusters
    .filter((c) => c.members.length >= MIN_PATTERN_SIZE)
    .map((c, i) => {
      const terms = [...c.centroid.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
      // Most representative member = highest similarity to the centroid.
      const rep = c.members
        .map((m, idx) => ({ m, s: cosine(c.vectors[idx]!, c.centroid) }))
        .sort((a, b) => b.s - a.s || a.m.title.length - b.m.title.length)[0]!.m;
      const kbCounts = new Map<string, number>();
      c.members.forEach((m) => m.kbId && kbCounts.set(m.kbId, (kbCounts.get(m.kbId) ?? 0) + 1));
      const coveringKbId = [...kbCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const stats = coveringKbId ? kbStats[coveringKbId] : undefined;
      const coverage: Coverage = !coveringKbId ? 'uncovered' : stats?.selfServiceEnabled ? 'self_service' : 'agent_only';
      const resolutions = c.members.map((m) => m.resolution).filter((r): r is string => !!r);
      const timed = c.members.filter((m) => m.minutesToResolve !== undefined);
      const avgMinutes = timed.length ? timed.reduce((s, m) => s + m.minutesToResolve!, 0) / timed.length : 0;
      const squadVotes = new Map<SwarmSquad, number>();
      c.members.forEach((m) => squadVotes.set(m.squad, (squadVotes.get(m.squad) ?? 0) + 1));
      const squad = [...squadVotes.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      const lowerRes = resolutions.join(' ').toLowerCase();
      const steps = draftSteps(resolutions);
      const label = titleCase(rep.title.replace(/\s+—.*$/, ''));
      const article = coveringKbId ? kbArticles.find((k) => k.id === coveringKbId) : undefined;
      return {
        id: `pattern-${i}-${terms.join('-')}`,
        label,
        terms,
        squad,
        members: c.members.map(({ id, title, resolution, minutesToResolve, kbId, open }) => ({ id, title, resolution, minutesToResolve, kbId, open })),
        coverage,
        coveringKbId: article?.id,
        avgMinutes,
        humanHoursPerMonth: (c.members.length * avgMinutes) / 60,
        selfServiceable: !PRIVILEGED.some((p) => lowerRes.includes(p)),
        draft: {
          title: `Fix: ${rep.title}`,
          summary: `Seen ${c.members.length} times in 30 days. ${rep.title}. Agents resolved it the same way each time.`,
          steps: steps.length ? steps : ['Describe the fix agents used here.'],
          keywords: terms,
        },
      };
    })
    .sort((a, b) => Number(a.coverage === 'self_service') - Number(b.coverage === 'self_service') || b.members.length - a.members.length);
}

/** Find a published, self-service article that answers an employee's message. Used by the portal before a ticket is created. */
export function findDeflectionArticle(
  message: string,
  kbArticles: readonly KbArticle[],
  kbStats: Readonly<Record<string, KbStats>>,
  threshold: number,
): { article: KbArticle; confidence: number; matched: string[] } | null {
  const candidates = kbArticles.filter((k) => kbStats[k.id]?.selfServiceEnabled && kbStats[k.id]?.status === 'published');
  if (!candidates.length || tokenize(message).length < 2) return null;
  const engine = new TfIdf(kbArticles.map((k) => `${k.title} ${k.summary} ${k.steps.join(' ')}`));
  const q = engine.vector(message);
  let best: { article: KbArticle; confidence: number; matched: string[] } | null = null;
  for (const article of candidates) {
    const v = engine.vector(`${article.title} ${article.title} ${article.summary}`);
    const score = cosine(q, v);
    // Calibrate raw cosine into a 0..1 confidence; two or more shared key terms are required.
    const matched = sharedTerms(q, v);
    const confidence = matched.length >= 2 ? Math.min(0.99, 0.55 + score) : score;
    if (!best || confidence > best.confidence) best = { article, confidence, matched };
  }
  return best && best.confidence >= threshold ? best : null;
}
