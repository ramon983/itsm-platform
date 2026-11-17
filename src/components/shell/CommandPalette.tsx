'use client';

import clsx from 'clsx';
import { Cloud, KeyRound, Laptop, RotateCcw, Search, ShieldAlert, ToggleLeft, Ticket as TicketIcon, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Kbd, PriorityBadge, StatusBadge } from '@/components/ui/primitives';
import { MODULE_LABEL, usePlatformStore, type PaletteScope } from '@/store/usePlatformStore';
import type { ModuleKey, Ticket, TicketStatus } from '@/types/platform';

interface PaletteItem {
  id: string;
  group: 'Tickets' | 'Assets' | 'SaaS apps' | 'Vault' | 'Macros' | 'Actions';
  scope: Exclude<PaletteScope, 'all'> | 'actions';
  icon: typeof Search;
  label: string;
  hint?: string;
  mono?: string;
  priority?: Ticket['priority'];
  status?: TicketStatus;
  keywords: string;
  run: () => void;
}

const SCOPES: { key: PaletteScope; label: string; flag?: ModuleKey }[] = [
  { key: 'all', label: 'All' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'assets', label: 'Assets', flag: 'itam_cmdb' },
  { key: 'saas', label: 'SaaS', flag: 'torii_saas' },
  { key: 'vault', label: 'Vault', flag: 'password_vault' },
  { key: 'macros', label: 'Macros', flag: 'ai_agents' },
];

export function CommandPalette() {
  const palette = usePlatformStore((s) => s.palette);
  const close = usePlatformStore((s) => s.closePalette);
  if (!palette.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button type="button" aria-label="Close command palette" className="absolute inset-0 bg-scrim" onClick={close} />
      <PaletteBody initialScope={palette.scope} onClose={close} />
    </div>
  );
}

