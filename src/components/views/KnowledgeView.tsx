'use client';

import clsx from 'clsx';
import { BookOpen, Bot, Clock, Eye, Plus, Search, Sparkles, ThumbsUp, TrendingUp, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button, Card, Field, Modal, inputClass } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { formatDuration, timeAgo } from '@/lib/metrics';
import { detectPatterns, type Pattern } from '@/lib/patterns';
import { SWARM_SQUADS } from '@/lib/rules';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { KbArticle, SwarmSquad } from '@/types/platform';

type Draft = { id?: string; title: string; summary: string; squad: SwarmSquad; steps: string; keywords: string[]; selfService: boolean; sourcePattern?: string; privileged?: boolean };

export function KnowledgeView() {
  const aiOn = usePlatformStore((s) => s.flags.ai_agents);
  const [tab, setTab] = useState<'insights' | 'articles'>(aiOn ? 'insights' : 'articles');
  const [draft, setDraft] = useState<Draft | null>(null);
  const closed = usePlatformStore((s) => s.closedTickets);
  const tickets = usePlatformStore((s) => s.tickets);
  const kbArticles = usePlatformStore((s) => s.kbArticles);
  const kbStats = usePlatformStore((s) => s.kbStats);
  const patterns = useMemo(() => detectPatterns(closed, tickets, kbArticles, kbStats), [closed, tickets, kbArticles, kbStats]);
  const actionable = patterns.filter((p) => p.coverage === 'uncovered').length;
  const activeTab = aiOn ? tab : 'articles';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Knowledge</h1>
            <p className="text-sm text-slate-400">Every resolution makes the next one faster — and the best ones answer employees before they reach a human.</p>
          </div>
          <Button variant="primary" className="ml-auto" onClick={() => setDraft({ title: '', summary: '', squad: 'Endpoint & Mac', steps: '', keywords: [], selfService: false })}>
            <Plus className="size-4" />New article
          </Button>
        </div>
        <KnowledgeKpis />
        <div className="flex gap-1 border-b border-white/[0.08]" role="tablist">
          {aiOn && (
            <TabButton active={activeTab === 'insights'} onClick={() => setTab('insights')}>
              <Sparkles className="size-3.5" />AI pattern insights {actionable > 0 && <span className="rounded-full bg-amber-400/20 px-1.5 font-mono text-[10px] text-amber-200">{actionable}</span>}
            </TabButton>
          )}
          <TabButton active={activeTab === 'articles'} onClick={() => setTab('articles')}><BookOpen className="size-3.5" />Articles ({kbArticles.length})</TabButton>
        </div>
        {activeTab === 'insights' ? (
          <Insights patterns={patterns} onDraft={setDraft} />
        ) : (
          <Articles onEdit={(a) => setDraft({ id: a.id, title: a.title, summary: a.summary, squad: a.squad, steps: a.steps.join('\n'), keywords: a.keywords ?? [], selfService: kbStats[a.id]?.selfServiceEnabled ?? false })} />
        )}
      </div>
      <ArticleEditor draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={clsx('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition', active ? 'border-indigo-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200')}>
      {children}
    </button>
  );
}

function KnowledgeKpis() {
  const kbStats = usePlatformStore((s) => s.kbStats);
  const stats = Object.values(kbStats);
  const deflections = stats.reduce((n, s) => n + s.deflections, 0);
  const selfService = stats.filter((s) => s.selfServiceEnabled).length;
  const views = stats.reduce((n, s) => n + s.views, 0);
  const helpful = stats.reduce((n, s) => n + s.helpful, 0);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        [Bot, 'Resolved by AI self-service', String(deflections), 'Employees helped without a ticket'],
        [Users, 'Self-service articles', `${selfService} / ${stats.length}`, 'Offered by the portal AI'],
        [Eye, 'Article views (30d)', views.toLocaleString(), 'Agents + employees'],
        [ThumbsUp, 'Marked helpful', helpful.toLocaleString(), 'Feedback from readers'],
      ].map(([Icon, label, value, sub]) => {
        const I = Icon as typeof Bot;
        return (
          <Card key={label as string} className="p-4">
            <p className="flex items-center gap-2 text-xs text-slate-400"><I className="size-4 text-indigo-400" />{label as string}</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold tracking-tight">{value as string}</p>
            <p className="text-xs text-slate-500">{sub as string}</p>
          </Card>
        );
      })}
    </div>
  );
}

