'use client';

import clsx from 'clsx';
import {
  Blocks,
  Bot,
  Download,
  FileClock,
  Gauge,
  KeyRound,
  Laptop,
  LayoutDashboard,
  ListChecks,
  Lock,
  Plug,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  Workflow,
  Cloud,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

import { Button, Card, Field, StatusBadge, inputClass } from '@/components/ui/primitives';
import { CURRENT_AGENT } from '@/data/seed';
import { useNow } from '@/hooks/useNow';
import { ACTION_LABEL, FIELD_LABEL, FIELD_OPTIONS, TRIGGER_LABEL } from '@/lib/automation';
import { timeAgo } from '@/lib/metrics';
import { SWARM_SQUADS, TICKET_STATUSES } from '@/lib/rules';
import { MAX_CUSTOM_FIELDS, MODULE_LABEL, usePlatformStore } from '@/store/usePlatformStore';
import type {
  AiSettings,
  AuditEntry,
  AutomationActionType,
  AutomationConditionField,
  AutomationRule,
  AutomationTrigger,
  CustomField,
  ModuleKey,
  Role,
  SwarmSquad,
  Ticket,
} from '@/types/platform';

const TABS = [
  ['modules', Blocks, 'Modules'],
  ['people', Users, 'People & squads'],
  ['sla', Gauge, 'SLA policies'],
  ['automations', Workflow, 'Automations'],
  ['fields', ListChecks, 'Fields & statuses'],
  ['ai', Bot, 'AI & grounding'],
  ['integrations', Plug, 'Integrations'],
  ['audit', FileClock, 'Audit log'],
] as const;
type Tab = (typeof TABS)[number][0];

export function AdminView() {
  const [tab, setTab] = useState<Tab>('modules');
  return (
    <div className="grid h-full min-h-0 md:grid-cols-[220px_1fr]">
      <nav className="border-b border-white/[0.08] p-3 md:border-b-0 md:border-r" aria-label="Admin sections">
        <h1 className="px-2 pb-2 text-base font-semibold tracking-tight">Admin console</h1>
        <div className="flex gap-1 overflow-x-auto md:flex-col">
          {TABS.map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key}
              className={clsx('flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition', tab === key ? 'bg-white/[0.07] text-slate-50' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100')}
            >
              <Icon className="size-4" />{label}
            </button>
          ))}
        </div>
        <p className="mt-4 hidden px-2 text-[11px] leading-relaxed text-slate-500 md:block">Every change here is versioned in the audit log. No developers or consultants required.</p>
      </nav>
      <div className="min-h-0 overflow-y-auto p-5">
        <div className="mx-auto max-w-5xl">
          {tab === 'modules' && <ModulesTab />}
          {tab === 'people' && <PeopleTab />}
          {tab === 'sla' && <SlaTab />}
          {tab === 'automations' && <AutomationsTab />}
          {tab === 'fields' && <FieldsTab />}
          {tab === 'ai' && <AiTab />}
          {tab === 'integrations' && <IntegrationsTab />}
          {tab === 'audit' && <AuditTab />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, description, children, action }: { title: string; description: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-slate-400">{description}</p>
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={clsx('relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60', checked ? 'bg-indigo-600 shadow-[0_0_12px_rgba(99,102,241,0.4)]' : 'bg-white/[0.12]')}
    >
      <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

// ------------------------------------------------------------------ modules

const MODULE_INFO: Record<ModuleKey, { icon: typeof Bot; description: string; includes: string }> = {
  itsm_core: { icon: LayoutDashboard, description: 'Tickets, problems, changes and knowledge with swarming, SLAs and handoff context.', includes: 'Tickets · Problems · Changes · Knowledge' },
  ai_agents: { icon: Bot, description: 'Conversational intake for employees and a grounded copilot for agents.', includes: 'Employee portal · Copilot · Pattern insights · Translation' },
  torii_saas: { icon: Cloud, description: 'SaaS discovery, shadow IT, spend and 1-click idle-seat reclamation.', includes: 'SaaS apps · Spend KPI · Licence context on tickets' },
  itam_cmdb: { icon: Laptop, description: 'Unlimited hardware and software assets linked to every ticket and change.', includes: 'CMDB · Asset context · Lifecycle' },
  password_vault: { icon: KeyRound, description: 'Zero-knowledge vault with 1-hour JIT elevation tied to open tickets.', includes: 'Vault · JIT access · Credential audit' },
};

function ModulesTab() {
  const flags = usePlatformStore((s) => s.flags);
  const toggleFlag = usePlatformStore((s) => s.toggleFlag);
  return (
    <Section title="Modules" description="Turn capabilities on or off. Disabled modules disappear from navigation, dashboards and side panels immediately.">
      <div className="grid gap-3 md:grid-cols-2">
        {(Object.keys(MODULE_LABEL) as ModuleKey[]).map((key) => {
          const info = MODULE_INFO[key];
          const Icon = info.icon;
          const locked = key === 'itsm_core';
          return (
            <Card key={key} className={clsx('p-4 transition', flags[key] ? 'border-indigo-500/25' : 'opacity-70')}>
              <div className="flex items-start gap-3">
                <span className={clsx('grid size-9 place-items-center rounded-lg', flags[key] ? 'bg-indigo-500/15 text-indigo-300' : 'bg-white/[0.05] text-slate-500')}><Icon className="size-4.5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-medium text-slate-100">{MODULE_LABEL[key]}{locked && <Lock className="size-3 text-slate-500" />}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{info.description}</p>
                  <p className="mt-1.5 text-[11px] text-slate-500">{info.includes}</p>
                </div>
                <Toggle checked={flags[key]} onChange={() => toggleFlag(key)} label={`${MODULE_LABEL[key]} module`} disabled={locked} />
              </div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ people

function PeopleTab() {
  const users = usePlatformStore((s) => s.users);
  const updateUser = usePlatformStore((s) => s.updateUser);
  const addUser = usePlatformStore((s) => s.addUser);
  const tickets = usePlatformStore((s) => s.tickets);
  const [form, setForm] = useState({ name: '', email: '', role: 'Agent' as Role, squad: 'Endpoint & Mac' as SwarmSquad });
  const load = (name: string) => tickets.filter((t) => t.status !== 'RESOLVED_KB_LINKED' && t.activeSwarmAgents.includes(name)).length;

  return (
    <Section title="People & squads" description="Squads swarm together — there are no personal queues. Roles control CAB approvals and admin access.">
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-3 py-2 font-medium">Person</th><th className="px-3 py-2 font-medium">Role</th><th className="px-3 py-2 font-medium">Squad</th><th className="px-3 py-2 font-medium">Swarming on</th><th className="px-3 py-2 font-medium">Active</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email} className="border-b border-white/[0.04]">
                <td className="px-3 py-2"><span className="block text-slate-100">{u.name}{u.name === CURRENT_AGENT && <span className="ml-1.5 text-[10px] text-indigo-300">you</span>}</span><span className="text-xs text-slate-500">{u.email}</span></td>
                <td className="px-3 py-2">
                  <select aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => updateUser(u.email, { role: e.target.value as Role })} className={clsx(inputClass, 'h-8 py-1 text-xs')}>
                    {(['Agent', 'Approver', 'Admin'] as const).map((r) => <option key={r} className="bg-slate-900">{r}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select aria-label={`Squad for ${u.name}`} value={u.squad} onChange={(e) => updateUser(u.email, { squad: e.target.value as SwarmSquad })} className={clsx(inputClass, 'h-8 py-1 text-xs')}>
                    {SWARM_SQUADS.map((s) => <option key={s} className="bg-slate-900">{s}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-300">{load(u.name)} tickets</td>
                <td className="px-3 py-2"><Toggle checked={u.active} onChange={() => updateUser(u.email, { active: !u.active })} label={`${u.name} active`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="p-4">
        <p className="mb-3 text-sm font-medium">Add a teammate</p>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_140px_180px_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim().length < 2) return;
            if (addUser({ ...form, name: form.name.trim(), email: form.email.trim().toLowerCase(), active: true }).ok) setForm({ ...form, name: '', email: '' });
          }}
        >
          <Field label="Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role">
            <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{(['Agent', 'Approver', 'Admin'] as const).map((r) => <option key={r} className="bg-slate-900">{r}</option>)}</select>
          </Field>
          <Field label="Squad">
            <select className={inputClass} value={form.squad} onChange={(e) => setForm({ ...form, squad: e.target.value as SwarmSquad })}>{SWARM_SQUADS.map((s) => <option key={s} className="bg-slate-900">{s}</option>)}</select>
          </Field>
          <Button type="submit" variant="primary" disabled={form.name.trim().length < 2 || !form.email.includes('@')}><Plus className="size-4" />Add</Button>
        </form>
      </Card>
    </Section>
  );
}

// ------------------------------------------------------------------ SLA

function SlaTab() {
  const policies = usePlatformStore((s) => s.slaPolicies);
  const update = usePlatformStore((s) => s.updateSlaPolicy);
  const [edits, setEdits] = useState<Record<string, { responseMinutes: number; resolutionMinutes: number }>>({});
  const fmt = (m: number) => (m >= 60 ? `${m / 60}h` : `${m}m`);
  return (
    <Section title="SLA policies" description="Granular response and resolution targets per priority. Timers pause automatically while waiting on the customer or a vendor.">
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-3 py-2 font-medium">Priority</th><th className="px-3 py-2 font-medium">First response (min)</th><th className="px-3 py-2 font-medium">Resolution (min)</th><th className="px-3 py-2 font-medium">Current</th><th /></tr>
          </thead>
          <tbody>
            {policies.map((p) => {
              const e = edits[p.priority] ?? { responseMinutes: p.responseMinutes, resolutionMinutes: p.resolutionMinutes };
              const dirty = e.responseMinutes !== p.responseMinutes || e.resolutionMinutes !== p.resolutionMinutes;
              return (
                <tr key={p.priority} className="border-b border-white/[0.04]">
                  <td className="px-3 py-2 font-mono font-semibold">{p.priority}</td>
                  <td className="px-3 py-2"><input type="number" min={1} aria-label={`${p.priority} response minutes`} className={clsx(inputClass, 'h-8 w-28 py-1')} value={e.responseMinutes} onChange={(ev) => setEdits({ ...edits, [p.priority]: { ...e, responseMinutes: Number(ev.target.value) } })} /></td>
                  <td className="px-3 py-2"><input type="number" min={1} aria-label={`${p.priority} resolution minutes`} className={clsx(inputClass, 'h-8 w-28 py-1')} value={e.resolutionMinutes} onChange={(ev) => setEdits({ ...edits, [p.priority]: { ...e, resolutionMinutes: Number(ev.target.value) } })} /></td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{fmt(p.responseMinutes)} / {fmt(p.resolutionMinutes)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="primary" disabled={!dirty} onClick={() => { if (update(p.priority, e).ok) setEdits((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== p.priority))); }}>Save</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card className="flex items-center gap-3 p-4 text-sm">
        <Lock className="size-4 text-slate-500" />
        <span className="text-slate-300">Pause SLA in <StatusBadge status="WAITING_ON_CUSTOMER" /> and <StatusBadge status="WAITING_ON_VENDOR" /></span>
        <span className="ml-auto text-xs text-slate-500">Always on — no workflow dead ends</span>
      </Card>
    </Section>
  );
}

// ------------------------------------------------------------------ automations

function AutomationsTab() {
  const rules = usePlatformStore((s) => s.automations);
  const toggle = usePlatformStore((s) => s.toggleAutomation);
  const remove = usePlatformStore((s) => s.deleteAutomation);
  const now = useNow();
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const blank = (): AutomationRule => ({ id: `auto-${crypto.randomUUID().slice(0, 6)}`, name: '', enabled: true, trigger: 'ticket_created', conditions: [], actions: [{ type: 'notify_slack', value: '' }], runs: 0 });

  return (
    <Section
      title="Workflow automations"
      description="Visual When → If → Then rules. No code. Automations add context and notify people — they never change status or ownership silently."
      action={<Button variant="primary" onClick={() => setEditing(blank())}><Plus className="size-4" />New automation</Button>}
    >
      {editing && <AutomationBuilder rule={editing} onClose={() => setEditing(null)} />}
      <div className="space-y-2">
        {rules.map((r) => (
          <Card key={r.id} className={clsx('flex flex-wrap items-center gap-3 p-4', !r.enabled && 'opacity-60')}>
            <Zap className={clsx('size-4', r.enabled ? 'text-amber-300' : 'text-slate-500')} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-100">{r.name}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                <span className="text-slate-500">When</span> {TRIGGER_LABEL[r.trigger].toLowerCase()}
                {r.conditions.length > 0 && <> <span className="text-slate-500">if</span> {r.conditions.map((c) => `${FIELD_LABEL[c.field].toLowerCase()} ${c.op === 'is' ? 'is' : 'is not'} ${c.value}`).join(' and ')}</>}
                {' '}<span className="text-slate-500">then</span> {r.actions.map((a) => `${ACTION_LABEL[a.type].toLowerCase()} ${a.value}`).join(', ')}
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500">{r.runs} runs{r.lastRunAt ? ` · ${timeAgo(r.lastRunAt, now)}` : ''}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => remove(r.id)} aria-label={`Delete ${r.name}`}><Trash2 className="size-3.5" /></Button>
            <Toggle checked={r.enabled} onChange={() => toggle(r.id)} label={`${r.name} enabled`} />
          </Card>
        ))}
      </div>
    </Section>
  );
}

function AutomationBuilder({ rule, onClose }: { rule: AutomationRule; onClose: () => void }) {
  const save = usePlatformStore((s) => s.saveAutomation);
  const users = usePlatformStore((s) => s.users);
  const [r, setR] = useState(rule);
  const block = 'rounded-xl border border-white/[0.08] bg-white/[0.02] p-3';
  return (
    <Card className="space-y-3 border-indigo-500/30 p-4">
      <Field label="Automation name"><input className={inputClass} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. P1 → page on-call" /></Field>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className={block}>
          <p className="mb-2 text-xs font-semibold text-sky-300">WHEN</p>
          <select aria-label="Trigger" className={inputClass} value={r.trigger} onChange={(e) => setR({ ...r, trigger: e.target.value as AutomationTrigger })}>
            {(Object.keys(TRIGGER_LABEL) as AutomationTrigger[]).map((t) => <option key={t} value={t} className="bg-slate-900">{TRIGGER_LABEL[t]}</option>)}
          </select>
        </div>
        <div className={block}>
          <p className="mb-2 text-xs font-semibold text-amber-300">IF <span className="font-normal text-slate-500">(all must match)</span></p>
          <div className="space-y-2">
            {r.conditions.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_1fr_auto] gap-1">
                <select aria-label="Condition field" className={clsx(inputClass, 'px-1.5 text-xs')} value={c.field} onChange={(e) => { const field = e.target.value as AutomationConditionField; setR({ ...r, conditions: r.conditions.map((x, j) => (j === i ? { ...x, field, value: FIELD_OPTIONS[field][0]! } : x)) }); }}>
                  {(Object.keys(FIELD_LABEL) as AutomationConditionField[]).map((f) => <option key={f} value={f} className="bg-slate-900">{FIELD_LABEL[f]}</option>)}
                </select>
                <select aria-label="Operator" className={clsx(inputClass, 'px-1.5 text-xs')} value={c.op} onChange={(e) => setR({ ...r, conditions: r.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as 'is' | 'is_not' } : x)) })}>
                  <option value="is" className="bg-slate-900">is</option><option value="is_not" className="bg-slate-900">is not</option>
                </select>
                <select aria-label="Condition value" className={clsx(inputClass, 'px-1.5 text-xs')} value={c.value} onChange={(e) => setR({ ...r, conditions: r.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}>
                  {FIELD_OPTIONS[c.field].map((v) => <option key={v} className="bg-slate-900">{v}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={() => setR({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })} aria-label="Remove condition"><Trash2 className="size-3" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setR({ ...r, conditions: [...r.conditions, { field: 'priority', op: 'is', value: 'P1' }] })}><Plus className="size-3" />Condition</Button>
          </div>
        </div>
        <div className={block}>
          <p className="mb-2 text-xs font-semibold text-emerald-300">THEN</p>
          <div className="space-y-2">
            {r.actions.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1">
                <select aria-label="Action" className={clsx(inputClass, 'px-1.5 text-xs')} value={a.type} onChange={(e) => setR({ ...r, actions: r.actions.map((x, j) => (j === i ? { type: e.target.value as AutomationActionType, value: '' } : x)) })}>
                  {(Object.keys(ACTION_LABEL) as AutomationActionType[]).map((t) => <option key={t} value={t} className="bg-slate-900">{ACTION_LABEL[t]}</option>)}
                </select>
                {a.type === 'add_swarm_agent' ? (
                  <select aria-label="Agent" className={clsx(inputClass, 'px-1.5 text-xs')} value={a.value} onChange={(e) => setR({ ...r, actions: r.actions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}>
                    <option value="" className="bg-slate-900">Pick agent…</option>
                    {users.filter((u) => u.active).map((u) => <option key={u.email} className="bg-slate-900">{u.name}</option>)}
                  </select>
                ) : (
                  <input aria-label="Action value" className={clsx(inputClass, 'px-1.5 text-xs')} value={a.value} onChange={(e) => setR({ ...r, actions: r.actions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} placeholder={a.type.startsWith('notify') ? '#channel' : a.type === 'page_oncall' ? 'Rotation' : 'Note text'} />
                )}
                <Button size="sm" variant="ghost" disabled={r.actions.length === 1} onClick={() => setR({ ...r, actions: r.actions.filter((_, j) => j !== i) })} aria-label="Remove action"><Trash2 className="size-3" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setR({ ...r, actions: [...r.actions, { type: 'post_internal_note', value: '' }] })}><Plus className="size-3" />Action</Button>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => save({ ...r, name: r.name.trim() }).ok && onClose()}>Save automation</Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ fields & statuses

function FieldsTab() {
  const fields = usePlatformStore((s) => s.customFields);
  const add = usePlatformStore((s) => s.addCustomField);
  const update = usePlatformStore((s) => s.updateCustomField);
  const remove = usePlatformStore((s) => s.removeCustomField);
  const [f, setF] = useState({ label: '', type: 'text' as CustomField['type'], appliesTo: ['INCIDENT'] as Ticket['type'][], required: false });

  return (
    <Section title="Fields & statuses" description="Guardrails against the “Jira trap”: five statuses with active/waiting pairs, and a hard cap on custom fields.">
      <Card className="p-4">
        <p className="text-sm font-medium">Ticket statuses <span className="ml-1 text-xs font-normal text-slate-500">locked — no status zoo</span></p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {TICKET_STATUSES.map((s) => <StatusBadge key={s} status={s} />)}
        </div>
        <p className="mt-2 text-xs text-slate-500">Every active state has a waiting pair that pauses the SLA. Need more nuance? Use a field or a tag, not a new status.</p>
      </Card>
      <Card className="overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-sm">
          <span className="font-medium">Custom fields</span>
          <span className={clsx('font-mono text-xs', fields.length >= MAX_CUSTOM_FIELDS ? 'text-rose-300' : 'text-slate-500')}>{fields.length} / {MAX_CUSTOM_FIELDS}</span>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-3 py-2 font-medium">Field</th><th className="px-3 py-2 font-medium">Applies to</th><th className="px-3 py-2 font-medium">Filled (30d)</th><th className="px-3 py-2 font-medium">Required</th><th className="px-3 py-2 font-medium">Health</th><th /></tr>
          </thead>
          <tbody>
            {fields.map((x) => {
              const health = x.usage30d === 0 ? ['Unused — archive it', 'text-rose-300'] : x.required && x.usage30d < 30 ? ['Required but rarely filled — friction', 'text-amber-300'] : x.usage30d < 10 ? ['Rarely used', 'text-amber-300'] : ['Healthy', 'text-emerald-300'];
              return (
                <tr key={x.id} className="border-t border-white/[0.04]">
                  <td className="px-3 py-2"><span className="text-slate-100">{x.label}</span> <span className="text-xs text-slate-500">{x.type}</span></td>
                  <td className="px-3 py-2 text-xs text-slate-400">{x.appliesTo.map((t) => t.replace('_', ' ').toLowerCase()).join(', ')}</td>
                  <td className="px-3 py-2"><span className="flex items-center gap-2"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full bg-indigo-500" style={{ width: `${x.usage30d}%` }} /></span><span className="font-mono text-xs">{x.usage30d}%</span></span></td>
                  <td className="px-3 py-2"><Toggle checked={x.required} onChange={() => update(x.id, { required: !x.required })} label={`${x.label} required`} /></td>
                  <td className={clsx('px-3 py-2 text-xs', health[1])}>{health[0]}</td>
                  <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => remove(x.id)} aria-label={`Archive ${x.label}`}><Trash2 className="size-3.5" /></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card className="p-4">
        <p className="mb-3 text-sm font-medium">Add a field</p>
        <form className="grid gap-3 sm:grid-cols-[1fr_120px_1fr_auto_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (add(f).ok) setF({ ...f, label: '' }); }}>
          <Field label="Label"><input className={inputClass} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="Type">
            <select className={inputClass} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CustomField['type'] })}>{(['text', 'select', 'date', 'number'] as const).map((t) => <option key={t} className="bg-slate-900">{t}</option>)}</select>
          </Field>
          <fieldset className="flex flex-wrap gap-2 text-xs text-slate-300">
            <legend className="mb-1 text-xs text-slate-400">Applies to</legend>
            {(['INCIDENT', 'SERVICE_REQUEST', 'CHANGE'] as const).map((t) => (
              <label key={t} className="flex items-center gap-1"><input type="checkbox" className="accent-indigo-500" checked={f.appliesTo.includes(t)} onChange={(e) => setF({ ...f, appliesTo: e.target.checked ? [...f.appliesTo, t] : f.appliesTo.filter((x) => x !== t) })} />{t.replace('_', ' ').toLowerCase()}</label>
            ))}
          </fieldset>
          <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-300"><input type="checkbox" className="accent-indigo-500" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} />Required</label>
          <Button type="submit" variant="primary" disabled={!f.label.trim() || fields.length >= MAX_CUSTOM_FIELDS}><Plus className="size-4" />Add</Button>
        </form>
      </Card>
    </Section>
  );
}

// ------------------------------------------------------------------ AI

function AiTab() {
  const settings = usePlatformStore((s) => s.aiSettings);
  const update = usePlatformStore((s) => s.updateAiSettings);
  const aiOn = usePlatformStore((s) => s.flags.ai_agents);
  const [threshold, setThreshold] = useState(Math.round(settings.confidenceThreshold * 100));
  const levels: [AiSettings['autonomy'], string, string][] = [
    ['suggest_only', 'Suggest only', 'The AI drafts and recommends. Humans do everything.'],
    ['self_service_deflection', 'Self-service deflection', 'The portal AI may answer employees with articles you marked self-service. Agents approve everything else.'],
    ['auto_resolve_low_risk', 'Auto-resolve low risk', 'Also lets the AI close P4 requests when a self-service article matches above the threshold. Macros still always need a human.'],
  ];
  const sources: [keyof AiSettings['sources'], string, string][] = [
    ['knowledgeBase', 'Knowledge base', 'Published articles, with citations'],
    ['closedTickets', 'Closed tickets', 'How your team solved similar issues'],
    ['cmdb', 'CMDB telemetry', 'Device, MDM and FileVault state'],
    ['internetFallback', 'Internet fallback (basic IT only)', 'Public guidance for generic questions when nothing internal matches — always labelled'],
  ];
  return (
    <Section title="AI & grounding" description="50/50 AI + human: decide how much the AI does on its own and what it may base answers on.">
      {!aiOn && <p className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm text-amber-200">The AI Agents module is off — these settings apply when you turn it back on.</p>}
      <Card className="space-y-2 p-4">
        <p className="text-sm font-medium">Autonomy</p>
        {levels.map(([key, label, desc]) => (
          <label key={key} className={clsx('flex cursor-pointer gap-3 rounded-xl border p-3', settings.autonomy === key ? 'border-indigo-500/40 bg-indigo-500/[0.07]' : 'border-white/[0.06] hover:border-white/[0.12]')}>
            <input type="radio" name="autonomy" className="mt-1 accent-indigo-500" checked={settings.autonomy === key} onChange={() => update({ autonomy: key })} />
            <span><span className="font-medium text-slate-100">{label}</span><span className="block text-xs text-slate-400">{desc}</span></span>
          </label>
        ))}
      </Card>
      <Card className="p-4">
        <p className="text-sm font-medium">Confidence threshold <span className="font-mono text-indigo-300">{threshold}%</span></p>
        <p className="text-xs text-slate-400">Below this, the AI never answers employees or offers one-click resolution — it only shows the match for a human to judge.</p>
        <div className="mt-3 flex items-center gap-3">
          <input type="range" min={50} max={99} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="flex-1 accent-indigo-500" aria-label="Confidence threshold" />
          <Button size="sm" variant="primary" disabled={threshold === Math.round(settings.confidenceThreshold * 100)} onClick={() => update({ confidenceThreshold: threshold / 100 })}>Save</Button>
        </div>
      </Card>
      <Card className="space-y-3 p-4">
        <p className="text-sm font-medium">Grounding sources</p>
        {sources.map(([key, label, desc]) => (
          <div key={key} className="flex items-center gap-3">
            <span className="min-w-0 flex-1"><span className="text-sm text-slate-100">{label}</span><span className="block text-xs text-slate-400">{desc}</span></span>
            <Toggle checked={settings.sources[key]} onChange={() => update({ sources: { ...settings.sources, [key]: !settings.sources[key] } })} label={label} />
          </div>
        ))}
        <div className="flex items-center gap-3 border-t border-white/[0.06] pt-3">
          <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-sm text-slate-100"><ShieldCheck className="size-4 text-emerald-400" />Human approval for remediation macros</span><span className="block text-xs text-slate-400">Locked on. The AI can prepare a fix; only a person can run it.</span></span>
          <Toggle checked onChange={() => undefined} label="Human approval for macros" disabled />
        </div>
      </Card>
    </Section>
  );
}

// ------------------------------------------------------------------ integrations

function IntegrationsTab() {
  const integrations = usePlatformStore((s) => s.integrations);
  const toggle = usePlatformStore((s) => s.toggleIntegration);
  return (
    <Section title="Integrations" description="Lightweight connectors — no consultants. Employees can raise and follow tickets from Slack and Teams.">
      <div className="grid gap-3 md:grid-cols-2">
        {integrations.map((i) => (
          <Card key={i.key} className="flex items-start gap-3 p-4">
            <span className={clsx('mt-0.5 size-2.5 shrink-0 rounded-full', i.connected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]' : 'bg-slate-600')} />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-100">{i.name} <span className="ml-1 text-[11px] font-normal text-slate-500">{i.category}</span></p>
              <p className="mt-0.5 text-xs text-slate-400">{i.detail}</p>
            </div>
            <Toggle checked={i.connected} onChange={() => toggle(i.key)} label={`${i.name} connected`} disabled={i.key === 'secret_manager'} />
          </Card>
        ))}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ audit

function AuditTab() {
  const log = usePlatformStore((s) => s.auditLog);
  const now = useNow();
  const [category, setCategory] = useState<AuditEntry['category'] | 'all'>('all');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = log.filter((e) => (category === 'all' || e.category === category) && (!q || `${e.actor} ${e.action} ${e.entity} ${e.detail}`.toLowerCase().includes(q)));

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const csv = ['timestamp,actor,category,action,entity,detail', ...rows.map((e) => [e.timestamp, e.actor, e.category, e.action, e.entity, e.detail].map(esc).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `adminzero-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Section
      title="Audit log"
      description="Immutable, append-only record of every human, AI and automation action. Included on every plan."
      action={<Button onClick={exportCsv} disabled={!rows.length}><Download className="size-4" />Export CSV</Button>}
    >
      <div className="flex flex-wrap gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search actor, action, entity…" aria-label="Search audit log" className={clsx(inputClass, 'max-w-xs')} />
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as AuditEntry['category'] | 'all')} className={clsx(inputClass, 'w-auto')}>
          {['all', 'ticket', 'problem', 'change', 'knowledge', 'ai', 'automation', 'vault', 'saas', 'asset', 'admin'].map((c) => <option key={c} className="bg-slate-900">{c}</option>)}
        </select>
        <span className="self-center font-mono text-xs text-slate-500">{rows.length} entries</span>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Actor</th><th className="px-3 py-2 font-medium">Action</th><th className="px-3 py-2 font-medium">Entity</th><th className="px-3 py-2 font-medium">Detail</th></tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-white/[0.04] align-top">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500" title={e.timestamp}>{timeAgo(e.timestamp, now)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-300">{e.actor}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs"><span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{e.category}</span> <span className="text-slate-200">{e.action}</span></td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-300">{e.entity}</td>
                <td className="px-3 py-2 text-xs text-slate-400">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}
