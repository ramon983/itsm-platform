'use client';

import clsx from 'clsx';
import {
  ArrowRightLeft,
  BookOpen,
  Cloud,
  Columns3,
  GitBranch,
  Inbox,
  KeyRound,
  Languages,
  Laptop,
  Lock,
  MessageSquareText,
  PauseCircle,
  PlayCircle,
  Send,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CopilotPanel } from '@/components/ai/CopilotPanel';
import { HandoffContextModal } from '@/components/tickets/HandoffContextModal';
import { ResolveKbModal } from '@/components/tickets/ResolveKbModal';
import { SwarmBoard } from '@/components/tickets/SwarmBoard';
import { CHANNEL_ICON } from '@/components/tickets/TicketInspectorDrawer';
import { TicketTimeline, langName } from '@/components/tickets/TicketTimeline';
import { AvatarStack, Button, Kbd, PriorityBadge, SlaTimer, StatusBadge, inputClass } from '@/components/ui/primitives';
import { CURRENT_AGENT } from '@/data/seed';
import { useNow } from '@/hooks/useNow';
import { draftReply, ticketSubject } from '@/lib/copilot';
import { ALLOWED_TRANSITIONS, STATUS_LABEL, SWARM_SQUADS, TICKET_STATUSES } from '@/lib/rules';
import { formatSla, liveSlaSeconds } from '@/lib/sla';
import { usePlatformStore } from '@/store/usePlatformStore';
import { CANNED_REPLIES } from '@/data/cannedReplies';
import type { KbArticle, SwarmSquad, Ticket, TicketStatus } from '@/types/platform';

const QUEUE_TYPES: Ticket['type'][] = ['INCIDENT', 'SERVICE_REQUEST'];
type QueueFilter = 'all' | 'p1' | 'waiting' | 'mine';

export function TicketsView() {
  const [mode, setMode] = useState<'inbox' | 'board'>('inbox');
  const selectTicket = usePlatformStore((s) => s.selectTicket);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-white/[0.08] px-5 py-3">
        <h1 className="text-base font-semibold tracking-tight">Tickets</h1>
        <p className="hidden text-xs text-slate-500 md:block">Incidents & service requests from Slack, Teams, email, portal and SIEM — one timeline.</p>
        <div className="ml-auto flex rounded-lg border border-white/[0.08] p-0.5" role="tablist" aria-label="Tickets view">
          {([['inbox', Inbox, 'Inbox'], ['board', Columns3, 'Swarm board']] as const).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={clsx('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition', mode === key ? 'bg-white/[0.08] text-slate-100' : 'text-slate-400 hover:text-slate-200')}
            >
              <Icon className="size-3.5" />{label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'inbox' ? (
        <Inbox3Col />
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          <SwarmBoard
            types={QUEUE_TYPES}
            onOpen={(id) => {
              selectTicket(id);
              setMode('inbox');
            }}
          />
        </div>
      )}
    </div>
  );
}

