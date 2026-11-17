'use client';

import clsx from 'clsx';
import { CalendarClock, Check, GitBranch, Plus, ShieldAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CopilotPanel } from '@/components/ai/CopilotPanel';
import { TicketTimeline } from '@/components/tickets/TicketTimeline';
import { Button, Card, Field, Modal, StatusBadge, inputClass } from '@/components/ui/primitives';
import { CURRENT_AGENT } from '@/data/seed';
import { useNow } from '@/hooks/useNow';
import { CAB_THRESHOLD, scoreChange } from '@/lib/changes';
import { ticketSubject } from '@/lib/copilot';
import { ALLOWED_TRANSITIONS, STATUS_LABEL, SWARM_SQUADS, TICKET_STATUSES } from '@/lib/rules';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { CabStatus, ChangeDetails, SwarmSquad, Ticket, TicketStatus } from '@/types/platform';

const CAB_STYLE: Record<CabStatus, string> = {
  NOT_REQUIRED: 'text-slate-300 border-white/[0.1]',
  PENDING: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  APPROVED: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  REJECTED: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
};
const CAB_LABEL: Record<CabStatus, string> = { NOT_REQUIRED: 'Standard · no CAB', PENDING: 'CAB pending', APPROVED: 'CAB approved', REJECTED: 'CAB rejected' };
const RISK_STYLE = { LOW: 'text-emerald-300', MEDIUM: 'text-amber-300', HIGH: 'text-rose-300' } as const;

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function ChangesView() {
  const tickets = usePlatformStore((s) => s.tickets);
  const details = usePlatformStore((s) => s.changeDetails);
  const changes = tickets.filter((t) => t.type === 'CHANGE' && details[t.id]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = changes.find((c) => c.id === selectedId) ?? changes[0];
  const pending = changes.filter((c) => details[c.id]!.cabStatus === 'PENDING').length;

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-[1500px] space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Changes</h1>
            <p className="text-sm text-slate-400">Transparent risk scoring. Low-risk changes skip CAB; only risk ≥ {CAB_THRESHOLD} needs approval.</p>
          </div>
          <span className="rounded-full border border-amber-500/30 px-2.5 py-1 text-xs text-amber-300">{pending} awaiting CAB</span>
          <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}><Plus className="size-4" />New change</Button>
        </div>

        <Schedule changes={changes} details={details} onSelect={setSelectedId} selectedId={selected?.id} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Card className="overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-slate-500">
                <tr><th className="px-3 py-2 font-medium">Change</th><th className="px-3 py-2 font-medium">Risk</th><th className="px-3 py-2 font-medium">CAB</th><th className="px-3 py-2 font-medium">Window</th></tr>
              </thead>
              <tbody>
                {changes.map((c) => {
                  const d = details[c.id]!;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={clsx('cursor-pointer border-b border-white/[0.04] transition hover:bg-white/[0.03]', selected?.id === c.id && 'bg-indigo-500/[0.08]')}
                    >
                      <td className="px-3 py-2.5">
                        <button type="button" className="text-left" onClick={() => setSelectedId(c.id)}>
                          <span className="block font-mono text-[11px] text-slate-400">{c.id}{d.jiraRelease ? ` · ${d.jiraRelease}` : ''}</span>
                          <span className="block text-[13px] text-slate-100">{c.title}</span>
                        </button>
                      </td>
                      <td className={clsx('px-3 py-2.5 font-mono text-xs', RISK_STYLE[d.riskLevel])}>{d.riskScore} {d.riskLevel}</td>
                      <td className="px-3 py-2.5"><span className={clsx('whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px]', CAB_STYLE[d.cabStatus])}>{CAB_LABEL[d.cabStatus]}</span></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-400">{fmt(d.windowStart)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {selected && <ChangeDetail key={selected.id} change={selected} details={details[selected.id]!} />}
        </div>
      </div>
      <NewChangeModal open={creating} onClose={() => setCreating(false)} onCreated={setSelectedId} />
    </div>
  );
}

function Schedule({ changes, details, onSelect, selectedId }: { changes: Ticket[]; details: Record<string, ChangeDetails>; onSelect: (id: string) => void; selectedId?: string }) {
  const now = useNow();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const span = 7 * 86_400_000;
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000));
  return (
    <Card className="p-4">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-300"><CalendarClock className="size-3.5 text-indigo-400" />Change schedule · next 7 days</p>
      <div className="relative">
        <div className="grid grid-cols-7 border-b border-white/[0.06] pb-1 text-[10px] text-slate-500">
          {days.map((d) => <span key={d.toISOString()}>{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>)}
        </div>
        <div className="relative mt-2 space-y-1.5">
          <div className="absolute inset-y-0 w-px bg-rose-400/70" style={{ left: `${((now - start.getTime()) / span) * 100}%` }} title="Now" />
          {changes.map((c) => {
            const d = details[c.id]!;
            const left = Math.max(0, ((Date.parse(d.windowStart) - start.getTime()) / span) * 100);
            const width = Math.max(1.5, ((Date.parse(d.windowEnd) - Date.parse(d.windowStart)) / span) * 100);
            if (left > 100) return null;
            return (
              <div key={c.id} className="relative h-6">
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  title={`${c.id} ${c.title}`}
                  className={clsx(
                    'absolute h-6 truncate rounded-md border px-1.5 text-left font-mono text-[10px] transition',
                    CAB_STYLE[d.cabStatus],
                    selectedId === c.id && 'ring-2 ring-indigo-500/60',
                  )}
                  style={{ left: `${left}%`, width: `max(${width}%, 70px)` }}
                >
                  {c.id}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function ChangeDetail({ change, details: d }: { change: Ticket; details: ChangeDetails }) {
  const aiOn = usePlatformStore((s) => s.flags.ai_agents);
  const users = usePlatformStore((s) => s.users);
  const decideCab = usePlatformStore((s) => s.decideCab);
  const transitionTicket = usePlatformStore((s) => s.transitionTicket);
  const [resolveHint, setResolveHint] = useState(false);
  const me = users.find((u) => u.name === CURRENT_AGENT);
  const canApprove = (me?.role === 'Approver' || me?.role === 'Admin') && change.requesterName !== CURRENT_AGENT;
  const subject = useMemo(() => ticketSubject(change), [change]);
  const maxFactor = Math.max(...Object.values(d.riskFactors), 1);

  return (
    <div className={clsx('grid gap-4', aiOn && '2xl:grid-cols-[1fr_320px]')}>
      <Card className="space-y-4 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono font-semibold text-slate-200">{change.id}</span>
            <span className="font-mono text-slate-500">{change.templateId}</span>
            <StatusBadge status={change.status} />
            <span className={clsx('rounded-md border px-1.5 py-0.5 text-[11px]', CAB_STYLE[d.cabStatus])}>{CAB_LABEL[d.cabStatus]}{d.cabDecisionBy ? ` · ${d.cabDecisionBy}` : ''}</span>
          </div>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight">{change.title}</h2>
          <p className="mt-1 text-xs text-slate-500">Requested by {change.requesterName} · {change.swarmSquad} · {fmt(d.windowStart)} → {fmt(d.windowEnd)}</p>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-slate-300">Risk score <span className={clsx('font-mono', RISK_STYLE[d.riskLevel])}>{d.riskScore}/100 {d.riskLevel}</span></p>
          <ul className="space-y-1">
            {Object.entries(d.riskFactors).map(([k, v]) => (
              <li key={k} className="grid grid-cols-[1fr_120px_32px] items-center gap-2 text-[11px] text-slate-400">
                <span>{k}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full bg-indigo-500" style={{ width: `${(v / maxFactor) * 100}%` }} /></span>
                <span className="text-right font-mono">+{v}</span>
              </li>
            ))}
          </ul>
        </div>

        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-slate-500">Implementation plan</dt><dd className="mt-0.5 text-slate-200">{d.implementationPlan}</dd></div>
          <div>
            <dt className="text-slate-500">Rollback plan</dt>
            <dd className={clsx('mt-0.5', d.rollbackPlan ? 'text-slate-200' : 'text-amber-300')}>{d.rollbackPlan ?? 'None documented — consider adding one (+15 risk).'}</dd>
          </div>
          {d.jiraRelease && <div><dt className="text-slate-500">Linked release</dt><dd className="mt-0.5 flex items-center gap-1 font-mono text-sky-300"><GitBranch className="size-3" />{d.jiraRelease}{change.linkedJiraIssue ? ` · ${change.linkedJiraIssue}` : ''}</dd></div>}
          {d.affectedAssetIds.length > 0 && <div><dt className="text-slate-500">Affected CIs</dt><dd className="mt-0.5 font-mono text-slate-200">{d.affectedAssetIds.join(', ')}</dd></div>}
        </dl>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
          {d.cabStatus === 'PENDING' && (
            <>
              <Button size="sm" variant="primary" disabled={!canApprove} onClick={() => decideCab(change.id, true)}><Check className="size-3.5" />Approve</Button>
              <Button size="sm" variant="danger" disabled={!canApprove} onClick={() => decideCab(change.id, false)}><X className="size-3.5" />Reject</Button>
              {!canApprove && <span className="text-[11px] text-slate-500">Approvers can’t approve their own changes.</span>}
            </>
          )}
          <select
            aria-label="Change status"
            value={change.status}
            onChange={(e) => {
              const to = e.target.value as TicketStatus;
              if (to === 'RESOLVED_KB_LINKED') setResolveHint(true);
              else transitionTicket(change.id, to);
            }}
            className={clsx(inputClass, 'ml-auto h-8 w-auto py-1 text-xs')}
          >
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s} disabled={s !== change.status && !ALLOWED_TRANSITIONS[change.status].includes(s)} className="bg-slate-900">{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
        {resolveHint && (
          <p className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-2 text-xs text-amber-200">
            <ShieldAlert className="size-3.5" />Closing a change links its runbook KB article — use the copilot’s “Resolve with KB” or link one from the ticket drawer.
          </p>
        )}
        <details>
          <summary className="cursor-pointer text-xs text-slate-400">Timeline ({change.messages.length})</summary>
          <div className="mt-2"><TicketTimeline messages={change.messages} showTranslation /></div>
        </details>
      </Card>
      {aiOn && (
        <Card className="p-4">
          <CopilotPanel
            subject={subject}
            kind="change"
            onResolveWithKb={(kbId) => transitionTicket(change.id, 'RESOLVED_KB_LINKED', { kbId, note: 'Change completed per runbook' })}
          />
        </Card>
      )}
    </div>
  );
}

function NewChangeModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Request a change" subtitle="Risk is scored as you type. No unnecessary approvals — only risky changes go to CAB." width="max-w-2xl">
      {open && <NewChangeForm onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

function NewChangeForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const assets = usePlatformStore((s) => s.assets);
  const createChange = usePlatformStore((s) => s.createChange);
  const now = useNow();
  const toLocal = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [f, setF] = useState({
    title: '', description: '', swarmSquad: 'Endpoint & Mac' as SwarmSquad, impact: 2, affectedAssetIds: [] as string[],
    testedInStaging: true, outsideMaintenanceWindow: false, touchesSecurityControls: false,
    windowStart: toLocal(now + 86_400_000), windowEnd: toLocal(now + 86_400_000 + 2 * 3600_000),
    implementationPlan: '', rollbackPlan: '', jiraRelease: '',
  });
  const risk = scoreChange({ impact: f.impact, affectedCount: f.affectedAssetIds.length, hasRollbackPlan: !!f.rollbackPlan.trim(), testedInStaging: f.testedInStaging, outsideMaintenanceWindow: f.outsideMaintenanceWindow, touchesSecurityControls: f.touchesSecurityControls });
  const valid = f.title.trim().length >= 8 && f.description.trim().length >= 10 && f.implementationPlan.trim().length >= 10 && Date.parse(f.windowEnd) > Date.parse(f.windowStart);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onCreated(createChange({
          ...f, title: f.title.trim(), description: f.description.trim(), implementationPlan: f.implementationPlan.trim(),
          rollbackPlan: f.rollbackPlan.trim() || null, windowStart: new Date(f.windowStart).toISOString(), windowEnd: new Date(f.windowEnd).toISOString(),
        }));
        onClose();
      }}
    >
      <div className="sm:col-span-2"><Field label="Title"><input className={inputClass} value={f.title} onChange={(e) => set('title', e.target.value)} /></Field></div>
      <div className="sm:col-span-2"><Field label="Why is this change needed?"><textarea rows={2} className={inputClass} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field></div>
      <Field label="Squad">
        <select className={inputClass} value={f.swarmSquad} onChange={(e) => set('swarmSquad', e.target.value as SwarmSquad)}>
          {SWARM_SQUADS.map((s) => <option key={s} className="bg-slate-900">{s}</option>)}
        </select>
      </Field>
      <Field label={`Impact: ${['', 'single user', 'team', 'department', 'site', 'company-wide'][f.impact]}`}>
        <input type="range" min={1} max={5} value={f.impact} onChange={(e) => set('impact', Number(e.target.value))} className="w-full accent-indigo-500" aria-label="Impact" />
      </Field>
      <Field label="Window start"><input type="datetime-local" className={inputClass} value={f.windowStart} onChange={(e) => set('windowStart', e.target.value)} /></Field>
      <Field label="Window end"><input type="datetime-local" className={inputClass} value={f.windowEnd} onChange={(e) => set('windowEnd', e.target.value)} /></Field>
      <div className="sm:col-span-2"><Field label="Implementation plan"><textarea rows={2} className={inputClass} value={f.implementationPlan} onChange={(e) => set('implementationPlan', e.target.value)} /></Field></div>
      <div className="sm:col-span-2"><Field label="Rollback plan" hint="Optional, but missing rollback adds +15 risk"><textarea rows={2} className={inputClass} value={f.rollbackPlan} onChange={(e) => set('rollbackPlan', e.target.value)} /></Field></div>
      <Field label="Affected assets (CIs)">
        <select multiple className={clsx(inputClass, 'h-20')} value={f.affectedAssetIds} onChange={(e) => set('affectedAssetIds', [...e.target.selectedOptions].map((o) => o.value))}>
          {assets.map((a) => <option key={a.id} value={a.id} className="bg-slate-900">{a.id} · {a.name}</option>)}
        </select>
      </Field>
      <div className="space-y-1.5 text-xs text-slate-300">
        <Field label="Jira release (optional)"><input className={clsx(inputClass, 'font-mono')} value={f.jiraRelease} onChange={(e) => set('jiraRelease', e.target.value)} placeholder="PLAT-R-150" /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-500" checked={f.testedInStaging} onChange={(e) => set('testedInStaging', e.target.checked)} />Tested in staging</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-500" checked={f.outsideMaintenanceWindow} onChange={(e) => set('outsideMaintenanceWindow', e.target.checked)} />Outside maintenance window</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-indigo-500" checked={f.touchesSecurityControls} onChange={(e) => set('touchesSecurityControls', e.target.checked)} />Touches security controls</label>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 sm:col-span-2">
        <span className={clsx('font-mono text-2xl font-semibold', RISK_STYLE[risk.level])}>{risk.score}</span>
        <span className="text-xs text-slate-400">
          {risk.level} risk · {risk.cabRequired ? 'goes to CAB for approval' : 'standard change — no CAB needed'}
          <span className="block font-mono text-[10px] text-slate-500">{Object.entries(risk.factors).map(([k, v]) => `${k} +${v}`).join(' · ')}</span>
        </span>
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!valid}>Submit change</Button>
        </span>
      </div>
    </form>
  );
}
