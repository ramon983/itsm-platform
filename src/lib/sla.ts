import type { Ticket } from '@/types/platform';

/**
 * Live SLA math. `slaRemainingSeconds` on a ticket is the value at the moment stored in `anchorMs`
 * (the last pause/resume/create). While running, the clock counts down from that anchor; while
 * paused, it is frozen at the stored value.
 */
export function liveSlaSeconds(ticket: Ticket, anchorMs: number | undefined, nowMs: number): number {
  if (ticket.slaPaused || ticket.status === 'RESOLVED_KB_LINKED' || anchorMs === undefined) {
    return ticket.slaRemainingSeconds;
  }
  return Math.round(ticket.slaRemainingSeconds - (nowMs - anchorMs) / 1000);
}

export function formatSla(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export type SlaTone = 'breached' | 'critical' | 'warning' | 'healthy' | 'paused' | 'done';

export function slaTone(ticket: Ticket, seconds: number): SlaTone {
  if (ticket.status === 'RESOLVED_KB_LINKED') return 'done';
  if (ticket.slaPaused) return 'paused';
  if (seconds <= 0) return 'breached';
  if (seconds < 3600) return 'critical';
  if (seconds < 4 * 3600) return 'warning';
  return 'healthy';
}