function Inbox3Col() {
  const tickets = usePlatformStore((s) => s.tickets);
  const anchors = usePlatformStore((s) => s.slaAnchors);
  const selectedId = usePlatformStore((s) => s.selectedTicketId);
  const selectTicket = usePlatformStore((s) => s.selectTicket);
  const aiOn = usePlatformStore((s) => s.flags.ai_agents);
  const now = useNow();
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [squad, setSquad] = useState<SwarmSquad | 'all'>('all');
  const [query, setQuery] = useState('');

  const queue = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets
      .filter((t) => QUEUE_TYPES.includes(t.type))
      .filter((t) => (filter === 'p1' ? t.priority === 'P1' : filter === 'waiting' ? t.slaPaused : filter === 'mine' ? t.activeSwarmAgents.includes(CURRENT_AGENT) : true))
      .filter((t) => squad === 'all' || t.swarmSquad === squad)
      .filter((t) => !q || `${t.id} ${t.title} ${t.requesterName}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const done = Number(a.status === 'RESOLVED_KB_LINKED') - Number(b.status === 'RESOLVED_KB_LINKED');
        if (done) return done;
        return a.priority.localeCompare(b.priority) || liveSlaSeconds(a, anchors[a.id], now) - liveSlaSeconds(b, anchors[b.id], now);
      });
  }, [tickets, anchors, filter, squad, query, now]);

  const selected = tickets.find((t) => t.id === selectedId && QUEUE_TYPES.includes(t.type)) ?? queue[0];
  // Jira-style queue counts: see how much is in each view before switching.
  const scoped = tickets.filter((t) => QUEUE_TYPES.includes(t.type) && t.status !== 'RESOLVED_KB_LINKED' && (squad === 'all' || t.swarmSquad === squad));
  const counts: Record<QueueFilter, number> = {
    all: scoped.length,
    p1: scoped.filter((t) => t.priority === 'P1').length,
    waiting: scoped.filter((t) => t.slaPaused).length,
    mine: scoped.filter((t) => t.activeSwarmAgents.includes(CURRENT_AGENT)).length,
  };

  return (
    <div className={clsx('grid min-h-0 flex-1 lg:grid-rows-[minmax(0,1fr)_auto]', aiOn ? 'lg:grid-cols-[minmax(260px,24%)_1fr_minmax(320px,30%)]' : 'lg:grid-cols-[minmax(260px,26%)_1fr]')}>
      {/* queue */}
      <aside className="flex min-h-0 flex-col border-r border-white/[0.08] lg:row-span-2" aria-label="Ticket queue">
        <div className="space-y-2 border-b border-white/[0.06] p-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search queue…" aria-label="Search queue" className={clsx(inputClass, 'h-8 py-1 text-xs')} />
          <div className="flex flex-wrap gap-1">
            {([['all', 'All'], ['p1', 'P1 Empathy Priority'], ['waiting', 'Waiting · SLA paused'], ['mine', 'My swarms']] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
                className={clsx('rounded-full border px-2 py-0.5 text-[11px] transition', filter === k ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200' : 'border-white/[0.08] text-slate-400 hover:text-slate-200')}
              >
                {label} <span className="font-mono opacity-70">{counts[k]}</span>
              </button>
            ))}
          </div>
          <select aria-label="Filter by swarm squad" value={squad} onChange={(e) => setSquad(e.target.value as SwarmSquad | 'all')} className={clsx(inputClass, 'h-8 py-1 text-xs')}>
            <option value="all" className="bg-slate-900">All swarm squads</option>
            {SWARM_SQUADS.map((s) => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
          </select>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {queue.map((t) => {
            const Icon = CHANNEL_ICON[t.channel];
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (selected && selected.id !== t.id) selectTicket(selected.id); // keep the ticket you were on as a tab
                    selectTicket(t.id);
                  }}
                  aria-current={selected?.id === t.id}
                  className={clsx(
                    'mb-1 w-full rounded-lg border p-2.5 text-left transition',
                    selected?.id === t.id ? 'border-indigo-500/40 bg-indigo-500/[0.08]' : 'border-transparent hover:bg-white/[0.03]',
                    t.status === 'RESOLVED_KB_LINKED' && 'opacity-55',
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Icon className="size-3" aria-label={t.channel} />
                    <span className="font-mono text-slate-300">{t.id}</span>
                    <span className="rounded bg-white/[0.06] px-1 font-mono text-[10px] uppercase text-slate-300">{t.detectedLanguage}</span>
                    <span className="ml-auto whitespace-nowrap"><SlaTimer ticket={t} /></span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-slate-100">{t.title}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                    <span className="ml-auto truncate text-[11px] text-slate-500">{t.requesterName}</span>
                  </div>
                </button>
              </li>
            );
          })}
          {!queue.length && <li className="p-6 text-center text-xs text-slate-500">Nothing in this view. Nice work.</li>}
        </ul>
      </aside>

      {selected ? <Workspace key={selected.id} ticket={selected} /> : <div className="grid place-items-center text-sm text-slate-500">Select a ticket</div>}
    </div>
  );
}

function Workspace({ ticket }: { ticket: Ticket }) {
  const flags = usePlatformStore((s) => s.flags);
  const transitionTicket = usePlatformStore((s) => s.transitionTicket);
  const executeMacro = usePlatformStore((s) => s.executeMacro);
  const joinSwarm = usePlatformStore((s) => s.joinSwarm);
  const addReply = usePlatformStore((s) => s.addReply);
  const linkJiraIssue = usePlatformStore((s) => s.linkJiraIssue);
  const createProblem = usePlatformStore((s) => s.createProblem);
  const openInspector = usePlatformStore((s) => s.openInspector);
  const openJitModal = usePlatformStore((s) => s.openJitModal);
  const jitOpen = usePlatformStore((s) => s.jitModal.open);
  const vault = usePlatformStore((s) => s.vault);
  const problems = usePlatformStore((s) => s.problems);
  const asset = usePlatformStore((s) => s.assets.find((a) => a.id === ticket.linkedAssetId));
  const saas = usePlatformStore((s) => s.saasApps.find((a) => a.id === ticket.linkedSaasId));
  const anchor = usePlatformStore((s) => s.slaAnchors[ticket.id]);
  const now = useNow();

  const [handoff, setHandoff] = useState<{ open: boolean; squad?: SwarmSquad }>({ open: false });
  const [resolveOpen, setResolveOpen] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);
  // Automated sources (SIEM) have no human requester: the composer is internal-only.
  const canReply = ticket.channel !== 'SIEM Webhook';
  const [mode, setMode] = useState<'reply' | 'internal'>(canReply ? 'reply' : 'internal');
  const [text, setText] = useState('');
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilterKey>('all');
  const [slashIndex, setSlashIndex] = useState(0);
  const kbArticles = usePlatformStore((s) => s.kbArticles);
  const slash = text.match(/(?:^|\s)\/([\w-]*)$/);
  const first = ticket.requesterName.split(' ')[0] ?? 'there';
  const slashItems = slash ? buildSlashItems(slash[1]!.toLowerCase(), kbArticles, ticket, flags.ai_agents) : [];
  const applySlash = (item: SlashItem) => {
    const before = text.slice(0, text.length - slash![0].trimStart().length);
    if (item.kind === 'macro') {
      executeMacro(ticket.id);
      setText(before.trimEnd());
    } else {
      setText(`${before}${item.insert.replaceAll('{first}', first)}`);
    }
    setNative(null);
    setSlashIndex(0);
  };
  const [native, setNative] = useState<{ text: string; lang: string; source: string } | null>(null);
  const [jira, setJira] = useState('');

  const resolved = ticket.status === 'RESOLVED_KB_LINKED';
  const foreign = ticket.detectedLanguage !== 'en';
  const nativeFresh = native && native.source === text ? native : null;
  const ChannelIcon = CHANNEL_ICON[ticket.channel];
  const subject = useMemo(() => ticketSubject(ticket), [ticket]);
  const problem = problems.find((p) => p.linkedTicketIds.includes(ticket.id));
  const grants = vault.filter((v) => v.activeGrant?.ticketId === ticket.id && Date.parse(v.activeGrant.expiresAt) > now);
  const canPause = ticket.slaPaused || ALLOWED_TRANSITIONS[ticket.status].includes('WAITING_ON_CUSTOMER');
  const live = liveSlaSeconds(ticket, anchor, now);

  const changeStatus = (to: TicketStatus) => (to === 'RESOLVED_KB_LINKED' ? setResolveOpen(true) : transitionTicket(ticket.id, to));
  const togglePause = () => changeStatus(ticket.slaPaused ? 'ACTIVE_SWARM' : 'WAITING_ON_CUSTOMER');

  const send = () => {
    const internal = mode === 'internal';
    const ok = addReply(ticket.id, internal || !nativeFresh
      ? { text, lang: 'en', internal }
      : { text: nativeFresh.text, translatedText: text, lang: nativeFresh.lang, internal: false }).ok;
    if (ok) {
      setText('');
      setNative(null);
    }
  };

  useEffect(() => {
    if (handoff.open || resolveOpen || jitOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === 'e' && flags.ai_agents && ticket.recommendedMacro && !resolved) {
        e.preventDefault();
        executeMacro(ticket.id);
      } else if (key === 't' && flags.ai_agents) {
        e.preventDefault();
        setShowTranslation((v) => !v);
      } else if (key === 'p' && canPause && !resolved) {
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <section className="flex min-h-0 flex-col border-r border-white/[0.08]" aria-label={`Ticket ${ticket.id}`}>
        <TicketTabs activeId={ticket.id} />
        <header className="space-y-3 border-b border-white/[0.08] p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono font-semibold text-slate-200">{ticket.id}</span>
            <span className="font-mono">{ticket.templateId}</span>
            <span className="flex items-center gap-1"><ChannelIcon className="size-3.5" />{ticket.channel}</span>
            {ticket.linkedJiraIssue && <span className="flex items-center gap-1 font-mono text-sky-300"><GitBranch className="size-3" />{ticket.linkedJiraIssue}</span>}
            {problem && <span className="font-mono text-amber-300">↳ {problem.id}</span>}
            <span className="ml-auto flex items-center gap-2">
              <AvatarStack names={ticket.activeSwarmAgents} max={4} />
              <Button size="sm" variant="ghost" onClick={() => joinSwarm(ticket.id)} disabled={resolved || ticket.activeSwarmAgents.includes(CURRENT_AGENT)}>
                <UserPlus className="size-3.5" />Join
              </Button>
            </span>
          </div>
          <h2 className="text-lg font-semibold leading-snug tracking-tight">{ticket.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
            <span className="text-xs text-slate-500">{ticket.sentiment} · {ticket.requesterName}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select aria-label="Status" value={ticket.status} onChange={(e) => changeStatus(e.target.value as TicketStatus)} className={clsx(inputClass, 'h-9 py-1')}>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s} disabled={s !== ticket.status && !ALLOWED_TRANSITIONS[ticket.status].includes(s)} className="bg-slate-900">{STATUS_LABEL[s]}</option>
              ))}
            </select>
            <select aria-label="Swarm squad" value={ticket.swarmSquad} disabled={resolved} onChange={(e) => setHandoff({ open: true, squad: e.target.value as SwarmSquad })} className={clsx(inputClass, 'h-9 py-1')}>
              {SWARM_SQUADS.map((s) => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
            </select>
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-2.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">{ticket.slaPaused ? 'Paused' : 'SLA'}</span>
              <SlaTimer ticket={ticket} />
              <Button size="sm" variant="ghost" onClick={togglePause} disabled={!canPause || resolved} aria-label={ticket.slaPaused ? 'Resume SLA' : 'Pause SLA'} title="Waiting on customer pauses the SLA">
                {ticket.slaPaused ? <PlayCircle className="size-3.5" /> : <PauseCircle className="size-3.5" />}<Kbd>P</Kbd>
              </Button>
            </div>
          </div>
          {!resolved && live < 3600 && !ticket.slaPaused && (
            <p className="flex items-center gap-1.5 text-xs text-rose-300"><TriangleAlert className="size-3.5" />Less than an hour to SLA breach ({formatSla(live)}).</p>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {flags.ai_agents && foreign && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-sky-500/15 bg-sky-500/[0.06] px-3 py-2 text-xs text-sky-100">
              <Languages className="size-3.5 text-sky-400" />
              Requester writes in {langName(ticket.detectedLanguage)}. AI live translation is {showTranslation ? 'on' : 'off'}.
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShowTranslation((v) => !v)}>
                {showTranslation ? 'Hide' : 'Show'} <Kbd>T</Kbd>
              </Button>
            </div>
          )}
          <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Timeline filter">
            {TIMELINE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={timelineFilter === f.key}
                onClick={() => setTimelineFilter(f.key)}
                className={clsx('rounded-full border px-2.5 py-0.5 text-[11px] transition', timelineFilter === f.key ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200' : 'border-white/[0.08] text-slate-400 hover:text-slate-200')}
              >
                {f.label} <span className="font-mono opacity-70">{ticket.messages.filter(f.match).length}</span>
              </button>
            ))}
          </div>
          <TicketTimeline messages={ticket.messages.filter(TIMELINE_FILTERS.find((f) => f.key === timelineFilter)!.match)} showTranslation={flags.ai_agents && showTranslation} />
        </div>

        {/* composer */}
        <div className="border-t border-white/[0.08] p-3">
          <div className="mb-2 flex items-center gap-1">
            {([['reply', MessageSquareText, `Reply via ${ticket.channel}`], ['internal', Lock, 'Internal swarm note']] as const).map(([k, Icon, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                disabled={k === 'reply' && !canReply}
                title={k === 'reply' && !canReply ? 'Automated source — there is no requester to reply to' : undefined}
                aria-pressed={mode === k}
                className={clsx('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40', mode === k ? (k === 'internal' ? 'bg-amber-400/15 text-amber-200' : 'bg-indigo-500/15 text-indigo-200') : 'text-slate-400 hover:text-slate-200')}
              >
                <Icon className="size-3.5" />{label}
              </button>
            ))}
            {resolved ? (
              <Button size="sm" className="ml-auto" onClick={() => changeStatus('ACTIVE_SWARM')}>Reopen</Button>
            ) : (
              <span className="ml-auto flex gap-1.5">
                <Button size="sm" onClick={() => setHandoff({ open: true })}><ArrowRightLeft className="size-3.5" />Hand off</Button>
                <Button size="sm" variant="primary" onClick={() => setResolveOpen(true)}><BookOpen className="size-3.5" />Resolve</Button>
              </span>
            )}
          </div>
          {slashItems.length > 0 && (
            <ul className="mb-2 max-h-52 overflow-y-auto rounded-xl border border-white/[0.1] bg-raised p-1 shadow-card" role="listbox" aria-label="Slash commands">
              {slashItems.map((item, i) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === Math.min(slashIndex, slashItems.length - 1)}
                    onMouseEnter={() => setSlashIndex(i)}
                    onMouseDown={(e) => { e.preventDefault(); applySlash(item); }}
                    className={clsx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs', i === Math.min(slashIndex, slashItems.length - 1) ? 'bg-white/[0.07] text-slate-100' : 'text-slate-300')}
                  >
                    <span className={clsx('rounded px-1.5 py-0.5 font-mono text-[10px]', item.kind === 'macro' ? 'bg-indigo-500/15 text-indigo-300' : item.kind === 'kb' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-slate-400')}>
                      {item.kind === 'macro' ? 'MACRO' : item.kind === 'kb' ? item.id : 'REPLY'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={clsx('grid gap-2', mode === 'reply' && foreign && 'md:grid-cols-2')}>
            <textarea
              aria-label="Composer"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (slashItems.length) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : slashItems.length - 1)) % slashItems.length);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    applySlash(slashItems[Math.min(slashIndex, slashItems.length - 1)]!);
                    return;
                  }
                }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={mode === 'internal' ? 'Note for the swarm — the requester never sees this…  ( / for saved replies & KB )' : 'Write in English…  ( / for saved replies, KB steps & macros )'}
              className={clsx(inputClass, 'resize-none', mode === 'internal' && 'border-amber-400/20 bg-amber-400/[0.04]')}
            />
            {mode === 'reply' && foreign && (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-xs">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{ticket.requesterName.split(' ')[0]} will read ({ticket.detectedLanguage.toUpperCase()})</p>
                {nativeFresh ? (
                  <p className="leading-relaxed text-slate-200" lang={nativeFresh.lang}>{nativeFresh.text}</p>
                ) : (
                  <p className="text-amber-300/90">
                    {text.trim()
                      ? 'Live translation of free text needs the AI backend (Phase 5). This reply will be sent in English — or use an AI draft, which comes pre-translated.'
                      : flags.ai_agents ? 'Use “AI draft” to get a reply in both languages.' : 'Sent in English.'}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {flags.ai_agents && mode === 'reply' && (
              <Button
                size="sm"
                onClick={() => {
                  const d = draftReply(resolved ? 'resolved' : 'progress', ticket.detectedLanguage, ticket.requesterName, ticket.linkedKbId);
                  setText(d.english);
                  setNative(d.lang !== 'en' ? { text: d.native, lang: d.lang, source: d.english } : null);
                }}
              >
                AI draft empathetic reply
              </Button>
            )}
            <span className="ml-auto text-[10px] text-slate-500"><Kbd>⌘</Kbd> <Kbd>↵</Kbd> to send</span>
            <Button size="sm" variant="primary" onClick={send} disabled={!text.trim()}>
              <Send className="size-3.5" />{mode === 'internal' ? 'Add note' : 'Send'}
            </Button>
          </div>
        </div>
      </section>

      {flags.ai_agents && (
        <aside className="min-h-0 space-y-4 overflow-y-auto p-4" aria-label="Copilot and context">
          <CopilotPanel
            subject={subject}
            kind="ticket"
            disabled={resolved}
            onExecuteMacro={() => executeMacro(ticket.id)}
            onInsertDraft={!canReply ? undefined : (d) => {
              setMode('reply');
              setText(d.english);
              setNative(d.lang !== 'en' ? { text: d.native, lang: d.lang, source: d.english } : null);
            }}
            onInsertSteps={(kbId, steps) => {
              setMode('reply');
              const body = `Here are the verified steps from ${kbId}:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
              setText((t) => (t ? `${t}\n\n${body}` : body));
            }}
            onResolveWithKb={(kbId) => transitionTicket(ticket.id, 'RESOLVED_KB_LINKED', { kbId, note: 'Resolved with AI-suggested article, approved by agent' })}
            onCreateProblem={(label, closedIds, openIds) =>
              createProblem({
                title: label, description: `Recurring pattern detected by AI from ${closedIds.length + openIds.length} tickets.`,
                priority: ticket.priority, swarmSquad: ticket.swarmSquad, linkedTicketIds: openIds, linkedClosedTicketIds: closedIds,
              })
            }
          />
        </aside>
      )}

      <ContextStrip
        ticket={ticket}
        asset={flags.itam_cmdb ? asset : undefined}
        saasName={flags.torii_saas ? saas?.name : undefined}
        grants={flags.password_vault ? grants.map((g) => ({ name: g.name, expiresAt: g.activeGrant!.expiresAt })) : []}
        onAsset={() => asset && openInspector({ kind: 'asset', id: asset.id })}
        onSaas={() => saas && openInspector({ kind: 'saas', id: saas.id })}
        onJit={flags.password_vault && !resolved ? () => openJitModal({ ticketId: ticket.id }) : undefined}
        jira={jira}
        setJira={setJira}
        onLinkJira={() => linkJiraIssue(ticket.id, jira).ok && setJira('')}
      />

      <HandoffContextModal ticket={ticket} initialSquad={handoff.squad} open={handoff.open} onClose={() => setHandoff({ open: false })} />
      <ResolveKbModal ticket={ticket} open={resolveOpen} onClose={() => setResolveOpen(false)} />
    </>
  );
}

