'use client';

import clsx from 'clsx';
import { ArrowRight, Bot, Cloud, Gauge, Siren, Sparkles, Target, Timer, Trophy, Users, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';

import { TelemetryFeed } from '@/components/dashboard/TelemetryFeed';
import { AvatarStack, Button, Card, PriorityBadge, SlaTimer, StatusBadge } from '@/components/ui/primitives';
import { AGENTS, CURRENT_AGENT } from '@/data/seed';
import { useNow } from '@/hooks/useNow';
import { computeKpis, formatDuration, usd } from '@/lib/metrics';
import { detectPatterns } from '@/lib/patterns';
import { liveSlaSeconds } from '@/lib/sla';
import { usePlatformStore } from '@/store/usePlatformStore';

export function ReportsView() {
  const flags = usePlatformStore((s) => s.flags);
  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-0.5 text-sm text-slate-400">Service performance, team load, the AI + human split and live telemetry.</p>
      </div>
      <KpiStrip />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <NeedsAttention />
          <div className="grid gap-5 lg:grid-cols-2">
            <SquadLoad />
            {flags.ai_agents ? <AiHumanSplit /> : <Arcade />}
          </div>
        </div>
        <div className="space-y-5">
          {flags.ai_agents && <AiInsights />}
          {flags.ai_agents && <Arcade />}
          <TelemetryFeed limit={8} />
        </div>
      </div>
    </div>
  );
}

function KpiStrip() {
  const tickets = usePlatformStore((s) => s.tickets);
  const anchors = usePlatformStore((s) => s.slaAnchors);
  const saasApps = usePlatformStore((s) => s.saasApps);
  const baseline = usePlatformStore((s) => s.baseline);
  const reclaimed = usePlatformStore((s) => s.reclaimedMonthlySavings);
  const saasOn = usePlatformStore((s) => s.flags.torii_saas);
  const setView = usePlatformStore((s) => s.setView);
  const now = useNow();
  const k = computeKpis(tickets, anchors, saasApps, baseline, now);

  return (
    <div className={clsx('grid gap-3 sm:grid-cols-2', saasOn ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
      <Kpi icon={Siren} label="Open Incidents" value={String(k.openIncidents)} sub={`${k.openP1} P1 critical`} tone={k.openP1 ? 'rose' : undefined} onClick={() => setView('tickets')} />
      <Kpi icon={Target} label="First Contact Resolution" value={`${k.fcrPercent.toFixed(1)}%`} sub="Resolved without a handoff · 30d" />
      <Kpi icon={Timer} label="MTTR" value={formatDuration(k.mttrMinutes)} sub="Mean time to resolve · 30d" />
      <Kpi icon={Gauge} label="SLA Compliance" value={`${k.slaCompliancePercent.toFixed(1)}%`} sub={k.slaBreachedOpen ? `${k.slaBreachedOpen} open ticket(s) breached` : 'No open breaches'} tone={k.slaBreachedOpen ? 'amber' : 'emerald'} />
      {saasOn && (
        <Kpi icon={Cloud} label="Monthly SaaS Spend" value={usd(k.monthlySaasSpend)} sub={`${usd(k.reclaimableMonthly)} reclaimable${reclaimed ? ` · ${usd(reclaimed)} saved` : ''}`} tone="indigo" onClick={() => setView('saas')} />
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone, onClick }: { icon: LucideIcon; label: string; value: string; sub: string; tone?: 'rose' | 'amber' | 'emerald' | 'indigo'; onClick?: () => void }) {
  const body = (
    <Card className={clsx('h-full p-4 text-left transition', onClick && 'hover:border-white/[0.16]')}>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Icon className={clsx('size-4', tone === 'rose' ? 'text-rose-400' : tone === 'amber' ? 'text-amber-400' : tone === 'emerald' ? 'text-emerald-400' : 'text-indigo-400')} />
        {label}
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight text-slate-50">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </Card>
  );
  return onClick ? <button type="button" onClick={onClick} className="text-left">{body}</button> : body;
}

function NeedsAttention() {
  const tickets = usePlatformStore((s) => s.tickets);
  const anchors = usePlatformStore((s) => s.slaAnchors);
  const selectTicket = usePlatformStore((s) => s.selectTicket);
  const setView = usePlatformStore((s) => s.setView);
  const now = useNow();
  const items = tickets
    .filter((t) => t.status !== 'RESOLVED_KB_LINKED' && t.type !== 'CHANGE')
    .map((t) => ({ t, sla: liveSlaSeconds(t, anchors[t.id], now) }))
    .filter(({ t, sla }) => t.priority === 'P1' || (!t.slaPaused && sla < 4 * 3600) || t.sentiment === 'Urgent Client Impact')
    .sort((a, b) => a.t.priority.localeCompare(b.t.priority) || a.sla - b.sla)
    .slice(0, 6);

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <Siren className="size-4 text-rose-400" />
        <h2 className="text-sm font-semibold tracking-tight">Needs a human now</h2>
        <span className="hidden text-xs text-slate-500 sm:inline">P1s, SLA risk and urgent client impact</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setView('tickets')}>All tickets <ArrowRight className="size-3.5" /></Button>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {items.map(({ t }) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => { selectTicket(t.id); setView('tickets'); }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.03]"
            >
              <PriorityBadge priority={t.priority} />
              <span className="font-mono text-xs text-slate-400">{t.id}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{t.title}</span>
              <span className="hidden text-xs text-slate-500 md:block">{t.swarmSquad}</span>
              <StatusBadge status={t.status} />
              <span className="w-20 text-right"><SlaTimer ticket={t} /></span>
            </button>
          </li>
        ))}
        {!items.length && <li className="px-4 py-8 text-center text-sm text-emerald-300">Nothing urgent. 🎉</li>}
      </ul>
    </Card>
  );
}