function PaletteBody({ initialScope, onClose }: { initialScope: PaletteScope; onClose: () => void }) {
  const s = usePlatformStore();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<PaletteScope>(initialScope);
  const [cursor, setCursor] = useState(0);

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = s.tickets.map((t) => ({
      id: `t-${t.id}`, group: 'Tickets', scope: 'tickets', icon: TicketIcon, label: t.title, mono: t.id,
      priority: t.priority, status: t.status,
      keywords: `${t.id} ${t.title} ${t.requesterName} ${t.swarmSquad} ${t.linkedAssetId ?? ''} ${t.detectedLanguage}`,
      run: () => s.openInspector({ kind: 'ticket', id: t.id }),
    }));
    if (s.flags.itam_cmdb) {
      s.assets.forEach((a) =>
        list.push({
          id: `a-${a.id}`, group: 'Assets', scope: 'assets', icon: Laptop, label: a.name, mono: a.id,
          hint: `${a.assignedTo ?? 'Unassigned'} · ${a.lifecycle}`,
          keywords: `${a.id} ${a.name} ${a.serialNumber} ${a.assignedTo ?? ''} ${a.model}`,
          run: () => s.openInspector({ kind: 'asset', id: a.id }),
        }),
      );
    }
    if (s.flags.torii_saas) {
      s.saasApps.forEach((a) =>
        list.push({
          id: `s-${a.id}`, group: 'SaaS apps', scope: 'saas', icon: Cloud, label: a.name,
          hint: `${a.activeSeats}/${a.provisionedSeats} seats · ${a.inactiveUsers.length} idle${a.approved ? '' : ' · Shadow IT'}`,
          keywords: `${a.name} ${a.vendor} ${a.category} ${a.approved ? '' : 'shadow'}`,
          run: () => s.openInspector({ kind: 'saas', id: a.id }),
        }),
      );
    }
    if (s.flags.password_vault) {
      s.vault.forEach((v) =>
        list.push({
          id: `v-${v.id}`, group: 'Vault', scope: 'vault', icon: KeyRound, label: v.name, mono: v.scope,
          hint: `${v.kind} · ${v.allowedSquads.join(' / ')}`, keywords: `${v.name} ${v.scope} ${v.kind} jit vault`,
          run: () => s.openJitModal({ vaultId: v.id }),
        }),
      );
    }
    if (s.flags.ai_agents) {
      s.tickets
        .filter((t) => t.recommendedMacro && t.status !== 'RESOLVED_KB_LINKED')
        .forEach((t) =>
          list.push({
            id: `m-${t.id}`, group: 'Macros', scope: 'macros', icon: Zap, label: t.recommendedMacro!.label, mono: t.id,
            hint: 'Run remediation macro', keywords: `${t.recommendedMacro!.label} ${t.id} macro run`,
            run: () => {
              s.executeMacro(t.id);
              s.closePalette();
            },
          }),
        );
    }
    list.push(
      {
        id: 'act-siem', group: 'Actions', scope: 'actions', icon: ShieldAlert, label: 'Simulate Sentinel SIEM alert',
        hint: 'Inject MFA brute-force on MBP-0942', keywords: 'siem sentinel alert simulate p1',
        run: () => {
          const id = s.simulateSentinelAlert();
          s.openInspector({ kind: 'ticket', id });
        },
      },
      ...(Object.keys(MODULE_LABEL) as ModuleKey[])
        .filter((k) => k !== 'itsm_core')
        .map<PaletteItem>((k) => ({
          id: `act-flag-${k}`, group: 'Actions', scope: 'actions', icon: ToggleLeft,
          label: `${s.flags[k] ? 'Disable' : 'Enable'} ${MODULE_LABEL[k]} module`, keywords: `module toggle flag ${k} ${MODULE_LABEL[k]}`,
          run: () => s.toggleFlag(k),
        })),
      {
        id: 'act-reset', group: 'Actions', scope: 'actions', icon: RotateCcw, label: 'Reset demo state',
        hint: 'Re-seed all tickets, assets and SaaS data', keywords: 'reset demo seed',
        run: () => {
          s.resetDemo();
          s.closePalette();
        },
      },
    );
    return list;
  }, [s]);

  const q = query.trim().toLowerCase();
  // Exact ID hits (e.g. "MBP-1004", "INC-1049") outrank items that merely mention the ID.
  const rank = (i: PaletteItem) => {
    if (!q) return 0;
    const mono = i.mono?.toLowerCase();
    if (mono === q) return 0;
    if (mono?.startsWith(q)) return 1;
    if (i.label.toLowerCase().includes(q)) return 2;
    return 3;
  };
  const results = items
    .filter((i) => scope === 'all' || i.scope === scope)
    .filter((i) => !q || q.split(/\s+/).every((term) => `${i.label} ${i.keywords}`.toLowerCase().includes(term)))
    .map((item, index) => ({ item, index, r: rank(item) }))
    .sort((a, b) => a.r - b.r || a.index - b.index)
    .map(({ item }) => item)
    .slice(0, 40);
  const active = Math.min(cursor, Math.max(0, results.length - 1));

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    item.run();
    if (item.scope === 'actions' && item.id.startsWith('act-flag')) s.closePalette();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const enabled = SCOPES.filter((sc) => !sc.flag || s.flags[sc.flag]);
      const idx = enabled.findIndex((sc) => sc.key === scope);
      setScope(enabled[(idx + (e.shiftKey ? enabled.length - 1 : 1)) % enabled.length]!.key);
      setCursor(0);
    }
  };

  return (
    <div className="az-pop-in relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.1] bg-raised shadow-2xl ">
      <div className="flex items-center gap-3 border-b border-white/[0.08] px-4">
        <Search className="size-4 text-slate-500" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search tickets, assets, SaaS apps, vault, or run a macro…"
          className="h-12 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          aria-label="Search"
        />
        <Kbd>ESC</Kbd>
      </div>
      <div className="flex gap-1 border-b border-white/[0.06] px-3 py-2">
        {SCOPES.filter((sc) => !sc.flag || s.flags[sc.flag]).map((sc) => (
          <button
            key={sc.key}
            type="button"
            onClick={() => {
              setScope(sc.key);
              setCursor(0);
            }}
            className={clsx(
              'rounded-md px-2 py-1 text-xs transition',
              scope === sc.key ? 'bg-indigo-600 text-onaccent' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200',
            )}
          >
            {sc.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[10px] text-slate-500"><Kbd>TAB</Kbd> switch scope</span>
      </div>
      <ul className="max-h-[52vh] overflow-y-auto p-2" role="listbox">
        {results.map((item, i) => {
          const header = i === 0 || results[i - 1]!.group !== item.group ? item.group : null;
          const Icon = item.icon;
          return (
            <li key={item.id}>
              {header && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{header}</p>}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(item)}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm',
                  i === active ? 'bg-white/[0.07] text-slate-50' : 'text-slate-300',
                )}
              >
                <Icon className="size-4 shrink-0 text-slate-500" />
                {item.mono && <span className="shrink-0 font-mono text-xs text-slate-400">{item.mono}</span>}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="hidden shrink-0 text-xs text-slate-500 sm:block">{item.hint}</span>}
                {item.priority && <PriorityBadge priority={item.priority} />}
                {item.status && <StatusBadge status={item.status} />}
              </button>
            </li>
          );
        })}
        {!results.length && <li className="px-3 py-8 text-center text-sm text-slate-500">No matches for “{query}”.</li>}
      </ul>
    </div>
  );
}
