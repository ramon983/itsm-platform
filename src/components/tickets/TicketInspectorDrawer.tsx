'use client';

import clsx from 'clsx';
import {
  ArrowRightLeft,
  BookOpen,
  Cloud,
  Hash,
  KeyRound,
  Languages,
  Laptop,
  Mail,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
  Sparkles,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { HandoffContextModal } from '@/components/tickets/HandoffContextModal';
import { ResolveKbModal } from '@/components/tickets/ResolveKbModal';
import { TicketTimeline, langName } from '@/components/tickets/TicketTimeline';
import { AvatarStack, Button, Drawer, Kbd, PriorityBadge, SlaTimer, StatusBadge } from '@/components/ui/primitives';
import { CURRENT_AGENT } from '@/data/seed';
import { ALLOWED_TRANSITIONS, STATUS_LABEL, SWARM_SQUADS, TICKET_STATUSES } from '@/lib/rules';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { SwarmSquad, Ticket, TicketStatus } from '@/types/platform';

export const CHANNEL_ICON: Record<Ticket['channel'], typeof Hash> = {
  Slack: Hash,
  'MS Teams': MessageSquare,
  Portal: Laptop,
  Email: Mail,
  'SIEM Webhook': ShieldAlert,
};

export function TicketInspectorDrawer() {
  const inspector = usePlatformStore((s) => s.inspector);
  const close = usePlatformStore((s) => s.closeInspector);
  const ticket = usePlatformStore((s) =>
    s.inspector?.kind === 'ticket' ? s.tickets.find((t) => t.id === s.inspector!.id) : undefined,
  );
  return (
    <Drawer open={inspector?.kind === 'ticket' && !!ticket} onClose={close} label="Ticket inspector">
      {ticket && <TicketInspector key={ticket.id} ticket={ticket} onClose={close} />}
    </Drawer>
  );
}

function TicketInspector({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const flags = usePlatformStore((s) => s.flags);
  const transitionTicket = usePlatformStore((s) => s.transitionTicket);
  const executeMacro = usePlatformStore((s) => s.executeMacro);
  const joinSwarm = usePlatformStore((s) => s.joinSwarm);
  const openInspector = usePlatformStore((s) => s.openInspector);
  const openJitModal = usePlatformStore((s) => s.openJitModal);
  const jitOpen = usePlatformStore((s) => s.jitModal.open);
  const asset = usePlatformStore((s) => s.assets.find((a) => a.id === ticket.linkedAssetId));
  const saas = usePlatformStore((s) => s.saasApps.find((a) => a.id === ticket.linkedSaasId));
  const kb = usePlatformStore((s) => s.kbArticles.find((k) => k.id === ticket.linkedKbId));

  const [showTranslation, setShowTranslation] = useState(true);
  const [handoff, setHandoff] = useState<{ open: boolean; squad?: SwarmSquad }>({ open: false });
  const [resolveOpen, setResolveOpen] = useState(false);

  const resolved = ticket.status === 'RESOLVED_KB_LINKED';
  const aiOn = flags.ai_agents;
  const ChannelIcon = CHANNEL_ICON[ticket.channel];
  const modalOpen = handoff.open || resolveOpen || jitOpen;

  const changeStatus = (to: TicketStatus) => {
    if (to === 'RESOLVED_KB_LINKED') setResolveOpen(true);
    else transitionTicket(ticket.id, to);
  };
  const togglePause = () => changeStatus(ticket.slaPaused ? 'ACTIVE_SWARM' : 'WAITING_ON_CUSTOMER');
  const canPause = ticket.slaPaused || ALLOWED_TRANSITIONS[ticket.status].includes('WAITING_ON_CUSTOMER');

  useEffect(() => {
    if (modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === 'e' && aiOn && ticket.recommendedMacro && !resolved) {
        e.preventDefault();
        executeMacro(ticket.id);
      } else if (key === 't' && aiOn) {
        e.preventDefault();
        setShowTranslation((v) => !v);
      } else if (key === 'p' && canPause && !resolved) {
        e.preventDefault();
        changeStatus(ticket.slaPaused ? 'ACTIVE_SWARM' : 'WAITING_ON_CUSTOMER');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <header className="border-b border-white/[0.08] p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-mono font-semibold text-slate-200">{ticket.id}</span>
              <span className="font-mono text-slate-500">{ticket.templateId}</span>
              <span className="flex items-center gap-1"><ChannelIcon className="size-3.5" />{ticket.channel}</span>
              {ticket.linkedJiraIssue && <span className="font-mono text-slate-500">Jira {ticket.linkedJiraIssue}</span>}
            </div>
            <h2 className="mt-1.5 text-lg font-semibold leading-snug tracking-tight text-slate-50">{ticket.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
              <span
                className={clsx(
                  'rounded-md border px-1.5 py-0.5 text-[11px]',
                  ticket.sentiment === 'Calm' && 'border-white/[0.08] text-slate-400',
                  ticket.sentiment === 'Frustrated' && 'border-amber-500/20 text-amber-300',
                  ticket.sentiment === 'Urgent Client Impact' && 'border-rose-500/20 text-rose-300',
                )}
              >
                {ticket.sentiment}
              </span>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close inspector"><X className="size-4" /></Button>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              {ticket.slaPaused ? 'SLA paused — timer frozen' : resolved ? 'SLA' : 'Time to SLA breach'}
            </p>
            <SlaTimer ticket={ticket} size="lg" />
          </div>
          <Button size="sm" onClick={togglePause} disabled={!canPause || resolved}>
            {ticket.slaPaused ? <PlayCircle className="size-3.5" /> : <PauseCircle className="size-3.5" />}
            {ticket.slaPaused ? 'Resume SLA' : 'Pause SLA'} <Kbd>P</Kbd>
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">Status</span>
            <select
              aria-label="Status"
              value={ticket.status}
              onChange={(e) => changeStatus(e.target.value as TicketStatus)}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500/60"
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s} disabled={s !== ticket.status && !ALLOWED_TRANSITIONS[ticket.status].includes(s)} className="bg-slate-900">
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">Swarm squad</span>
            <select
              aria-label="Swarm squad"
              value={ticket.swarmSquad}
              disabled={resolved}
              onChange={(e) => setHandoff({ open: true, squad: e.target.value as SwarmSquad })}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500/60 disabled:opacity-50"
            >
              {SWARM_SQUADS.map((s) => (
                <option key={s} value={s} className="bg-slate-900">{s}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <section className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-slate-500">Requester</p>
            <p className="mt-0.5 font-medium text-slate-200">{ticket.requesterName}</p>
            <p className="text-slate-500">{ticket.requesterEmail}</p>
          </div>
          <div>
            <p className="text-slate-500">Language</p>
            <p className="mt-0.5 font-medium text-slate-200">
              <span className="mr-1.5 rounded bg-white/[0.06] px-1 font-mono text-[10px] uppercase">{ticket.detectedLanguage}</span>
              {langName(ticket.detectedLanguage)}
            </p>
          </div>
        </section>

        <section className="flex flex-wrap gap-2">
          {asset && flags.itam_cmdb && (
            <button type="button" onClick={() => openInspector({ kind: 'asset', id: asset.id })} className="az-chip">
              <Laptop className="size-3.5 text-slate-400" /><span className="font-mono">{asset.id}</span>
              <span className="text-slate-500">{asset.name}</span>
            </button>
          )}
          {saas && flags.torii_saas && (
            <button type="button" onClick={() => openInspector({ kind: 'saas', id: saas.id })} className="az-chip">
              <Cloud className="size-3.5 text-slate-400" />{saas.name}
            </button>
          )}
          {kb && (
            <span className="az-chip border-emerald-500/20 text-emerald-300" title={kb.summary}>
              <BookOpen className="size-3.5" /><span className="font-mono">{kb.id}</span>
              <span className="text-emerald-200/70">{kb.title}</span>
            </span>
          )}
        </section>

        <section className="flex items-center justify-between rounded-xl border border-white/[0.06] p-3">
          <div className="flex items-center gap-3">
            <AvatarStack names={ticket.activeSwarmAgents} max={4} />
            <div className="text-xs">
              <p className="font-medium text-slate-200">{ticket.swarmSquad} swarm</p>
              <p className="text-slate-500">{ticket.activeSwarmAgents.join(', ')}</p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => joinSwarm(ticket.id)} disabled={ticket.activeSwarmAgents.includes(CURRENT_AGENT) || resolved}>
              <UserPlus className="size-3.5" />Join
            </Button>
            <Button size="sm" onClick={() => setHandoff({ open: true })} disabled={resolved}>
              <ArrowRightLeft className="size-3.5" />Hand off
            </Button>
          </div>
        </section>

        {aiOn && ticket.recommendedMacro && (
          <section className="rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300">
              <Sparkles className="size-3.5" />AI-recommended remediation · human approval required
            </div>
            <p className="mt-1.5 text-sm text-slate-100">{ticket.recommendedMacro.label}</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-code px-2 py-1.5 font-mono text-[11px] text-slate-400">$ {ticket.recommendedMacro.command}</pre>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => executeMacro(ticket.id)} disabled={resolved}>
                <Zap className="size-3.5" />Approve & execute <Kbd>E</Kbd>
              </Button>
              {flags.password_vault && (
                <Button size="sm" onClick={() => openJitModal({ ticketId: ticket.id })} disabled={resolved}>
                  <KeyRound className="size-3.5" />Request JIT access
                </Button>
              )}
            </div>
          </section>
        )}

        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Timeline</h3>
            {aiOn && (
              <Button size="sm" variant="ghost" onClick={() => setShowTranslation((v) => !v)}>
                <Languages className="size-3.5" />{showTranslation ? 'Hide' : 'Show'} translations <Kbd>T</Kbd>
              </Button>
            )}
          </div>
          <TicketTimeline messages={ticket.messages} showTranslation={aiOn && showTranslation} />
        </section>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-white/[0.08] p-4">
        {resolved ? (
          <Button onClick={() => changeStatus('ACTIVE_SWARM')}>Reopen ticket</Button>
        ) : (
          <span className="text-xs text-slate-500">Resolving requires a linked Knowledge Base article.</span>
        )}
        {!resolved && (
          <Button variant="primary" onClick={() => setResolveOpen(true)}>
            <BookOpen className="size-4" />Resolve with KB
          </Button>
        )}
      </footer>

      <HandoffContextModal ticket={ticket} initialSquad={handoff.squad} open={handoff.open} onClose={() => setHandoff({ open: false })} />
      <ResolveKbModal ticket={ticket} open={resolveOpen} onClose={() => setResolveOpen(false)} />
    </>
  );
}
