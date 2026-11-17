'use client';

import clsx from 'clsx';
import { CheckCircle2, ExternalLink, RefreshCw, Search, Settings2, TriangleAlert, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, Card, Modal, inputClass } from '@/components/ui/primitives';
import { TOOL_BY_ID, TOOL_CATALOG, type ToolCategory, type ToolDef } from '@/data/tools';
import { useNow } from '@/hooks/useNow';
import { timeAgo } from '@/lib/metrics';
import { LEVEL_LABEL, LEVEL_RANK, fetchToolStatus, isDown, type StatusLevel, type ToolStatus } from '@/lib/toolStatus';
import { usePlatformStore } from '@/store/usePlatformStore';

const POLL_MS = 3 * 60_000;

export const LEVEL_DOT: Record<StatusLevel, string> = {
  operational: 'bg-emerald-400',
  maintenance: 'bg-sky-400',
  degraded: 'bg-amber-400',
  partial_outage: 'bg-orange-500',
  major_outage: 'bg-rose-500 animate-pulse',
  unknown: 'bg-slate-500',
  link_only: 'bg-slate-600',
};

/** Polls the selected tools' public status APIs every 3 minutes while Home is open. */
function useToolStatuses(ids: string[]) {
  const [statuses, setStatuses] = useState<Record<string, ToolStatus>>({});
  const [refreshing, setRefreshing] = useState(false);
  const key = ids.join(',');
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const tools = key.split(',').filter(Boolean).map((id) => TOOL_BY_ID[id]).filter((t): t is ToolDef => !!t);
    const results = await Promise.all(tools.map((t) => fetchToolStatus(t)));
    setStatuses(Object.fromEntries(results.map((r) => [r.id, r])));
    setRefreshing(false);
  }, [key]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);
  return { statuses, refresh, refreshing };
}

export function ToolStatusPanel() {
  const selected = usePlatformStore((s) => s.selectedTools);
  const { statuses, refresh, refreshing } = useToolStatuses(selected);
  const now = useNow();
  const [managing, setManaging] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  const tools = selected.map((id) => TOOL_BY_ID[id]).filter((t): t is ToolDef => !!t);
  const sorted = [...tools].sort((a, b) => LEVEL_RANK[statuses[a.id]?.level ?? 'unknown'] - LEVEL_RANK[statuses[b.id]?.level ?? 'unknown'] || a.name.localeCompare(b.name));
  const down = tools.filter((t) => isDown(statuses[t.id]?.level ?? 'unknown'));
  const loaded = Object.keys(statuses).length > 0;
  const lastChecked = Object.values(statuses)[0]?.fetchedAt;

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Tool status</h2>
        {!loaded ? (
          <span className="text-xs text-slate-500">Checking…</span>
        ) : down.length ? (
          <span className="flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs text-amber-200"><TriangleAlert className="size-3" />{down.length} tool{down.length === 1 ? '' : 's'} having issues</span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs text-emerald-200"><CheckCircle2 className="size-3" />All good</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {lastChecked && <span className="text-[10px] text-slate-500">checked {timeAgo(lastChecked, now)}</span>}
          <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh tool status">
            <RefreshCw className={clsx('size-3.5', refreshing && 'animate-spin')} />
          </Button>
          <Button size="sm" onClick={() => setManaging(true)}><Settings2 className="size-3.5" />Manage tools</Button>
        </span>
      </div>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {sorted.map((t) => {
          const st = statuses[t.id];
          const level: StatusLevel = st?.level ?? (t.api === 'link' ? 'link_only' : 'unknown');
          const inner = (
            <>
              <span className={clsx('size-2 shrink-0 rounded-full', st ? LEVEL_DOT[level] : 'bg-slate-600 animate-pulse')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-slate-100">{t.name}</span>
                <span className={clsx('block truncate text-[11px]', isDown(level) ? 'text-amber-200' : 'text-slate-500')}>
                  {st ? (isDown(level) && st.incidents[0] ? st.incidents[0].name : LEVEL_LABEL[level]) : 'Checking…'}
                </span>
              </span>
              {level === 'link_only' && <ExternalLink className="size-3 shrink-0 text-slate-500" />}
            </>
          );
          const cls = clsx('flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition hover:border-white/[0.16]', isDown(level) ? 'border-amber-400/30 bg-amber-400/[0.05]' : 'border-white/[0.06] bg-white/[0.02]');
          return (
            <li key={t.id}>
              {level === 'link_only' ? (
                <a href={t.statusUrl} target="_blank" rel="noreferrer" className={cls} title="No public status API — opens the official status page">{inner}</a>
              ) : (
                <button type="button" className={cls} onClick={() => setDetail(t.id)}>{inner}</button>
              )}
            </li>
          );
        })}
      </ul>
      {!tools.length && <p className="py-6 text-center text-sm text-slate-500">Pick the tools your company relies on to see their live status here.</p>}

      <ManageToolsModal open={managing} onClose={() => setManaging(false)} />
      <ToolDetailModal tool={detail ? TOOL_BY_ID[detail] : undefined} status={detail ? statuses[detail] : undefined} onClose={() => setDetail(null)} />
    </Card>
  );
}

function ManageToolsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Choose the tools to watch" subtitle={`${TOOL_CATALOG.length} tools with public status pages. Live status where the vendor publishes an API; a link otherwise.`} width="max-w-2xl">
      {open && <ManageToolsForm onClose={onClose} />}
    </Modal>
  );
}

