'use client';

import clsx from 'clsx';
import { Building2, Pencil, Plus, Trash2, User, Users } from 'lucide-react';
import { useState } from 'react';

import { Button, Card, Field, Modal, inputClass } from '@/components/ui/primitives';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { OrgProfile } from '@/types/platform';

const PROFILES: { key: OrgProfile; icon: typeof User; title: string; size: string; points: string[] }[] = [
  {
    key: 'solo', icon: User, title: 'Solo', size: 'Just me',
    points: ['One “IT” team — no squads to manage', 'No handoffs (nobody to hand off to)', 'Self-approve changes with a reason, logged for audit', 'AI auto-resolves low-risk requests', 'Compact layout'],
  },
  {
    key: 'team', icon: Users, title: 'Team', size: '2 – 25 people',
    points: ['A few squads, swarming by default', 'Handoffs need context', 'Separate approver for risky changes', 'AI suggests, you decide'],
  },
  {
    key: 'enterprise', icon: Building2, title: 'Enterprise', size: '25+ people, many teams',
    points: ['As many squads as you need', 'Strict separation of duties — never approve your own change', 'Full audit trail and CAB workflow', 'SLA policies per priority, automations per team'],
  },
];

export function OrganizationTab() {
  const profile = usePlatformStore((s) => s.orgProfile);
  const setOrgProfile = usePlatformStore((s) => s.setOrgProfile);
  const squads = usePlatformStore((s) => s.squads);
  const users = usePlatformStore((s) => s.users);
  const tickets = usePlatformStore((s) => s.tickets);
  const addSquad = usePlatformStore((s) => s.addSquad);
  const renameSquad = usePlatformStore((s) => s.renameSquad);
  const density = usePlatformStore((s) => s.density);
  const setDensity = usePlatformStore((s) => s.setDensity);
  const [confirmSolo, setConfirmSolo] = useState(false);
  const [newSquad, setNewSquad] = useState('');
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Organization</h2>
        <p className="text-sm text-slate-400">AdminZero fits a one-person IT shop and a 500-person IT org. Pick how you work — you can change it any time.</p>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">How big is your IT team?</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {PROFILES.map((p) => (
            <label key={p.key} className={clsx('flex cursor-pointer flex-col rounded-xl border p-4 transition', profile === p.key ? 'border-indigo-500 bg-indigo-500/[0.08]' : 'border-white/[0.08] hover:border-white/[0.16]')}>
              <span className="flex items-center gap-2">
                <input type="radio" name="org-profile" className="accent-indigo-500" checked={profile === p.key} onChange={() => (p.key === 'solo' ? setConfirmSolo(true) : setOrgProfile(p.key))} />
                <p.icon className="size-4 text-indigo-300" aria-hidden />
                <span className="font-semibold">{p.title}</span>
                <span className="ml-auto text-xs text-slate-400">{p.size}</span>
              </span>
              <ul className="mt-2 space-y-1 text-xs text-slate-300">
                {p.points.map((pt) => <li key={pt}>• {pt}</li>)}
              </ul>
            </label>
          ))}
        </div>
      </fieldset>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Squads <span className="font-mono text-xs font-normal text-slate-400">{squads.length}</span></h3>
          <p className="text-xs text-slate-400">Teams that swarm on tickets. Renaming or removing a squad moves its tickets, people and articles with it.</p>
        </div>
        <ul className="divide-y divide-white/[0.06]">
          {squads.map((q) => {
            const people = users.filter((u) => u.squad === q).length;
            const open = tickets.filter((t) => t.swarmSquad === q && t.status !== 'RESOLVED_KB_LINKED').length;
            return (
              <li key={q} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                {editing?.from === q ? (
                  <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (renameSquad(q, editing.to).ok) setEditing(null); }}>
                    <input aria-label={`New name for ${q}`} className={clsx(inputClass, 'h-8 py-1')} value={editing.to} onChange={(e) => setEditing({ from: q, to: e.target.value })} />
                    <Button size="sm" type="submit" variant="primary">Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 font-medium">{q}</span>
                    <span className="text-xs text-slate-400">{people} people · {open} open tickets</span>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ from: q, to: q })} aria-label={`Rename ${q}`}><Pencil className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(q)} disabled={squads.length < 2} aria-label={`Remove ${q}`}><Trash2 className="size-3.5" /></Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (addSquad(newSquad).ok) setNewSquad(''); }}>
          <input aria-label="New squad name" className={clsx(inputClass, 'h-9 max-w-xs py-1')} value={newSquad} onChange={(e) => setNewSquad(e.target.value)} placeholder="e.g. Service Desk – EMEA" />
          <Button type="submit" disabled={newSquad.trim().length < 2}><Plus className="size-3.5" />Add squad</Button>
        </form>
      </Card>

      <Card className="p-4">
        <fieldset>
          <legend className="text-sm font-semibold">Density</legend>
          <p className="mb-2 text-xs text-slate-400">Compact fits more tickets on screen. Text still scales with browser zoom.</p>
          <div className="flex gap-2">
            {(['comfortable', 'compact'] as const).map((d) => (
              <label key={d} className={clsx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm capitalize', density === d ? 'border-indigo-500 bg-indigo-500/[0.08]' : 'border-white/[0.08]')}>
                <input type="radio" name="density" className="accent-indigo-500" checked={density === d} onChange={() => setDensity(d)} />{d}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Modal open={confirmSolo} onClose={() => setConfirmSolo(false)} title="Switch to Solo?" subtitle="Every squad is merged into one “IT” team, including open tickets, people and articles. You can add squads again later.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmSolo(false)}>Cancel</Button>
          <Button variant="primary" data-autofocus onClick={() => { setOrgProfile('solo'); setConfirmSolo(false); }}>Switch to Solo</Button>
        </div>
      </Modal>
      <RemoveSquadModal name={removing} onClose={() => setRemoving(null)} />
    </section>
  );
}

function RemoveSquadModal({ name, onClose }: { name: string | null; onClose: () => void }) {
  const squads = usePlatformStore((s) => s.squads);
  const removeSquad = usePlatformStore((s) => s.removeSquad);
  const others = squads.filter((q) => q !== name);
  const [moveTo, setMoveTo] = useState('');
  const target = moveTo || others[0] || '';
  return (
    <Modal open={!!name} onClose={onClose} title={`Remove “${name}”?`} subtitle="Its tickets, people and articles move to another squad. Nothing is deleted.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name && removeSquad(name, target).ok) onClose(); }}>
        <Field label="Move everything to">
          <select className={inputClass} value={target} onChange={(e) => setMoveTo(e.target.value)}>
            {others.map((q) => <option key={q} className="bg-slate-900">{q}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger">Remove squad</Button>
        </div>
      </form>
    </Modal>
  );
}
