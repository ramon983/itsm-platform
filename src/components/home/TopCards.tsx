'use client';

import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Gauge, PhoneCall, Siren, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

import { AvatarStack, Card } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { computeKpis } from '@/lib/metrics';
import { onCallNow } from '@/lib/people';
import { SWARM_SQUADS } from '@/lib/rules';
import { liveSlaSeconds } from '@/lib/sla';
import { usePlatformStore } from '@/store/usePlatformStore';

const DAY = 86_400_000;

function Shell({ icon, title, onClick, children }: { icon: ReactNode; title: string; accent?: string; onClick?: () => void; children: ReactNode }) {
  const body = (
    <Card className={clsx('relative h-full overflow-hidden p-4 text-left transition', onClick && 'hover:border-white/[0.16]')}>
      <p className="flex items-center gap-2 text-xs font-medium text-slate-400">{icon}{title}</p>
      <div className="mt-2">{children}</div>
    </Card>
  );
  return onClick ? <button type="button" onClick={onClick} className="text-left">{body}</button> : body;
}

export function Last7DaysCard() {
  const tickets = usePlatformStore((s) => s.tickets);
  const closed = usePlatformStore((s) => s.closedTickets);
  const setView = usePlatformStore((s) => s.setView);
  const now = useNow();
  const created = [
    ...tickets.map((t) => Date.parse(t.messages[0]?.timestamp ?? '')),
    ...closed.map((c) => Date.parse(c.closedAt) - c.minutesToResolve * 60_000),
  ].filter(Number.isFinite);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const from = start.getTime() - (6 - i) * DAY;
    return { label: new Date(from).toLocaleDateString(undefined, { weekday: 'narrow' }), count: created.filter((t) => t >= from && t < from + DAY).length };
  });
  const total = days.reduce((n, d) => n + d.count, 0);
  const prev = created.filter((t) => t >= start.getTime() - 13 * DAY && t < start.getTime() - 6 * DAY).length;
  const delta = prev ? Math.round(((total - prev) / prev) * 100) : 0;
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <Shell icon={<Inbox className="size-4 text-sky-400" />} title="Last 7 days" accent="bg-sky-500/20" onClick={() => setView('tickets')}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-3xl font-semibold tracking-tight">{total}</p>
          <p className="text-xs text-slate-500">tickets came in</p>
          {prev > 0 && (
            <p className={clsx('mt-1 flex items-center gap-0.5 text-[11px]', delta > 0 ? 'text-amber-300' : 'text-emerald-300')}>
              {delta > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{Math.abs(delta)}% vs previous week
            </p>
          )}
        </div>
        <div className="flex h-14 items-end gap-1" role="img" aria-label={`Tickets per day: ${days.map((d) => d.count).join(', ')}`}>
          {days.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <span className={clsx('w-3 rounded-sm', i === 6 ? 'bg-sky-400' : 'bg-sky-500/40')} style={{ height: `${Math.max(3, (d.count / max) * 40)}px` }} title={`${d.count}`} />
              <span className="text-[9px] text-slate-500">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function OnCallCard() {
  const users = usePlatformStore((s) => s.users);
  const timeOff = usePlatformStore((s) => s.timeOff);
  const now = useNow();
  const rota = onCallNow(users, timeOff, SWARM_SQUADS, now);
  const handover = rota[0]?.handoverAt;
  return (
    <Shell icon={<PhoneCall className="size-4 text-emerald-400" />} title="On call now" accent="bg-emerald-500/20">
      <ul className="space-y-1.5">
        {rota.map((r) => {
          const who = r.covering ?? r.primary;
          return (
            <li key={r.squad} className="flex items-center gap-2 text-xs">
              <AvatarStack names={[who.name]} max={1} />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-slate-100">{who.name.split(' ')[0]}</span>
                <span className="text-slate-500"> · {r.squad.split(' ')[0]}</span>
              </span>
              {r.covering && <span className="whitespace-nowrap rounded bg-amber-400/15 px-1 text-[10px] text-amber-200" title={`${r.primary.name} is out today`}>covering</span>}
            </li>
          );
        })}
      </ul>
      {handover && <p className="mt-2 text-[10px] text-slate-500">Handover {handover.toLocaleDateString(undefined, { weekday: 'short' })} {handover.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p>}
    </Shell>
  );
}

export function NeedsHumanCard() {
  const tickets = usePlatformStore((s) => s.tickets);
  const anchors = usePlatformStore((s) => s.slaAnchors);
  const setView = usePlatformStore((s) => s.setView);
  const selectTicket = usePlatformStore((s) => s.selectTicket);
  const now = useNow();
  const open = tickets.filter((t) => t.status !== 'RESOLVED_KB_LINKED' && t.type !== 'CHANGE');
  const p1 = open.filter((t) => t.priority === 'P1');
  const atRisk = open.filter((t) => !t.slaPaused && liveSlaSeconds(t, anchors[t.id], now) < 4 * 3600);
  const top = [...p1, ...atRisk.filter((t) => t.priority !== 'P1')][0];
  return (
    <Shell icon={<Siren className="size-4 text-rose-400" />} title="Needs a human" accent="bg-rose-500/20" onClick={() => { if (top) selectTicket(top.id); setView('tickets'); }}>
      <div className="flex items-baseline gap-4">
        <p><span className="font-mono text-3xl font-semibold tracking-tight text-rose-200">{p1.length}</span> <span className="text-xs text-slate-500">P1 open</span></p>
        <p><span className="font-mono text-xl font-semibold text-amber-200">{atRisk.length}</span> <span className="text-xs text-slate-500">SLA at risk</span></p>
      </div>
      <p className="mt-2 truncate text-xs text-slate-400">{top ? <>Next up: <span className="font-mono text-slate-300">{top.id}</span> {top.title}</> : 'Nothing urgent — nice. 🎉'}</p>
    </Shell>
  );
}

export function SlaHealthCard() {
  const tickets = usePlatformStore((s) => s.tickets);
  const anchors = usePlatformStore((s) => s.slaAnchors);
  const saasApps = usePlatformStore((s) => s.saasApps);
  const baseline = usePlatformStore((s) => s.baseline);
  const now = useNow();
  const k = computeKpis(tickets, anchors, saasApps, baseline, now);
  const pct = k.slaCompliancePercent;
  const waiting = tickets.filter((t) => t.slaPaused && t.status !== 'RESOLVED_KB_LINKED').length;
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <Shell icon={<Gauge className="size-4 text-indigo-400" />} title="SLA health · 30 days" accent="bg-indigo-500/20">
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 56 56" className="size-16 -rotate-90" role="img" aria-label={`${pct.toFixed(1)}% SLA compliance`}>
          <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle cx="28" cy="28" r={r} fill="none" stroke={pct >= 95 ? '#34d399' : pct >= 90 ? '#818cf8' : '#fbbf24'} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
        </svg>
        <div>
          <p className="font-mono text-3xl font-semibold tracking-tight">{pct.toFixed(1)}%</p>
          <p className="text-xs text-slate-500">{k.slaBreachedOpen ? `${k.slaBreachedOpen} open breach${k.slaBreachedOpen === 1 ? '' : 'es'}` : 'No open breaches'} · {waiting} paused</p>
        </div>
      </div>
    </Shell>
  );
}
