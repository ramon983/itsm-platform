'use client';

import clsx from 'clsx';
import { AlertTriangle, KeyRound, Laptop, Recycle, Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Button, Card, inputClass } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { timeAgo, usd } from '@/lib/metrics';
import { formatSla } from '@/lib/sla';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { AssetLifecycle } from '@/types/platform';

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-slate-400">{description}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={clsx('mt-1.5 font-mono text-2xl font-semibold tracking-tight', tone)}>{value}</p>
    </Card>
  );
}

// ------------------------------------------------------------------ SaaS

export function SaasView() {
  const apps = usePlatformStore((s) => s.saasApps);
  const reclaimed = usePlatformStore((s) => s.reclaimedMonthlySavings);
  const reclaim = usePlatformStore((s) => s.reclaimIdleSeats);
  const openInspector = usePlatformStore((s) => s.openInspector);
  const now = useNow();
  const [filter, setFilter] = useState<'all' | 'shadow' | 'idle' | 'renewal'>('all');
  const [query, setQuery] = useState('');
  const annual = apps.reduce((n, a) => n + a.annualSpend, 0);
  const reclaimable = apps.reduce((n, a) => n + a.inactiveUsers.length * a.costPerSeatMonthly, 0);
  const days = (iso: string) => Math.ceil((Date.parse(iso) - now) / 86_400_000);
  const list = apps
    .filter((a) => (filter === 'shadow' ? !a.approved : filter === 'idle' ? a.inactiveUsers.length > 0 : filter === 'renewal' ? days(a.renewalDate) < 30 : true))
    .filter((a) => !query.trim() || `${a.name} ${a.vendor} ${a.category}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="mx-auto max-w-[1300px] space-y-4 p-5">
      <PageHeader title="SaaS management" description="Discovery from SSO, OAuth and expenses. Reclaim idle seats in one click — every reclaim is audited." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Annual SaaS spend" value={usd(annual)} />
        <Stat label="Reclaimable / month" value={usd(reclaimable)} tone="text-amber-200" />
        <Stat label="Idle seats (45+ days)" value={String(apps.reduce((n, a) => n + a.inactiveUsers.length, 0))} />
        <Stat label="Saved so far / month" value={usd(reclaimed)} tone="text-emerald-300" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {([['all', 'All'], ['shadow', 'Shadow IT / unapproved'], ['idle', 'Idle seats > 0'], ['renewal', 'Renewal < 30 days']] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={clsx('rounded-full border px-2.5 py-1 text-xs', filter === k ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200' : 'border-white/[0.08] text-slate-400 hover:text-slate-200')}>{l}</button>
        ))}
        <div className="relative ml-auto w-64">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-slate-500" />
          <input aria-label="Search apps" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps…" className={clsx(inputClass, 'h-8 py-1 pl-8 text-xs')} />
        </div>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-3 py-2 font-medium">App</th><th className="px-3 py-2 font-medium">Seats</th><th className="px-3 py-2 font-medium">Annual</th><th className="px-3 py-2 font-medium">Renewal</th><th className="px-3 py-2 font-medium">OAuth risk</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="border-b border-white/[0.04]">
                <td className="px-3 py-2.5">
                  <button type="button" className="text-left" onClick={() => openInspector({ kind: 'saas', id: a.id })}>
                    <span className="block text-slate-100 hover:underline">{a.name}</span>
                    <span className="text-xs text-slate-500">{a.category} · via {a.discoveredVia}{!a.approved && <span className="ml-1 text-rose-300">· unapproved</span>}</span>
                  </button>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs">{a.activeSeats}/{a.provisionedSeats}{a.inactiveUsers.length > 0 && <span className="ml-1 text-amber-300">({a.inactiveUsers.length} idle)</span>}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{usd(a.annualSpend)}</td>
                <td className={clsx('px-3 py-2.5 font-mono text-xs', days(a.renewalDate) < 30 && 'text-amber-300')}>{days(a.renewalDate)}d</td>
                <td className={clsx('px-3 py-2.5 text-xs', a.oauthRisk === 'High' ? 'text-rose-300' : a.oauthRisk === 'Medium' ? 'text-amber-300' : 'text-slate-400')}>{a.oauthRisk}</td>
                <td className="px-3 py-2.5 text-right">
                  <Button size="sm" disabled={!a.inactiveUsers.length} onClick={() => reclaim(a.id)}>
                    <Recycle className="size-3.5" />Reclaim {a.inactiveUsers.length ? usd(a.inactiveUsers.length * a.costPerSeatMonthly) + '/mo' : ''}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Assets

const LIFECYCLES: AssetLifecycle[] = ['Procured', 'In Stock', 'Deployed', 'In Repair', 'Retired'];

export function AssetsView() {
  const assets = usePlatformStore((s) => s.assets);
  const tickets = usePlatformStore((s) => s.tickets);
  const openInspector = usePlatformStore((s) => s.openInspector);
  const [stage, setStage] = useState<AssetLifecycle | 'all'>('all');
  const [query, setQuery] = useState('');
  const list = assets
    .filter((a) => stage === 'all' || a.lifecycle === stage)
    .filter((a) => !query.trim() || `${a.id} ${a.name} ${a.serialNumber} ${a.assignedTo ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const openFor = (id: string) => tickets.filter((t) => t.status !== 'RESOLVED_KB_LINKED' && (t.linkedAssetId === id)).length;

  return (
    <div className="mx-auto max-w-[1300px] space-y-4 p-5">
      <PageHeader title="Assets / CMDB" description="Unlimited hardware and software assets — no pricing walls. Every asset links to its incidents and changes." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Tracked assets" value={String(assets.length)} />
        <Stat label="Deployed" value={String(assets.filter((a) => a.lifecycle === 'Deployed').length)} />
        <Stat label="Not in MDM" value={String(assets.filter((a) => a.category !== 'Network' && !a.mdmEnrolled).length)} tone="text-amber-200" />
        <Stat label="With open tickets" value={String(assets.filter((a) => openFor(a.id) > 0).length)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(['all', ...LIFECYCLES] as const).map((l) => (
          <button key={l} type="button" aria-pressed={stage === l} onClick={() => setStage(l)} className={clsx('rounded-full border px-2.5 py-1 text-xs', stage === l ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200' : 'border-white/[0.08] text-slate-400 hover:text-slate-200')}>
            {l === 'all' ? 'All stages' : l} <span className="font-mono opacity-60">{l === 'all' ? assets.length : assets.filter((a) => a.lifecycle === l).length}</span>
          </button>
        ))}
        <div className="relative ml-auto w-64">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-slate-500" />
          <input aria-label="Search assets" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tag, serial, owner…" className={clsx(inputClass, 'h-8 py-1 pl-8 text-xs')} />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((a) => (
          <button key={a.id} type="button" onClick={() => openInspector({ kind: 'asset', id: a.id })} className="text-left">
            <Card className="h-full p-4 transition hover:border-white/[0.16]">
              <div className="flex items-center gap-2">
                <Laptop className="size-4 text-slate-400" />
                <span className="font-mono text-sm text-slate-100">{a.id}</span>
                <span className="ml-auto rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[11px] text-slate-300">{a.lifecycle}</span>
              </div>
              <p className="mt-2 text-sm text-slate-200">{a.name}</p>
              <p className="text-xs text-slate-500">{a.assignedTo ?? 'Unassigned'} · {a.location}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                {a.category !== 'Network' && <span className={a.mdmEnrolled ? 'text-emerald-300' : 'text-amber-300'}>{a.mdmEnrolled ? 'MDM ✓' : 'Not in MDM'}</span>}
                {a.fileVault !== 'N/A' && <span className={a.fileVault === 'Encrypted' ? 'text-emerald-300' : 'text-rose-300'}>FileVault {a.fileVault}</span>}
                {openFor(a.id) > 0 && <span className="text-indigo-300">{openFor(a.id)} open ticket(s)</span>}
              </div>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Vault

export function VaultView() {
  const vault = usePlatformStore((s) => s.vault);
  const auditLog = usePlatformStore((s) => s.auditLog);
  const openJitModal = usePlatformStore((s) => s.openJitModal);
  const revoke = usePlatformStore((s) => s.revokeJitAccess);
  const now = useNow();
  const vaultAudit = auditLog.filter((e) => e.category === 'vault').slice(0, 12);

  return (
    <div className="mx-auto max-w-[1300px] space-y-4 p-5">
      <PageHeader title="Password vault" description="Zero-knowledge: credentials are only released for 1 hour, tied to an open ticket, and every attempt is audited." />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-white/[0.06] text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-3 py-2 font-medium">Credential</th><th className="px-3 py-2 font-medium">Scope</th><th className="px-3 py-2 font-medium">Squads</th><th className="px-3 py-2 font-medium">Rotated</th><th className="px-3 py-2 font-medium">Access</th></tr>
          </thead>
          <tbody>
            {vault.map((v) => {
              const active = v.activeGrant && Date.parse(v.activeGrant.expiresAt) > now ? v.activeGrant : null;
              return (
                <tr key={v.id} className="border-b border-white/[0.04]">
                  <td className="px-3 py-2.5"><span className="flex items-center gap-2 text-slate-100"><KeyRound className="size-3.5 text-slate-500" />{v.name}</span><span className="ml-5 text-xs text-slate-500">{v.kind}</span></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{v.scope}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">{v.allowedSquads.join(', ')}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">{timeAgo(v.lastRotated, now)} · every {v.rotationDays}d</td>
                  <td className="px-3 py-2.5">
                    {active ? (
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs text-emerald-300">{active.agentName} · {active.ticketId} · {formatSla(Math.round((Date.parse(active.expiresAt) - now) / 1000))}</span>
                        <Button size="sm" variant="danger" onClick={() => revoke(v.id)}>Revoke</Button>
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => openJitModal({ vaultId: v.id })}><ShieldCheck className="size-3.5" />Grant 1-hour JIT</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Vault audit trail</h2>
        <ul className="space-y-1.5 text-xs">
          {vaultAudit.map((e) => (
            <li key={e.id} className="flex gap-2">
              {e.action.includes('denied') ? <AlertTriangle className="size-3.5 shrink-0 text-rose-400" /> : <ShieldCheck className="size-3.5 shrink-0 text-emerald-400" />}
              <span className="text-slate-300">{e.action}</span>
              <span className="text-slate-500">{e.entity} · {e.detail}</span>
              <span className="ml-auto whitespace-nowrap text-slate-500">{e.actor} · {timeAgo(e.timestamp, now)}</span>
            </li>
          ))}
          {!vaultAudit.length && <li className="text-slate-500">No vault activity yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
