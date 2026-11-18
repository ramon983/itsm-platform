'use client';

import clsx from 'clsx';
import { Activity, Clock, ShieldAlert } from 'lucide-react';

import { Button, Card } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { timeAgo } from '@/lib/metrics';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { TelemetryEvent } from '@/types/platform';

// ------------------------------------------------------------------ telemetry feed

const SEVERITY_STYLE: Record<TelemetryEvent['severity'], string> = {
  critical: 'bg-rose-500',
  high: 'bg-orange-400',
  medium: 'bg-amber-300',
  info: 'bg-sky-400',
};

export function TelemetryFeed({ limit }: { limit?: number }) {
  const telemetry = usePlatformStore((s) => s.telemetry);
  const flags = usePlatformStore((s) => s.flags);
  const simulate = usePlatformStore((s) => s.simulateSentinelAlert);
  const openInspector = usePlatformStore((s) => s.openInspector);
  const now = useNow();

  const visible = telemetry.filter((e) => (e.source === 'Torii' ? flags.torii_saas : e.source === 'Vault' ? flags.password_vault : true)).slice(0, limit);

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