/** Context lives in a floating strip so the copilot column stays focused on suggestions. */
function ContextStrip({ ticket, asset, saasName, grants, onAsset, onSaas, onJit, jira, setJira, onLinkJira }: {
  ticket: Ticket;
  asset?: { id: string; name: string };
  saasName?: string;
  grants: { name: string; expiresAt: string }[];
  onAsset: () => void;
  onSaas: () => void;
  onJit?: () => void;
  jira: string;
  setJira: (v: string) => void;
  onLinkJira: () => void;
}) {
  const now = useNow();
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.08] bg-sidebar px-4 py-2 text-xs lg:col-[2/-1]">
      <span className="text-slate-500">Context</span>
      {asset && <button type="button" onClick={onAsset} className="az-chip"><Laptop className="size-3.5 text-slate-400" /><span className="font-mono">{asset.id}</span></button>}
      {saasName && <button type="button" onClick={onSaas} className="az-chip"><Cloud className="size-3.5 text-slate-400" />{saasName}</button>}
      {grants.map((g) => (
        <span key={g.name} className="az-chip border-emerald-500/30 text-emerald-300">
          <KeyRound className="size-3.5" />{g.name} · <span className="font-mono">{formatSla(Math.max(0, Math.round((Date.parse(g.expiresAt) - now) / 1000)))}</span>
        </span>
      ))}
      {onJit && <Button size="sm" onClick={onJit}><KeyRound className="size-3.5" />JIT admin access (1h)</Button>}
      <form
        className="ml-auto flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          onLinkJira();
        }}
      >
        <GitBranch className="size-3.5 text-slate-500" />
        <input
          aria-label="Link Jira issue"
          value={jira}
          onChange={(e) => setJira(e.target.value)}
          placeholder={ticket.linkedJiraIssue ?? 'Link Jira issue (PROJ-123)'}
          className="h-7 w-44 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500/60"
        />
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ record tabs (ServiceNow-style)

