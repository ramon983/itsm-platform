'use client';

import clsx from 'clsx';
import { Languages, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { HandoffContextModal } from '@/components/tickets/HandoffContextModal';
import { CHANNEL_ICON } from '@/components/tickets/TicketInspectorDrawer';
import { AvatarStack, PriorityBadge, SlaTimer, StatusBadge } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { STATUS_LABEL, TICKET_STATUSES } from '@/lib/rules';
import { liveSlaSeconds } from '@/lib/sla';
import { usePlatformStore, type BoardFilter } from '@/store/usePlatformStore';
import type { SwarmSquad, Ticket } from '@/types/platform';

const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2, P4: 3 } as const;

// ------------------------------------------------------------------ swarm board

export function matches(t: Ticket, f: BoardFilter): boolean {
  if (f.priority === 'P1' && t.priority !== 'P1') return false;
  if (f.status === 'WAITING' && !t.status.startsWith('WAITING')) return false;
  if (f.status !== 'ALL' && f.status !== 'WAITING' && t.status !== f.status) return false;
  const q = f.query.trim().toLowerCase();
  return !q || `${t.id} ${t.title} ${t.requesterName} ${t.linkedAssetId ?? ''}`.toLowerCase().includes(q);
}

export function SwarmBoard({ onOpen, types }: { onOpen?: (ticketId: string) => void; types?: Ticket['type'][] }) {
  const squads = usePlatformStore((s) => s.squads);
  const tickets = usePlatformStore((s) => s.tickets);
  const anchors = usePlatformStore((s) => s.slaAnchors);
  const filter = usePlatformStore((s) => s.boardFilter);
  const setFilter = usePlatformStore((s) => s.setBoardFilter);
  const [dragging, setDragging] = useState<string | null>(null);
  const [overSquad, setOverSquad] = useState<SwarmSquad | null>(null);
  const [handoff, setHandoff] = useState<{ ticket: Ticket; squad: SwarmSquad } | null>(null);
  const now = useNow();

  const visible = useMemo(() => tickets.filter((t) => (!types || types.includes(t.type)) && matches(t, filter)), [tickets, filter, types]);
  const sortKey = (t: Ticket) =>
    t.status === 'RESOLVED_KB_LINKED' ? 1e12 : PRIORITY_RANK[t.priority] * 1e9 + liveSlaSeconds(t, anchors[t.id], now);

  const scoped = types ? tickets.filter((t) => types.includes(t.type)) : tickets;
  const statusCounts = TICKET_STATUSES.map((s) => [s, scoped.filter((t) => t.status === s).length] as const);

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
        <FilterChip active={filter.status === 'ALL'} onClick={() => setFilter({ status: 'ALL' })} label="All statuses" count={scoped.length} />
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
          className="ml-auto h-8 w-56 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500/60"
        />
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {squads.length > 1 ? 'Columns are swarm squads, never individual assignees. Drag a card to another squad to hand it off — you’ll be asked for context. Keyboard: open a card and change its squad.' : 'Solo mode: columns are statuses. Open a card to change its status.'}
      </p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(squads.length > 1 ? squads : TICKET_STATUSES).map((squad) => {
          const byStatus = squads.length <= 1;
          const cards = visible.filter((t) => (byStatus ? t.status === squad : t.swarmSquad === squad)).sort((a, b) => sortKey(a) - sortKey(b));
          const squadAgents = Array.from(new Set(tickets.filter((t) => (byStatus ? t.status === squad : t.swarmSquad === squad) && t.status !== 'RESOLVED_KB_LINKED').flatMap((t) => t.activeSwarmAgents)));
          return (
            <div
              key={squad}
              onDragOver={(e) => {
                e.preventDefault();
                setOverSquad(squad);
              }}
              onDragLeave={() => setOverSquad((s) => (s === squad ? null : s))}
              onDrop={() => !byStatus && drop(squad)}
              className={clsx(
                'flex min-h-[420px] flex-col rounded-xl border bg-sunken p-2.5 transition',
                overSquad === squad && dragging ? 'border-indigo-500/50 bg-indigo-500/[0.05]' : 'border-white/[0.08]',
              )}
            >
              <div className="mb-2.5 flex items-center gap-2 px-1">
                <span className="text-sm font-semibold tracking-tight">{byStatus ? STATUS_LABEL[squad as keyof typeof STATUS_LABEL] : squad}</span>
                <span className="rounded-md bg-white/[0.06] px-1.5 font-mono text-[10px] text-slate-400">{cards.length}</span>
                <span className="ml-auto"><AvatarStack names={squadAgents} max={4} /></span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {cards.map((t) => (
                  <TicketCard key={t.id} ticket={t} onOpen={onOpen} onDragStart={() => setDragging(t.id)} onDragEnd={() => setDragging(null)} dragging={dragging === t.id} />
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

function TicketCard({ ticket: t, onOpen, onDragStart, onDragEnd, dragging }: { ticket: Ticket; onOpen?: (id: string) => void; onDragStart: () => void; onDragEnd: () => void; dragging: boolean }) {
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
      onClick={() => (onOpen ? onOpen(t.id) : openInspector({ kind: 'ticket', id: t.id }))}
      className={clsx(
        'group w-full rounded-lg border bg-raised p-3 text-left transition hover:border-white/[0.16] hover:bg-raised-hover',
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