function ManageToolsForm({ onClose }: { onClose: () => void }) {
  const selected = usePlatformStore((s) => s.selectedTools);
  const setSelectedTools = usePlatformStore((s) => s.setSelectedTools);
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ToolCategory | 'All'>('All');
  const categories = useMemo(() => ['All', ...new Set(TOOL_CATALOG.map((t) => t.category))] as (ToolCategory | 'All')[], []);
  const list = TOOL_CATALOG.filter((t) => (category === 'All' || t.category === category) && t.name.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 size-4 text-slate-500" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools…" aria-label="Search tools" className={clsx(inputClass, 'pl-8')} />
      </div>
      <div className="flex flex-wrap gap-1">
        {categories.map((c) => (
          <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={clsx('rounded-full border px-2.5 py-0.5 text-xs', category === c ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200' : 'border-white/[0.08] text-slate-400 hover:text-slate-200')}>{c}</button>
        ))}
      </div>
      <ul className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
        {list.map((t) => (
          <li key={t.id}>
            <label className={clsx('flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition', picked.has(t.id) ? 'border-indigo-500/40 bg-indigo-500/[0.08]' : 'border-white/[0.06] hover:border-white/[0.14]')}>
              <input type="checkbox" className="accent-indigo-500" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
              <span className="flex-1 text-slate-100">{t.name}</span>
              <span className={clsx('text-[10px]', t.api === 'link' ? 'text-slate-500' : 'text-emerald-300')}>{t.api === 'link' ? 'link' : 'live'}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">{picked.size} selected</span>
        <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => { setSelectedTools(TOOL_CATALOG.filter((t) => picked.has(t.id)).map((t) => t.id)); onClose(); }}>Save</Button>
        </span>
      </div>
    </div>
  );
}

function ToolDetailModal({ tool, status, onClose }: { tool?: ToolDef; status?: ToolStatus; onClose: () => void }) {
  const now = useNow();
  const level = status?.level ?? 'unknown';
  return (
    <Modal open={!!tool} onClose={onClose} title={tool ? `${tool.name} — ${LEVEL_LABEL[level]}` : ''} subtitle={status?.description} width="max-w-xl">
      {tool && (
        <div className="space-y-4 text-sm">
          {status?.error && <p className="rounded-lg border border-white/[0.08] p-2.5 text-xs text-slate-400">Couldn’t reach {tool.name}’s status API ({status.error}). Open the official page for the latest.</p>}
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">What’s down</h3>
            {status?.affectedComponents.length ? (
              <ul className="space-y-1">
                {status.affectedComponents.map((c) => (
                  <li key={c.name} className="flex items-center gap-2 text-xs">
                    <span className={clsx('size-2 rounded-full', /major/.test(c.status) ? 'bg-rose-500' : /partial/.test(c.status) ? 'bg-orange-500' : /maintenance/.test(c.status) ? 'bg-sky-400' : 'bg-amber-400')} />
                    <span className="text-slate-200">{c.name}</span>
                    <span className="ml-auto capitalize text-slate-500">{c.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-emerald-300">{status ? 'Every component is operational.' : 'Checking…'}</p>
            )}
          </section>
          {!!status?.incidents.length && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Active incidents</h3>
              <ul className="space-y-2">
                {status.incidents.map((i) => (
                  <li key={i.name} className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-2.5">
                    <p className="flex items-start gap-2 text-sm text-slate-100">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                      <span className="flex-1">{i.name}</span>
                      {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline" aria-label="Open incident"><ExternalLink className="size-3.5" /></a>}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500 capitalize">{i.status} · impact {i.impact}{i.updatedAt ? ` · updated ${timeAgo(i.updatedAt, now)}` : ''}</p>
                    {i.latestUpdate && <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-xs text-slate-300">{i.latestUpdate}</p>}
                    {i.components.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Affects: {i.components.join(', ')}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!status?.maintenances.length && (
            <section>
              <h3 className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500"><Wrench className="size-3" />Maintenance</h3>
              <ul className="space-y-1 text-xs">
                {status.maintenances.map((m) => <li key={m.name} className="text-slate-300">{m.name}{m.scheduledFor ? <span className="text-slate-500"> · {new Date(m.scheduledFor).toLocaleString()}</span> : null}</li>)}
              </ul>
            </section>
          )}
          <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-xs text-slate-500">
            <span>{status ? `Checked ${timeAgo(status.fetchedAt, now)}` : ''}</span>
            <a href={tool.statusUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-indigo-300 hover:underline">Official status page <ExternalLink className="size-3" /></a>
          </div>
        </div>
      )}
    </Modal>
  );
}
