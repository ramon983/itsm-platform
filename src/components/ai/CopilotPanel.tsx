'use client';

import clsx from 'clsx';
import { BookOpen, Check, ChevronDown, Globe, History, Lightbulb, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button, Kbd } from '@/components/ui/primitives';
import { runCopilot, type CopilotSubject } from '@/lib/copilot';
import { formatDuration } from '@/lib/metrics';
import { detectPatterns } from '@/lib/patterns';
import { usePlatformStore } from '@/store/usePlatformStore';

interface Props {
  subject: CopilotSubject;
  kind: 'ticket' | 'problem' | 'change';
  onInsertDraft?: (draft: { native: string; english: string; lang: string }) => void;
  onInsertSteps?: (kbId: string, steps: string[]) => void;
  onResolveWithKb?: (kbId: string) => void;
  onExecuteMacro?: () => void;
  onCreateProblem?: (patternLabel: string, closedIds: string[], openIds: string[]) => void;
  disabled?: boolean;
}

/** Human-in-the-loop AI: it finds, drafts and recommends — the agent approves every action. */
export function CopilotPanel({ subject, kind, onInsertDraft, onInsertSteps, onResolveWithKb, onExecuteMacro, onCreateProblem, disabled }: Props) {
  const closed = usePlatformStore((s) => s.closedTickets);
  const kbArticles = usePlatformStore((s) => s.kbArticles);
  const kbStats = usePlatformStore((s) => s.kbStats);
  const assets = usePlatformStore((s) => s.assets);
  const settings = usePlatformStore((s) => s.aiSettings);
  const tickets = usePlatformStore((s) => s.tickets);
  const problems = usePlatformStore((s) => s.problems);
  const [openSimilar, setOpenSimilar] = useState<string | null>(null);

  const result = useMemo(
    () => runCopilot(subject, { closed, kbArticles, kbStats, assets, settings }),
    [subject, closed, kbArticles, kbStats, assets, settings],
  );
  const pattern = useMemo(() => {
    if (kind !== 'ticket') return null;
    const p = detectPatterns(closed, tickets, kbArticles, kbStats).find((x) => x.members.some((m) => m.id === subject.id));
    if (!p) return null;
    const existing = problems.find((pr) => pr.linkedTicketIds.includes(subject.id) || p.members.some((m) => pr.linkedClosedTicketIds.includes(m.id)));
    return { p, existing };
  }, [kind, closed, tickets, kbArticles, kbStats, problems, subject.id]);

  const confidencePct = (c: number) => `${Math.round(c * 100)}%`;

  return (
    <section aria-label="AI Copilot" className="space-y-3 text-sm">
      <header className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-sky-500 shadow-[0_0_16px_rgba(99,102,241,0.35)]">
          <Sparkles className="size-3.5 text-white" />
        </span>
        <div className="leading-tight">
          <h3 className="text-sm font-semibold tracking-tight">AI Copilot</h3>
          <p className="text-[11px] text-slate-500">Suggests · you decide</p>
        </div>
        <span
          className={clsx(
            'ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
            result.grounded ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-300',
          )}
          title="Zero-hallucination guardrail: every suggestion cites an internal source"
        >
          <ShieldCheck className="size-3" />
          {result.grounded ? `Grounded · ${result.sources.length} sources` : 'No internal match'}
        </span>
      </header>

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <p className="text-xs leading-relaxed text-slate-300">{result.summary}</p>
        <p className="mt-2 flex gap-1.5 text-xs text-indigo-200">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-indigo-400" />
          <span><span className="font-semibold">Next best action:</span> {result.nextBestAction}</span>
        </p>
      </div>

      {pattern && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3 text-xs">
          <p className="font-medium text-amber-200">Recurring pattern · {pattern.p.members.length} tickets in 30 days</p>
          <p className="mt-0.5 text-amber-100/70">“{pattern.p.label}”{pattern.p.coverage === 'uncovered' ? ' — no knowledge article yet.' : ''}</p>
          {pattern.existing ? (
            <p className="mt-1.5 text-slate-400">Tracked as <span className="font-mono text-slate-200">{pattern.existing.id}</span>.</p>
          ) : (
            onCreateProblem && (
              <Button
                size="sm"
                className="mt-2"
                onClick={() => onCreateProblem(pattern.p.label, pattern.p.members.filter((m) => !m.open).map((m) => m.id), pattern.p.members.filter((m) => m.open).map((m) => m.id))}
              >
                Create problem record
              </Button>
            )
          )}
        </div>
      )}

      {subject.recommendedMacro && onExecuteMacro && (
        <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300"><Zap className="size-3.5" />Remediation macro · needs your approval</p>
          <p className="mt-1 text-sm text-slate-100">{subject.recommendedMacro.label}</p>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-black/40 px-2 py-1 font-mono text-[10px] text-slate-400">$ {subject.recommendedMacro.command}</pre>
          <Button size="sm" variant="primary" className="mt-2" onClick={onExecuteMacro} disabled={disabled}>
            <Zap className="size-3.5" />Approve & run <Kbd>E</Kbd>
          </Button>
        </div>
      )}

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><BookOpen className="size-3" />Knowledge base matches</p>
        {result.kbMatches.length ? (
          <ul className="space-y-1.5">
            {result.kbMatches.map((m, i) => (
              <li key={m.article.id} className="rounded-lg border border-white/[0.06] p-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-indigo-300">{m.article.id}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{m.article.title}</span>
                  <span className={clsx('font-mono text-[11px]', m.confidence >= settings.confidenceThreshold ? 'text-emerald-300' : 'text-slate-400')}>{confidencePct(m.confidence)}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className={clsx('h-full rounded-full', m.confidence >= settings.confidenceThreshold ? 'bg-emerald-400' : 'bg-indigo-500/70')} style={{ width: confidencePct(m.confidence) }} />
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{m.reasons.join(' · ')}</p>
                {i === 0 && (
                  <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[11px] text-slate-300">
                    {m.article.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {onInsertSteps && (
                    <Button size="sm" onClick={() => onInsertSteps(m.article.id, m.article.steps)} disabled={disabled}>Insert verified steps</Button>
                  )}
                  {onResolveWithKb && m.confidence >= settings.confidenceThreshold && (
                    <Button size="sm" variant="primary" onClick={() => onResolveWithKb(m.article.id)} disabled={disabled}>
                      <Check className="size-3.5" />Resolve with {m.article.id}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-white/[0.08] p-2.5 text-xs text-slate-500">
            {settings.sources.knowledgeBase ? 'No article covers this yet.' : 'Knowledge base grounding is turned off in Admin.'}
          </p>
        )}
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><History className="size-3" />Similar closed tickets</p>
        {result.similar.length ? (
          <ul className="space-y-1">
            {result.similar.map((s) => (
              <li key={s.ticket.id} className="rounded-lg border border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setOpenSimilar(openSimilar === s.ticket.id ? null : s.ticket.id)}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
                  aria-expanded={openSimilar === s.ticket.id}
                >
                  <span className="font-mono text-[11px] text-slate-400">{s.ticket.id}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{s.ticket.title}</span>
                  <span className="font-mono text-[10px] text-slate-500">{confidencePct(s.similarity)}</span>
                  <ChevronDown className={clsx('size-3.5 text-slate-500 transition', openSimilar === s.ticket.id && 'rotate-180')} />
                </button>
                {openSimilar === s.ticket.id && (
                  <div className="border-t border-white/[0.05] px-2.5 py-2 text-[11px]">
                    <p className="text-slate-300"><span className="text-slate-500">Fix:</span> {s.ticket.resolution}</p>
                    <p className="mt-1 text-slate-500">
                      {s.ticket.resolvedBy} · {formatDuration(s.ticket.minutesToResolve)}{s.ticket.kbId ? ` · ${s.ticket.kbId}` : ''} · matched “{s.matchedTerms.join(', ')}”
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-white/[0.08] p-2.5 text-xs text-slate-500">
            {settings.sources.closedTickets ? 'No similar tickets in the last 30 days.' : 'Closed-ticket grounding is turned off in Admin.'}
          </p>
        )}
      </div>

      {onInsertDraft && (
        <div className="rounded-xl border border-white/[0.08] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Empathetic reply draft</p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-200" lang={result.draftReply.lang}>{result.draftReply.native}</p>
          {result.draftReply.lang !== 'en' && <p className="mt-1 text-[11px] text-sky-200/70">EN: {result.draftReply.english}</p>}
          <Button size="sm" className="mt-2" onClick={() => onInsertDraft(result.draftReply)} disabled={disabled}>Use draft</Button>
        </div>
      )}

      {result.internetFallback && (
        <p className="flex gap-1.5 rounded-lg border border-sky-500/15 bg-sky-500/[0.05] p-2.5 text-[11px] text-sky-100">
          <Globe className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
          <span><span className="font-medium">Internet fallback (basic IT only):</span> {result.internetFallback}</span>
        </p>
      )}

      {result.sources.length > 0 && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none">Sources used</summary>
          <ul className="mt-1 space-y-0.5 pl-3">{result.sources.map((src) => <li key={src}>• {src}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