function SquadLoad() {
  const squads = usePlatformStore((s) => s.squads);
  const tickets = usePlatformStore((s) => s.tickets);
  const open = tickets.filter((t) => t.status !== 'RESOLVED_KB_LINKED');
  const max = Math.max(1, ...squads.map((sq) => open.filter((t) => t.swarmSquad === sq).length));
  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight"><Users className="size-4 text-indigo-400" />Swarm load by squad</h2>
      <ul className="space-y-3">
        {squads.map((sq) => {
          const mine = open.filter((t) => t.swarmSquad === sq);
          const waiting = mine.filter((t) => t.slaPaused).length;
          const people = Array.from(new Set(mine.flatMap((t) => t.activeSwarmAgents)));
          return (
            <li key={sq}>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-200">{sq}</span>
                <span className="font-mono text-slate-500">{mine.length} open{waiting ? ` · ${waiting} waiting` : ''}</span>
                <span className="ml-auto"><AvatarStack names={people} max={4} /></span>
              </div>
              <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-white/[0.05]">
                <span className="bg-indigo-500" style={{ width: `${((mine.length - waiting) / max) * 100}%` }} />
                <span className="bg-purple-500/60" style={{ width: `${(waiting / max) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 flex gap-3 text-[10px] text-slate-500"><span><span className="mr-1 inline-block size-2 rounded-full bg-indigo-500" />active</span><span><span className="mr-1 inline-block size-2 rounded-full bg-purple-500/60" />waiting (SLA paused)</span></p>
    </Card>
  );
}

function AiHumanSplit() {
  const tickets = usePlatformStore((s) => s.tickets);
  const closed = usePlatformStore((s) => s.closedTickets);
  const kbStats = usePlatformStore((s) => s.kbStats);
  const deflected = Object.values(kbStats).reduce((n, s) => n + s.deflections, 0);
  const messages = tickets.flatMap((t) => t.messages);
  const humanClosed = closed.filter((c) => !c.resolvedBy.startsWith('AdminZero AI')).length;
  const ai = {
    'Self-service resolutions': deflected,
    'Tickets triaged & translated': tickets.filter((t) => t.messages.some((m) => m.role === 'ai_system')).length + closed.length,
    'Macros prepared': messages.filter((m) => m.metadata?.macroId).length,
  };
  const human = {
    'Replies & notes': messages.filter((m) => m.role === 'agent').length + humanClosed,
    'Handoffs with context': messages.filter((m) => m.role === 'handoff_audit').length,
    'Approvals & resolutions': tickets.filter((t) => t.status === 'RESOLVED_KB_LINKED').length + humanClosed,
  };
  const aiTotal = Object.values(ai).reduce((a, b) => a + b, 0);
  const humanTotal = Object.values(human).reduce((a, b) => a + b, 0);
  const aiPct = Math.round((aiTotal / Math.max(1, aiTotal + humanTotal)) * 100);
  return (
    <Card className="p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold tracking-tight"><Bot className="size-4 text-sky-400" />AI + human · 30 days</h2>
      <p className="text-xs text-slate-500">The AI takes the repetitive work so people can focus on people.</p>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full" role="img" aria-label={`AI ${aiPct}%, human ${100 - aiPct}%`}>
        <span className="bg-gradient-to-r from-sky-500 to-indigo-500" style={{ width: `${aiPct}%` }} />
        <span className="bg-amber-400/80" style={{ width: `${100 - aiPct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-xs"><span className="text-sky-300">AI {aiPct}%</span><span className="text-amber-200">Human {100 - aiPct}%</span></div>
      <div className="mt-3 grid grid-cols-2 gap-4 text-[11px]">
        <ul className="space-y-1">{Object.entries(ai).map(([k, v]) => <li key={k} className="flex justify-between gap-2 text-slate-400"><span>{k}</span><span className="font-mono text-slate-200">{v}</span></li>)}</ul>
        <ul className="space-y-1">{Object.entries(human).map(([k, v]) => <li key={k} className="flex justify-between gap-2 text-slate-400"><span>{k}</span><span className="font-mono text-slate-200">{v}</span></li>)}</ul>
      </div>
    </Card>
  );
}

function AiInsights() {
  const closed = usePlatformStore((s) => s.closedTickets);
  const tickets = usePlatformStore((s) => s.tickets);
  const kbArticles = usePlatformStore((s) => s.kbArticles);
  const kbStats = usePlatformStore((s) => s.kbStats);
  const setView = usePlatformStore((s) => s.setView);
  const gaps = useMemo(() => detectPatterns(closed, tickets, kbArticles, kbStats).filter((p) => p.coverage === 'uncovered'), [closed, tickets, kbArticles, kbStats]);
  const hours = gaps.reduce((n, p) => n + p.humanHoursPerMonth, 0);
  return (
    <Card className="border-amber-400/15 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight"><Sparkles className="size-4 text-amber-300" />AI insights</h2>
      {gaps.length ? (
        <>
          <p className="mt-1 text-xs text-slate-400">{gaps.length} recurring issue{gaps.length === 1 ? ' has' : 's have'} no article. Publishing them could save ~<span className="font-mono text-amber-200">{hours.toFixed(1)}h</span> of agent time a month.</p>
          <ul className="mt-2 space-y-1.5">
            {gaps.slice(0, 3).map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-xs">
                <span className="rounded bg-amber-400/15 px-1.5 font-mono text-amber-200">{p.members.length}×</span>
                <span className="truncate text-slate-200">{p.label}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" className="mt-3" onClick={() => setView('knowledge')}>Review in Knowledge <ArrowRight className="size-3.5" /></Button>
        </>
      ) : (
        <p className="mt-1 text-xs text-emerald-300">Every recurring issue has an article. The AI will flag new patterns as they appear.</p>
      )}
    </Card>
  );
}

function Arcade() {
  const profile = usePlatformStore((s) => s.profile);
  const closed = usePlatformStore((s) => s.closedTickets);
  // Team arcade (FreshService-style): XP from this month's resolutions; your live XP for you.
  const board = AGENTS.map((a) => {
    const solved = closed.filter((c) => c.resolvedBy === a.name);
    const xp = a.name === CURRENT_AGENT ? profile.xp : 1200 + solved.length * 140 + solved.filter((c) => c.firstContact).length * 60;
    return { ...a, xp, solved: solved.length };
  })
    .sort((x, y) => y.xp - x.xp)
    .slice(0, 5);
  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight"><Trophy className="size-4 text-amber-400" />Arcade · this month</h2>
      <ol className="space-y-2">
        {board.map((a, i) => (
          <li key={a.name} className={clsx('flex items-center gap-2.5 text-xs', a.name === CURRENT_AGENT ? 'text-amber-200' : 'text-slate-300')}>
            <span className="w-4 font-mono text-slate-500">{i + 1}</span>
            <span className={clsx('grid size-6 place-items-center rounded-full text-[10px] font-semibold text-onaccent', a.color)}>{a.initials}</span>
            <span className="flex-1">{a.name}</span>
            <span className="text-slate-500">{a.solved} solved</span>
            <span className="w-16 text-right font-mono">{a.xp.toLocaleString()} XP</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
