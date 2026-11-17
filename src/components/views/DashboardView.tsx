'use client';

import clsx from 'clsx';
import {
  Activity,
  Clock,
  Cloud,
  Gauge,
  Languages,
  ShieldAlert,
  Siren,
  Sparkles,
  Target,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { HandoffContextModal } from '@/components/tickets/HandoffContextModal';
import { CHANNEL_ICON } from '@/components/tickets/TicketInspectorDrawer';
import { AvatarStack, Button, Card, PriorityBadge, SlaTimer, StatusBadge } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { computeKpis, formatDuration, timeAgo, usd } from '@/lib/metrics';
import { STATUS_LABEL, SWARM_SQUADS, TICKET_STATUSES } from '@/lib/rules';
import { liveSlaSeconds } from '@/lib/sla';
import { usePlatformStore, type BoardFilter } from '@/store/usePlatformStore';
import type { SwarmSquad, TelemetryEvent, Ticket } from '@/types/platform';

const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2, P4: 3 } as const;

export function DashboardView() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Unified Swarming Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Every squad sees every ticket. AI handles triage and translation; people handle the humans.
          </p>
        </div>
      </div>
      <KpiStrip />
      <div className="grid gap-5 min-[1800px]:grid-cols-[1fr_360px]">
        <SwarmBoard />
        <TelemetryFeed />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ KPIs