function Insights({ patterns, onDraft }: { patterns: Pattern[]; onDraft: (d: Draft) => void }) {
  const kbStats = usePlatformStore((s) => s.kbStats);
  const problems = usePlatformStore((s) => s.problems);
  const createProblem = usePlatformStore((s) => s.createProblem);
  const setSelfService = usePlatformStore((s) => s.setSelfService);
  const autonomy = usePlatformStore((s) => s.aiSettings.autonomy);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        The AI reads every ticket from the last 30 days and groups the ones that keep coming back. Where no article exists, it drafts one from the fixes your agents actually used. <span className="text-slate-300">You review and publish.</span>
      </p>
      {autonomy === 'suggest_only' && (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-2.5 text-xs text-amber-200">AI autonomy is set to “Suggest only”, so articles can’t be offered to employees. Change it in Admin → AI &amp; Grounding.</p>
      )}
      {patterns.map((p) => {
        const problem = problems.find((pr) => p.members.some((m) => pr.linkedClosedTicketIds.includes(m.id) || pr.linkedTicketIds.includes(m.id)));
        const stats = p.coveringKbId ? kbStats[p.coveringKbId] : undefined;
        return (
          <Card key={p.id} className={clsx('p-4', p.coverage === 'uncovered' && 'border-amber-400/20')}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx('rounded-md border px-1.5 py-0.5 text-[11px]',
                    p.coverage === 'uncovered' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : p.coverage === 'self_service' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-sky-500/30 bg-sky-500/10 text-sky-200')}>
                    {p.coverage === 'uncovered' ? 'No article — gap' : p.coverage === 'self_service' ? `Self-service · ${p.coveringKbId}` : `Agent runbook · ${p.coveringKbId}`}
                  </span>
                  <span className="text-xs text-slate-500">{p.squad}</span>
                </div>
                <h3 className="mt-1.5 text-base font-semibold tracking-tight">{p.label}</h3>
                <p className="mt-0.5 text-xs text-slate-500">Key terms: {p.terms.join(', ')}</p>
              </div>
              <dl className="grid grid-cols-3 gap-4 text-right">
                <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Tickets</dt><dd className="font-mono text-lg font-semibold">{p.members.length}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Avg fix</dt><dd className="font-mono text-lg font-semibold">{formatDuration(p.avgMinutes)}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Agent hrs/mo</dt><dd className="font-mono text-lg font-semibold text-amber-200">{p.humanHoursPerMonth.toFixed(1)}</dd></div>
              </dl>
            </div>

            {p.coverage === 'uncovered' && (
              <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-indigo-200"><Sparkles className="size-3.5" />AI draft from {p.members.filter((m) => m.resolution).length} resolutions</p>
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-xs text-slate-300">{p.draft.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                {!p.selfServiceable && <p className="mt-1.5 text-[11px] text-amber-300/90">Contains steps that need an admin — defaulting to agent-only. You can still change that when publishing.</p>}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {p.coverage === 'uncovered' && (
                <Button size="sm" variant="primary" onClick={() => onDraft({ title: p.draft.title, summary: p.draft.summary, squad: p.squad, steps: p.draft.steps.join('\n'), keywords: p.draft.keywords, selfService: p.selfServiceable && autonomy !== 'suggest_only', sourcePattern: p.label, privileged: !p.selfServiceable })}>
                  <BookOpen className="size-3.5" />Review & publish article
                </Button>
              )}
              {p.coverage === 'agent_only' && p.coveringKbId && (
                <Button size="sm" disabled={!p.selfServiceable || autonomy === 'suggest_only'} onClick={() => setSelfService(p.coveringKbId!, true)} title={p.selfServiceable ? '' : 'Resolutions need an admin — keep as an agent runbook'}>
                  {p.selfServiceable ? 'Offer to employees (self-service)' : 'Needs an agent — runbook only'}
                </Button>
              )}
              {p.coverage === 'self_service' && stats && <span className="text-xs text-emerald-300">{stats.deflections} employees self-served this month</span>}
              {problem ? (
                <span className="text-xs text-slate-500">Tracked as <span className="font-mono text-slate-300">{problem.id}</span></span>
              ) : (
                <Button size="sm" onClick={() => createProblem({ title: p.label, description: `AI-detected recurring pattern: ${p.members.length} tickets in 30 days.`, priority: 'P3', swarmSquad: p.squad, linkedTicketIds: p.members.filter((m) => m.open).map((m) => m.id), linkedClosedTicketIds: p.members.filter((m) => !m.open).map((m) => m.id), workaround: p.draft.steps.join('. ') })}>
                  Open problem record
                </Button>
              )}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setExpanded(expanded === p.id ? null : p.id)} aria-expanded={expanded === p.id}>
                {expanded === p.id ? 'Hide' : 'Show'} {p.members.length} tickets
              </Button>
            </div>
            {expanded === p.id && (
              <ul className="mt-2 divide-y divide-white/[0.05] rounded-lg border border-white/[0.06] text-xs">
                {p.members.map((m) => (
                  <li key={m.id} className="grid grid-cols-[80px_1fr] gap-2 px-3 py-2">
                    <span className="font-mono text-slate-400">{m.id}{m.open ? ' •' : ''}</span>
                    <span><span className="text-slate-200">{m.title}</span>{m.resolution && <span className="block text-slate-500">Fix: {m.resolution}</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Articles({ onEdit }: { onEdit: (a: KbArticle) => void }) {
  const kbArticles = usePlatformStore((s) => s.kbArticles);
  const kbStats = usePlatformStore((s) => s.kbStats);
  const setSelfService = usePlatformStore((s) => s.setSelfService);
  const recordKbView = usePlatformStore((s) => s.recordKbView);
  const now = useNow();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const list = kbArticles.filter((a) => !q || `${a.id} ${a.title} ${a.summary} ${a.steps.join(' ')}`.toLowerCase().includes(q));

  return (
    <div className="space-y-3">
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 size-4 text-slate-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search articles…" aria-label="Search articles" className={clsx(inputClass, 'pl-8')} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((a) => {
          const st = kbStats[a.id];
          return (
            <Card key={a.id} className="p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-indigo-300">{a.id} <span className="text-slate-500">v{st?.version ?? 1}</span></p>
                  <button type="button" className="mt-0.5 text-left text-sm font-semibold text-slate-100 hover:underline" onClick={() => { setOpenId(openId === a.id ? null : a.id); if (openId !== a.id) recordKbView(a.id); }}>
                    {a.title}
                  </button>
                  <p className="mt-1 text-xs text-slate-400">{a.summary}</p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-slate-400" title="Let the portal AI answer employees with this article">
                  <input type="checkbox" className="accent-emerald-500" checked={!!st?.selfServiceEnabled} onChange={(e) => setSelfService(a.id, e.target.checked)} />
                  Self-service
                </label>
              </div>
              {openId === a.id && <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-slate-300">{a.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                <span>{a.squad}</span>
                <span className="flex items-center gap-1"><Eye className="size-3" />{st?.views ?? 0}</span>
                <span className="flex items-center gap-1"><Bot className="size-3" />{st?.deflections ?? 0} self-served</span>
                <span className="flex items-center gap-1"><ThumbsUp className="size-3" />{st?.helpful ?? 0}</span>
                {st && <span className="flex items-center gap-1"><Clock className="size-3" />{st.author} · {timeAgo(st.updatedAt, now)}</span>}
                {st?.sourcePattern && <span className="flex items-center gap-1 text-amber-300/80"><TrendingUp className="size-3" />from pattern</span>}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onEdit(a)}>Edit</Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ArticleEditor({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  return (
    <Modal open={!!draft} onClose={onClose} title={draft?.id ? `Edit ${draft.id}` : 'Publish article'} subtitle={draft?.sourcePattern ? `Drafted by AI from the “${draft.sourcePattern}” pattern — review before publishing.` : 'Write it for the employee, not for IT.'} width="max-w-2xl">
      {draft && <EditorForm key={draft.id ?? draft.title} draft={draft} onClose={onClose} />}
    </Modal>
  );
}

function EditorForm({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const publishArticle = usePlatformStore((s) => s.publishArticle);
  const updateArticle = usePlatformStore((s) => s.updateArticle);
  const setSelfService = usePlatformStore((s) => s.setSelfService);
  const autonomy = usePlatformStore((s) => s.aiSettings.autonomy);
  const [f, setF] = useState(draft);
  const steps = f.steps.split('\n').map((s) => s.trim()).filter(Boolean);
  const valid = f.title.trim().length >= 8 && f.summary.trim().length >= 15 && steps.length > 0;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        if (f.id) {
          updateArticle(f.id, { title: f.title.trim(), summary: f.summary.trim(), steps, keywords: f.keywords });
          setSelfService(f.id, f.selfService);
        } else {
          publishArticle({ title: f.title.trim(), summary: f.summary.trim(), squad: f.squad, steps, keywords: f.keywords, selfService: f.selfService, sourcePattern: f.sourcePattern });
        }
        onClose();
      }}
    >
      <Field label="Title"><input className={inputClass} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Summary (symptom → cause)"><textarea rows={2} className={inputClass} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
      <Field label="Steps" hint="One per line — written as instructions">
        <textarea rows={5} className={clsx(inputClass, 'font-mono text-xs')} value={f.steps} onChange={(e) => setF({ ...f, steps: e.target.value })} />
      </Field>
      {!f.id && (
        <Field label="Owning squad">
          <select className={inputClass} value={f.squad} onChange={(e) => setF({ ...f, squad: e.target.value as SwarmSquad })}>
            {SWARM_SQUADS.map((s) => <option key={s} className="bg-slate-900">{s}</option>)}
          </select>
        </Field>
      )}
      <label className={clsx('flex items-start gap-2 rounded-xl border p-3 text-sm', f.selfService ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-white/[0.08]')}>
        <input type="checkbox" className="mt-1 accent-emerald-500" disabled={autonomy === 'suggest_only'} checked={f.selfService} onChange={(e) => setF({ ...f, selfService: e.target.checked })} />
        <span>
          <span className="font-medium text-slate-100">Let the portal AI answer employees with this article</span>
          <span className="block text-xs text-slate-400">When an employee describes this problem, the AI shows these steps first. If they say it worked, no ticket is created.</span>
          {f.privileged && f.selfService && <span className="mt-1 block text-xs text-amber-300">Heads-up: the original fixes needed admin rights. Make sure every step is something an employee can do.</span>}
        </span>
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!valid}>{f.id ? 'Save new version' : 'Publish'}</Button>
      </div>
    </form>
  );
}
