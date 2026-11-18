'use client';

import clsx from 'clsx';
import { BookOpen, GitBranch, Link2, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CopilotPanel } from '@/components/ai/CopilotPanel';
import { AvatarStack, Button, Card, Field, Modal, PriorityBadge, StatusBadge, inputClass } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { formatDuration, timeAgo } from '@/lib/metrics';
import { PROBLEM_TRANSITIONS, usePlatformStore } from '@/store/usePlatformStore';
import type { Problem, ProblemStatus, SwarmSquad, TicketPriority } from '@/types/platform';

export const PROBLEM_STATUS_STYLE: Record<ProblemStatus, string> = {
  INVESTIGATING: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20',
  WAITING_ON_VENDOR: 'text-purple-300 bg-purple-500/10 border-purple-500/20',
  KNOWN_ERROR: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  RESOLVED: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
};
const LABEL: Record<ProblemStatus, string> = { INVESTIGATING: 'Investigating', WAITING_ON_VENDOR: 'Waiting on vendor', KNOWN_ERROR: 'Known error', RESOLVED: 'Resolved' };

export function ProblemsView() {
  const problems = usePlatformStore((s) => s.problems);
  const [selectedId, setSelectedId] = useState(problems[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const selected = problems.find((p) => p.id === selectedId) ?? problems[0];
  const visible = problems.filter((p) => !query.trim() || `${p.id} ${p.title}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[340px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-white/[0.08]" aria-label="Problems">
        <div className="space-y-2 border-b border-white/[0.08] p-4">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight">Problems</h1>
            <Button size="sm" variant="primary" className="ml-auto" onClick={() => setCreating(true)}><Plus className="size-3.5" />New problem</Button>
          </div>
          <p className="text-xs text-slate-500">Root causes behind repeat incidents. The AI flags patterns in Tickets; you decide what becomes a problem.</p>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-slate-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search problems…" aria-label="Search problems" className={clsx(inputClass, 'h-8 py-1 pl-8 text-xs')} />
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {visible.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-current={selected?.id === p.id}
                className={clsx('mb-1 w-full rounded-lg border p-3 text-left transition', selected?.id === p.id ? 'border-indigo-500/40 bg-indigo-500/[0.08]' : 'border-transparent hover:bg-white/[0.03]')}
              >
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-slate-300">{p.id}</span>
                  <span className={clsx('rounded-md border px-1.5 py-0.5', PROBLEM_STATUS_STYLE[p.status])}>{LABEL[p.status]}</span>
                  <span className="ml-auto font-mono text-slate-500">{p.linkedTicketIds.length + p.linkedClosedTicketIds.length} tickets</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-snug text-slate-100">{p.title}</p>
                <p className="mt-1 text-[11px] text-slate-500">{p.swarmSquad}{p.linkedKbId ? ` · ${p.linkedKbId}` : ''}</p>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {selected ? <ProblemDetail key={selected.id} problem={selected} /> : <div className="grid place-items-center text-sm text-slate-500">No problems yet</div>}
      <NewProblemModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => setSelectedId(id)} />
    </div>
  );
}

function ProblemDetail({ problem: p }: { problem: Problem }) {
  const aiOn = usePlatformStore((s) => s.flags.ai_agents);
  const tickets = usePlatformStore((s) => s.tickets);
  const closed = usePlatformStore((s) => s.closedTickets);
  const transition = usePlatformStore((s) => s.transitionProblem);
  const update = usePlatformStore((s) => s.updateProblem);
  const link = usePlatformStore((s) => s.linkTicketToProblem);
  const addNote = usePlatformStore((s) => s.addProblemNote);
  const publish = usePlatformStore((s) => s.publishKnownError);
  const selectTicket = usePlatformStore((s) => s.selectTicket);
  const setView = usePlatformStore((s) => s.setView);
  const now = useNow();
  const [rootCause, setRootCause] = useState(p.rootCause ?? '');
  const [workaround, setWorkaround] = useState(p.workaround ?? '');
  const [jira, setJira] = useState(p.linkedJiraIssue ?? '');
  const [note, setNote] = useState('');
  const [linkId, setLinkId] = useState('');

  const open = tickets.filter((t) => p.linkedTicketIds.includes(t.id));
  const history = closed.filter((t) => p.linkedClosedTicketIds.includes(t.id));
  const linkable = tickets.filter((t) => !p.linkedTicketIds.includes(t.id) && t.type !== 'CHANGE');
  const dirty = rootCause !== (p.rootCause ?? '') || workaround !== (p.workaround ?? '') || jira !== (p.linkedJiraIssue ?? '');
  const subject = useMemo(
    () => ({ id: p.id, title: p.title, text: `${p.description} ${p.rootCause ?? ''} ${history.map((h) => h.title).join(' ')}`, linkedKbId: p.linkedKbId }),
    [p, history],
  );

  return (
    <div className={clsx('grid min-h-0', aiOn && 'xl:grid-cols-[1fr_360px]')}>
      <section className="min-h-0 space-y-4 overflow-y-auto p-5" aria-label={`Problem ${p.id}`}>
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono font-semibold text-slate-200">{p.id}</span>
            <span className={clsx('rounded-md border px-1.5 py-0.5', PROBLEM_STATUS_STYLE[p.status])}>{LABEL[p.status]}</span>
            <PriorityBadge priority={p.priority} />
            <span className="text-slate-500">{p.swarmSquad} · opened {timeAgo(p.createdAt, now)}</span>
            <span className="ml-auto"><AvatarStack names={p.activeSwarmAgents} /></span>
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">{p.title}</h2>
          <p className="mt-1 text-sm text-slate-400">{p.description}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {PROBLEM_TRANSITIONS[p.status].map((to) => (
            <Button key={to} size="sm" onClick={() => transition(p.id, to)}>Move to {LABEL[to]}</Button>
          ))}
          <Button size="sm" variant="primary" disabled={!!p.linkedKbId || !p.workaround} onClick={() => publish(p.id)} title={p.linkedKbId ? `Published as ${p.linkedKbId}` : 'Publish the workaround as a KB article'}>
            <BookOpen className="size-3.5" />{p.linkedKbId ? `Published · ${p.linkedKbId}` : 'Publish workaround to KB'}
          </Button>
        </div>

        <Card className="space-y-3 p-4">
          <Field label="Root cause" hint="Required before Known error or Resolved">
            <textarea rows={2} className={inputClass} value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="What is actually causing these incidents?" />
          </Field>
          <Field label="Workaround" hint="Required for Known error — becomes the KB article">
            <textarea rows={2} className={inputClass} value={workaround} onChange={(e) => setWorkaround(e.target.value)} />
          </Field>
          <Field label="Jira issue (developer backlog)">
            <input className={clsx(inputClass, 'font-mono')} value={jira} onChange={(e) => setJira(e.target.value.toUpperCase())} placeholder="PROJ-123" />
          </Field>
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty}
            onClick={() => update(p.id, { rootCause: rootCause.trim() || null, workaround: workaround.trim() || null, linkedJiraIssue: jira.trim() || undefined })}
          >
            Save
          </Button>
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold">Linked incidents</h3>
            <span className="font-mono text-xs text-slate-500">{open.length} open · {history.length} closed</span>
            {p.linkedJiraIssue && <span className="ml-auto flex items-center gap-1 font-mono text-xs text-sky-300"><GitBranch className="size-3" />{p.linkedJiraIssue}</span>}
          </div>
          <ul className="divide-y divide-white/[0.05] text-xs">
            {open.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2">
                <button type="button" className="font-mono text-indigo-300 hover:underline" onClick={() => { selectTicket(t.id); setView('tickets'); }}>{t.id}</button>
                <span className="min-w-0 flex-1 truncate text-slate-200">{t.title}</span>
                <StatusBadge status={t.status} />
              </li>
            ))}
            {history.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2 text-slate-400">
                <span className="font-mono">{t.id}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="font-mono text-[10px]">closed · {formatDuration(t.minutesToResolve)}</span>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (linkId && link(p.id, linkId).ok) setLinkId('');
            }}
          >
            <select aria-label="Incident to link" value={linkId} onChange={(e) => setLinkId(e.target.value)} className={clsx(inputClass, 'h-8 py-1 text-xs')}>
              <option value="" className="bg-slate-900">Link an open ticket…</option>
              {linkable.map((t) => <option key={t.id} value={t.id} className="bg-slate-900">{t.id} · {t.title}</option>)}
            </select>
            <Button size="sm" type="submit" disabled={!linkId}><Link2 className="size-3.5" />Link</Button>
          </form>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Investigation notes</h3>
          <ul className="space-y-2 text-xs">
            {p.notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-amber-400/15 bg-amber-400/[0.04] p-2.5">
                <p className="text-slate-200">{n.text}</p>
                <p className="mt-1 text-slate-500">{n.author} · {timeAgo(n.timestamp, now)}</p>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (addNote(p.id, note).ok) setNote('');
            }}
          >
            <input className={clsx(inputClass, 'h-8 py-1 text-xs')} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the swarm…" aria-label="New note" />
            <Button size="sm" type="submit" disabled={!note.trim()}>Add</Button>
          </form>
        </Card>
      </section>
      {aiOn && (
        <aside className="min-h-0 overflow-y-auto border-l border-white/[0.08] p-4" aria-label="Problem copilot">
          <CopilotPanel subject={subject} kind="problem" onInsertSteps={(_, steps) => setWorkaround(steps.join(' '))} />
        </aside>
      )}
    </div>
  );
}

function NewProblemModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="New problem" subtitle="Group the incidents that share a root cause." width="max-w-xl">
      {open && <NewProblemForm onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

function NewProblemForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const squads = usePlatformStore((s) => s.squads);
  const tickets = usePlatformStore((s) => s.tickets);
  const createProblem = usePlatformStore((s) => s.createProblem);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('P3');
  const [squad, setSquad] = useState<SwarmSquad>(squads[0] ?? 'IT');
  const [linked, setLinked] = useState<string[]>([]);
  const valid = title.trim().length >= 8 && description.trim().length >= 10;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onCreated(createProblem({ title: title.trim(), description: description.trim(), priority, swarmSquad: squad, linkedTicketIds: linked, linkedClosedTicketIds: [] }));
        onClose();
      }}
    >
      <Field label="Title"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="What do the incidents have in common?"><textarea rows={3} className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
            {(['P1', 'P2', 'P3', 'P4'] as const).map((p) => <option key={p} className="bg-slate-900">{p}</option>)}
          </select>
        </Field>
        <Field label="Owning squad">
          <select className={inputClass} value={squad} onChange={(e) => setSquad(e.target.value as SwarmSquad)}>
            {squads.map((s) => <option key={s} className="bg-slate-900">{s}</option>)}
          </select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-slate-400">Link open incidents</legend>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-white/[0.06] p-2">
          {tickets.filter((t) => t.type === 'INCIDENT').map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" className="accent-indigo-500" checked={linked.includes(t.id)} onChange={(e) => setLinked((l) => (e.target.checked ? [...l, t.id] : l.filter((x) => x !== t.id)))} />
              <span className="font-mono text-slate-400">{t.id}</span>{t.title}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!valid}>Create problem</Button>
      </div>
    </form>
  );
}