function KpiStrip() {
  const tickets = usePlatformStore((s) => s.tickets);
  const anchors = usePlatformStore((s) => s.slaAnchors);
  const saasApps = usePlatformStore((s) => s.saasApps);
  const baseline = usePlatformStore((s) => s.baseline);
  const reclaimed = usePlatformStore((s) => s.reclaimedMonthlySavings);
  const saasOn = usePlatformStore((s) => s.flags.torii_saas);
  const openPalette = usePlatformStore((s) => s.openPalette);
  const now = useNow();
  const k = computeKpis(tickets, anchors, saasApps, baseline, now);

  return (
    <div className={clsx('grid gap-3 sm:grid-cols-2', saasOn ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
      <Kpi icon={Siren} label="Open Incidents" value={String(k.openIncidents)} sub={`${k.openP1} P1 critical`} tone={k.openP1 ? 'rose' : undefined} />
      <Kpi icon={Target} label="First Contact Resolution" value={`${k.fcrPercent.toFixed(1)}%`} sub="Resolved without a handoff · 30d" />
      <Kpi icon={Timer} label="MTTR" value={formatDuration(k.mttrMinutes)} sub="Mean time to resolve · 30d" />
      <Kpi
        icon={Gauge}
        label="SLA Compliance"
        value={`${k.slaCompliancePercent.toFixed(1)}%`}
        sub={k.slaBreachedOpen ? `${k.slaBreachedOpen} open ticket(s) breached` : 'No open breaches'}
        tone={k.slaBreachedOpen ? 'amber' : 'emerald'}
      />
      {saasOn && (
        <button type="button" onClick={() => openPalette('saas')} className="text-left">
          <Kpi
            icon={Cloud}
            label="Monthly SaaS Spend"
            value={usd(k.monthlySaasSpend)}
            sub={`${usd(k.reclaimableMonthly)} reclaimable · ${k.idleSeats} idle seats${reclaimed ? ` · ${usd(reclaimed)} saved` : ''}`}
            tone="indigo"
            interactive
          />
        </button>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone, interactive }: {
  icon: LucideIcon; label: string; value: string; sub: string; tone?: 'rose' | 'amber' | 'emerald' | 'indigo'; interactive?: boolean;
}) {
  return (
    <Card className={clsx('h-full p-4 transition', interactive && 'hover:border-white/[0.16]')}>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Icon className={clsx('size-4', tone === 'rose' ? 'text-rose-400' : tone === 'amber' ? 'text-amber-400' : tone === 'emerald' ? 'text-emerald-400' : 'text-indigo-400')} />
        {label}
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight text-slate-50">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </Card>
  );
}

// ------------------------------------------------------------------ swarm board

function matches(t: Ticket, f: BoardFilter): boolean {
  if (f.priority === 'P1' && t.priority !== 'P1') return false;
  if (f.status === 'WAITING' && !t.status.startsWith('WAITING')) return false;
  if (f.status !== 'ALL' && f.status !== 'WAITING' && t.status !== f.status) return false;
  const q = f.query.trim().toLowerCase();
  return !q || `${t.id} ${t.title} ${t.requesterName} ${t.linkedAssetId ?? ''}`.toLowerCase().includes(q);
}

function SwarmBoard() {
  const tickets = usePlatformStore((s) => s.tickets);
  const anchors = usePlatformStore((s) => s.slaAnchors);
  const filter = usePlatformStore((s) => s.boardFilter);
  const setFilter = usePlatformStore((s) => s.setBoardFilter);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overSquad, setOverSquad] = useState<SwarmSquad | null>(null);
  const [handoff, setHandoff] = useState<{ ticket: Ticket; squad: SwarmSquad } | null>(null);
  const now = useNow();

  const visible = useMemo(() => tickets.filter((t) => matches(t, filter)), [tickets, filter]);
  const sortKey = (t: Ticket) =>
    t.status === 'RESOLVED_KB_LINKED' ? 1e12 : PRIORITY_RANK[t.priority] * 1e9 + liveSlaSeconds(t, anchors[t.id], now);

  const statusCounts = TICKET_STATUSES.map((s) => [s, tickets.filter((t) => t.status === s).length] as const);

  const drop = (squad: SwarmSquad) => {
    const ticket = tickets.find((t) => t.id === dragging);
    setDragging(null);
    setOverSquad(null);
    if (ticket && ticket.swarmSquad !== squad) setHandoff({ ticket, squad });
  };

  return (
    <section aria-label="Anti-silo swarm board">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-sm font-semibold tracking-tight">Anti-Silo Swarm Board</h2>
        <FilterChip active={filter.status === 'ALL'} onClick={() => setFilter({ status: 'ALL' })} label="All statuses" count={tickets.length} />
        {statusCounts.map(([s, n]) => (
          <FilterChip key={s} active={filter.status === s} onClick={() => setFilter({ status: s })} label={STATUS_LABEL[s]} count={n} />
        ))}
        <FilterChip
          active={filter.priority === 'P1'}
          onClick={() => setFilter({ priority: filter.priority === 'P1' ? 'ALL' : 'P1' })}
          label="P1 only"
          tone="rose"
        />
        <input
          value={filter.query}
          onChange={(e) => setFilter({ query: e.target.value })}
          placeholder="Filter by ID, requester, asset…"
          aria-label="Filter tickets"
          className="ml-auto h-8 w-56 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500/60"
        />
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Columns are swarm squads, never individual assignees. Drag a card to another squad to hand it off — you’ll be asked for context.
      </p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {SWARM_SQUADS.map((squad) => {
          const cards = visible.filter((t) => t.swarmSquad === squad).sort((a, b) => sortKey(a) - sortKey(b));
          const squadAgents = Array.from(new Set(tickets.filter((t) => t.swarmSquad === squad && t.status !== 'RESOLVED_KB_LINKED').flatMap((t) => t.activeSwarmAgents)));
          return (
            <div
              key={squad}
              onDragOver={(e) => {
                e.preventDefault();
                setOverSquad(squad);
              }}
              onDragLeave={() => setOverSquad((s) => (s === squad ? null : s))}
              onDrop={() => drop(squad)}
              className={clsx(
                'flex min-h-[420px] flex-col rounded-xl border bg-slate-900/50 p-2.5 transition',
                overSquad === squad && dragging ? 'border-indigo-500/50 bg-indigo-500/[0.05]' : 'border-white/[0.08]',
              )}
            >
              <div className="mb-2.5 flex items-center gap-2 px-1">
                <span className="text-sm font-semibold tracking-tight">{squad}</span>
                <span className="rounded-md bg-white/[0.06] px-1.5 font-mono text-[10px] text-slate-400">{cards.length}</span>
                <span className="ml-auto"><AvatarStack names={squadAgents} max={4} /></span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {cards.map((t) => (
                  <TicketCard key={t.id} ticket={t} onDragStart={() => setDragging(t.id)} onDragEnd={() => setDragging(null)} dragging={dragging === t.id} />
                ))}
                {!cards.length && <p className="grid flex-1 place-items-center text-xs text-slate-600">No tickets match</p>}
              </div>
            </div>
          );
        })}
      </div>

      {handoff && (
        <HandoffContextModal ticket={handoff.ticket} initialSquad={handoff.squad} open onClose={() => setHandoff(null)} />
      )}
    </section>
  );
}

function FilterChip({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count?: number; tone?: 'rose' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition',
        active
          ? tone === 'rose'
            ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
            : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
          : 'border-white/[0.08] text-slate-400 hover:border-white/[0.16] hover:text-slate-200',
      )}
    >
      {label}
      {count !== undefined && <span className="font-mono text-[10px] opacity-70">{count}</span>}
    </button>
  );
}

function TicketCard({ ticket: t, onDragStart, onDragEnd, dragging }: { ticket: Ticket; onDragStart: () => void; onDragEnd: () => void; dragging: boolean }) {
  const openInspector = usePlatformStore((s) => s.openInspector);
  const aiOn = usePlatformStore((s) => s.flags.ai_agents);
  const assetsOn = usePlatformStore((s) => s.flags.itam_cmdb);
  const ChannelIcon = CHANNEL_ICON[t.channel];
  return (
    <button
      type="button"
      draggable={t.status !== 'RESOLVED_KB_LINKED'}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => openInspector({ kind: 'ticket', id: t.id })}
      className={clsx(
        'group w-full rounded-lg border bg-[#0f1424] p-3 text-left transition hover:border-white/[0.16] hover:bg-[#121a2d]',
        t.priority === 'P1' && t.status !== 'RESOLVED_KB_LINKED' ? 'border-rose-500/30' : 'border-white/[0.08]',
        t.status === 'RESOLVED_KB_LINKED' && 'opacity-60',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span className="whitespace-nowrap font-mono font-medium text-slate-300">{t.id}</span>
        <ChannelIcon className="size-3" aria-label={t.channel} />
        {t.detectedLanguage !== 'en' && (
          <span className="flex items-center gap-0.5 rounded bg-white/[0.06] px-1 font-mono uppercase text-slate-300">
            {aiOn && <Languages className="size-2.5" />}
            {t.detectedLanguage}
          </span>
        )}
        <span className="ml-auto whitespace-nowrap"><SlaTimer ticket={t} /></span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug text-slate-100">{t.title}</p>
      <p className="mt-1 truncate text-[11px] text-slate-500">
        {t.requesterName}
        {assetsOn && t.linkedAssetId && <span className="font-mono"> · {t.linkedAssetId}</span>}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={t.priority} />
        <StatusBadge status={t.status} />
        {aiOn && t.recommendedMacro && t.status !== 'RESOLVED_KB_LINKED' && (
          <span className="flex items-center gap-0.5 rounded-md border border-indigo-500/20 px-1 py-0.5 text-[10px] text-indigo-300" title={t.recommendedMacro.label}>
            <Sparkles className="size-2.5" />Macro
          </span>
        )}
        <span className="ml-auto"><AvatarStack names={t.activeSwarmAgents} /></span>
      </div>
    </button>
  );
}

// ------------------------------------------------------------------ telemetry feed

const SEVERITY_STYLE: Record<TelemetryEvent['severity'], string> = {
  critical: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]',
  high: 'bg-orange-400',
  medium: 'bg-amber-300',
  info: 'bg-sky-400',
};

function TelemetryFeed() {
  const telemetry = usePlatformStore((s) => s.telemetry);
  const flags = usePlatformStore((s) => s.flags);
  const simulate = usePlatformStore((s) => s.simulateSentinelAlert);
  const openInspector = usePlatformStore((s) => s.openInspector);
  const now = useNow();

  const visible = telemetry.filter((e) => (e.source === 'Torii' ? flags.torii_saas : e.source === 'Vault' ? flags.password_vault : true));

  return (
    <Card className="flex max-h-[720px] flex-col min-[1800px]:sticky min-[1800px]:top-5">
      <div className="border-b border-white/[0.06] p-4">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-indigo-400" />
          <h2 className="text-sm font-semibold tracking-tight">Cross-Module & SIEM Telemetry</h2>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />LIVE
          </span>
        </div>
        <Button
          variant="danger"
          size="sm"
          className="mt-3 w-full"
          onClick={() => {
            const id = simulate();
            openInspector({ kind: 'ticket', id });
          }}
        >
          <ShieldAlert className="size-3.5" />Simulate Sentinel SIEM Alert
        </Button>
      </div>
      <ol className="flex-1 space-y-1 overflow-y-auto p-2">
        {visible.map((e) => {
          const target = e.ticketId ? { kind: 'ticket' as const, id: e.ticketId } : e.assetId && flags.itam_cmdb ? { kind: 'asset' as const, id: e.assetId } : null;
          const body = (
            <>
              <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', SEVERITY_STYLE[e.severity])} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-medium text-slate-300">{e.source}</span>
                  <span className="ml-auto flex items-center gap-1"><Clock className="size-3" />{timeAgo(e.timestamp, now)}</span>
                </span>
                <span className="block text-xs font-medium text-slate-100">{e.title}</span>
                <span className="block text-[11px] leading-snug text-slate-400">{e.detail}</span>
                {(e.ticketId || (e.assetId && flags.itam_cmdb)) && (
                  <span className="mt-1 flex gap-1.5 font-mono text-[10px]">
                    {e.ticketId && <span className="rounded bg-indigo-500/10 px-1 text-indigo-300">{e.ticketId}</span>}
                    {e.assetId && flags.itam_cmdb && <span className="rounded bg-white/[0.06] px-1 text-slate-300">{e.assetId}</span>}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={e.id} className={clsx(e.severity === 'critical' && 'az-pop-in')}>
              {target ? (
                <button type="button" onClick={() => openInspector(target)} className="flex w-full gap-2.5 rounded-lg p-2 text-left transition hover:bg-white/[0.04]">
                  {body}
                </button>
              ) : (
                <div className="flex gap-2.5 p-2">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
