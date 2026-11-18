'use client';

import clsx from 'clsx';
import { Recycle, X } from 'lucide-react';

import { Button, Drawer, StatusBadge } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { usd } from '@/lib/metrics';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { SaasApp } from '@/types/platform';

export function SaasInspectorDrawer() {
  const inspector = usePlatformStore((s) => s.inspector);
  const close = usePlatformStore((s) => s.closeInspector);
  const enabled = usePlatformStore((s) => s.flags.torii_saas);
  const app = usePlatformStore((s) =>
    s.inspector?.kind === 'saas' ? s.saasApps.find((a) => a.id === s.inspector!.id) : undefined,
  );
  return (
    <Drawer open={inspector?.kind === 'saas' && !!app && enabled} onClose={close} label="SaaS licence inspector">
      {app && <SaasInspector app={app} onClose={close} />}
    </Drawer>
  );
}

function SaasInspector({ app, onClose }: { app: SaasApp; onClose: () => void }) {
  const now = useNow();
  const reclaim = usePlatformStore((s) => s.reclaimIdleSeats);
  const openInspector = usePlatformStore((s) => s.openInspector);
  const allTickets = usePlatformStore((s) => s.tickets);
  const tickets = allTickets.filter((t) => t.linkedSaasId === app.id);
  const renewalDays = Math.ceil((Date.parse(app.renewalDate) - now) / 86_400_000);
  const idleMonthly = app.inactiveUsers.length * app.costPerSeatMonthly;
  const utilisation = app.provisionedSeats ? (app.activeSeats / app.provisionedSeats) * 100 : 0;

  return (
    <>
      <header className="flex items-start gap-3 border-b border-white/[0.08] p-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-400">{app.vendor} · {app.category} · discovered via {app.discoveredVia}</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-50">{app.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <span className={clsx('rounded-md border px-1.5 py-0.5', app.approved ? 'border-emerald-500/20 text-emerald-300' : 'border-rose-500/30 text-rose-300')}>
              {app.approved ? 'Approved' : 'Shadow IT · unapproved'}
            </span>
            <span className={clsx('rounded-md border px-1.5 py-0.5', app.oauthRisk === 'High' ? 'border-rose-500/30 text-rose-300' : app.oauthRisk === 'Medium' ? 'border-amber-500/20 text-amber-300' : 'border-white/[0.08] text-slate-300')}>
              OAuth risk: {app.oauthRisk}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <section className="grid grid-cols-3 gap-3">
          {[
            ['Annual spend', usd(app.annualSpend)],
            ['Seats active', `${app.activeSeats}/${app.provisionedSeats}`],
            ['Renewal', renewalDays < 0 ? 'Lapsed' : `${renewalDays}d`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">{k}</p>
              <p className="mt-1 font-mono text-base font-semibold text-slate-100">{v}</p>
            </div>
          ))}
        </section>
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-400"><span>Utilisation</span><span className="font-mono">{utilisation.toFixed(0)}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${utilisation}%` }} />
          </div>
        </div>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Idle seats ({app.inactiveUsers.length}) · no Okta SSO login 45+ days</h3>
          </div>
          <ul className="max-h-56 divide-y divide-white/[0.05] overflow-y-auto rounded-xl border border-white/[0.06]">
            {app.inactiveUsers.map((u) => (
              <li key={u.email} className="flex items-center justify-between px-3 py-2 text-xs">
                <span><span className="text-slate-200">{u.name}</span> <span className="text-slate-500">{u.email}</span></span>
                <span className="font-mono text-amber-300">{u.lastSsoLoginDaysAgo}d</span>
              </li>
            ))}
            {!app.inactiveUsers.length && <li className="px-3 py-3 text-xs text-emerald-300">Every seat is in use.</li>}
          </ul>
          <Button className="mt-3 w-full" variant="primary" disabled={!app.inactiveUsers.length} onClick={() => reclaim(app.id)}>
            <Recycle className="size-4" />Reclaim {app.inactiveUsers.length} idle seats · save {usd(idleMonthly)}/mo
          </Button>
        </section>
        {tickets.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Linked tickets</h3>
            <ul className="space-y-1.5">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => openInspector({ kind: 'ticket', id: t.id })} className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] p-2.5 text-left hover:border-white/[0.16]">
                    <span className="font-mono text-xs text-slate-300">{t.id}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{t.title}</span>
                    <StatusBadge status={t.status} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