function TicketTabs({ activeId }: { activeId: string }) {
  const tabs = usePlatformStore((s) => s.openTicketTabs);
  const tickets = usePlatformStore((s) => s.tickets);
  const selectTicket = usePlatformStore((s) => s.selectTicket);
  const closeTicketTab = usePlatformStore((s) => s.closeTicketTab);
  const open = tabs.map((id) => tickets.find((t) => t.id === id)).filter((t): t is Ticket => !!t);
  if (open.length < 2) return null;
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-white/[0.08] bg-sunken px-2 pt-1.5" role="tablist" aria-label="Open tickets">
      {open.map((t) => (
        <div
          key={t.id}
          className={clsx('group flex max-w-[200px] shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-xs', t.id === activeId ? 'border-white/[0.1] bg-canvas text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200')}
        >
          <button type="button" role="tab" aria-selected={t.id === activeId} onClick={() => selectTicket(t.id)} className="flex min-w-0 items-center gap-1.5">
            <span className="whitespace-nowrap font-mono">{t.id}</span>
            <span className="truncate">{t.title}</span>
          </button>
          <button type="button" onClick={() => closeTicketTab(t.id)} aria-label={`Close ${t.id}`} className="rounded p-0.5 text-slate-500 opacity-60 hover:bg-white/[0.08] hover:opacity-100">×</button>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ timeline filter (review AI activity separately)

type TimelineFilterKey = 'all' | 'conversation' | 'ai' | 'internal';
const TIMELINE_FILTERS: { key: TimelineFilterKey; label: string; match: (m: Ticket['messages'][number]) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'conversation', label: 'Conversation', match: (m) => m.role === 'end_user' || (m.role === 'agent' && m.metadata?.visibility !== 'internal') },
  { key: 'ai', label: 'AI & automation', match: (m) => m.role === 'ai_system' || m.role === 'diagnostic_telemetry' },
  { key: 'internal', label: 'Internal & handoffs', match: (m) => m.role === 'handoff_audit' || m.metadata?.visibility === 'internal' },
];

// ------------------------------------------------------------------ "/" menu (Zendesk-style macros)

type SlashItem = { id: string; kind: 'reply' | 'kb' | 'macro'; label: string; insert: string };

function buildSlashItems(q: string, kbArticles: KbArticle[], ticket: Ticket, aiOn: boolean): SlashItem[] {
  const matches = (s: string) => !q || s.toLowerCase().includes(q);
  const items: SlashItem[] = [
    ...(aiOn && ticket.recommendedMacro && ticket.status !== 'RESOLVED_KB_LINKED' && matches(`macro run ${ticket.recommendedMacro.label}`)
      ? [{ id: 'macro', kind: 'macro' as const, label: `Run: ${ticket.recommendedMacro.label} (you approve by choosing this)`, insert: '' }]
      : []),
    ...CANNED_REPLIES.filter((r) => matches(`${r.id} ${r.label}`)).map((r) => ({ id: r.id, kind: 'reply' as const, label: r.label, insert: r.body })),
    ...kbArticles
      .filter((k) => matches(`${k.id} ${k.title}`))
      .slice(0, 5)
      .map((k) => ({ id: k.id, kind: 'kb' as const, label: k.title, insert: `Here are the verified steps from ${k.id}:\n${k.steps.map((st, i) => `${i + 1}. ${st}`).join('\n')}` })),
  ];
  return items.slice(0, 9);
}
