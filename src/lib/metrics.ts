import { liveSlaSeconds } from '@/lib/sla';
import type { MetricsBaseline, SaasApp, Ticket } from '@/types/platform';

export interface Kpis {
  openIncidents: number;
  openP1: number;
  fcrPercent: number;
  mttrMinutes: number;
  slaCompliancePercent: number;
  slaBreachedOpen: number;
  monthlySaasSpend: number;
  reclaimableMonthly: number;
  idleSeats: number;
}

function resolutionMinutes(t: Ticket): number | null {
  const resolvedMsg = [...t.messages].reverse().find((m) => m.metadata?.to === 'RESOLVED_KB_LINKED');
  const end = resolvedMsg ?? t.messages[t.messages.length - 1];
  const start = t.messages[0];
  if (!start || !end) return null;
  return Math.max(1, (Date.parse(end.timestamp) - Date.parse(start.timestamp)) / 60_000);
}

export function computeKpis(
  tickets: readonly Ticket[],
  anchors: Readonly<Record<string, number>>,
  saasApps: readonly SaasApp[],
  baseline: MetricsBaseline,
  nowMs: number,
): Kpis {
  const open = tickets.filter((t) => t.status !== 'RESOLVED_KB_LINKED');
  const resolved = tickets.filter((t) => t.status === 'RESOLVED_KB_LINKED');

  const firstContact = resolved.filter((t) => !t.messages.some((m) => m.role === 'handoff_audit')).length;
  const liveMinutes = resolved.map(resolutionMinutes).filter((m): m is number => m !== null);

  const resolvedWithinSla = resolved.filter((t) => t.slaRemainingSeconds > 0).length;
  const openBreached = open.filter((t) => liveSlaSeconds(t, anchors[t.id], nowMs) <= 0).length;

  const resolvedCount = baseline.resolvedCount + resolved.length;
  const slaTotal = baseline.slaTotal + resolved.length + openBreached;

  return {
    openIncidents: open.filter((t) => t.type === 'INCIDENT').length,
    openP1: open.filter((t) => t.priority === 'P1').length,
    fcrPercent: resolvedCount ? ((baseline.firstContactResolved + firstContact) / resolvedCount) * 100 : 0,
    mttrMinutes: resolvedCount
      ? (baseline.totalResolutionMinutes + liveMinutes.reduce((a, b) => a + b, 0)) /
        (baseline.resolvedCount + liveMinutes.length)
      : 0,
    slaCompliancePercent: slaTotal ? ((baseline.slaMet + resolvedWithinSla) / slaTotal) * 100 : 100,
    slaBreachedOpen: openBreached,
    monthlySaasSpend: saasApps.reduce((sum, a) => sum + a.provisionedSeats * a.costPerSeatMonthly, 0),
    reclaimableMonthly: saasApps.reduce((sum, a) => sum + a.inactiveUsers.length * a.costPerSeatMonthly, 0),
    idleSeats: saasApps.reduce((sum, a) => sum + a.inactiveUsers.length, 0),
  };
}

export const usd = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits });

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function timeAgo(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
