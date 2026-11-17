import type { SwarmSquad, Ticket, TicketPriority, TicketStatus } from '@/types/platform';

// §3.1 — No Jira status zoo. These are the only statuses, and the only moves between them.
export const TICKET_STATUSES: readonly TicketStatus[] = [
  'AI_TRIAGED',
  'ACTIVE_SWARM',
  'WAITING_ON_CUSTOMER',
  'WAITING_ON_VENDOR',
  'RESOLVED_KB_LINKED',
] as const;

export const ALLOWED_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  AI_TRIAGED: ['ACTIVE_SWARM', 'WAITING_ON_CUSTOMER', 'RESOLVED_KB_LINKED'],
  ACTIVE_SWARM: ['WAITING_ON_CUSTOMER', 'WAITING_ON_VENDOR', 'RESOLVED_KB_LINKED'],
  WAITING_ON_CUSTOMER: ['ACTIVE_SWARM', 'RESOLVED_KB_LINKED'],
  WAITING_ON_VENDOR: ['ACTIVE_SWARM', 'RESOLVED_KB_LINKED'],
  RESOLVED_KB_LINKED: ['ACTIVE_SWARM'], // reopen
};

export const SLA_PAUSING: ReadonlySet<TicketStatus> = new Set(['WAITING_ON_CUSTOMER', 'WAITING_ON_VENDOR']);

export const SWARM_SQUADS: readonly SwarmSquad[] = [
  'Network & Identity',
  'Endpoint & Mac',
  'SaaS & Cloud Ops',
  'Security & SIEM',
] as const;

export const SLA_TARGET_SECONDS: Record<TicketPriority, number> = {
  P1: 4 * 3600,
  P2: 8 * 3600,
  P3: 24 * 3600,
  P4: 72 * 3600,
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  AI_TRIAGED: 'AI Triaged',
  ACTIVE_SWARM: 'Active Swarm',
  WAITING_ON_CUSTOMER: 'Waiting on Customer',
  WAITING_ON_VENDOR: 'Waiting on Vendor',
  RESOLVED_KB_LINKED: 'Resolved · KB Linked',
};

export class RuleViolation extends Error {}

export function assertTransition(ticket: Ticket, to: TicketStatus, kbId?: string): void {
  if (!TICKET_STATUSES.includes(to)) throw new RuleViolation(`Unknown status ${String(to)}`);
  if (ticket.status === to) throw new RuleViolation(`${ticket.id} is already ${STATUS_LABEL[to]}`);
  if (!ALLOWED_TRANSITIONS[ticket.status].includes(to)) {
    throw new RuleViolation(`${STATUS_LABEL[ticket.status]} → ${STATUS_LABEL[to]} is not an allowed transition`);
  }
  if (to === 'RESOLVED_KB_LINKED' && !kbId) {
    throw new RuleViolation('Resolving requires linking or creating a Knowledge Base article');
  }
}

export interface HandoffInput {
  toSquad: SwarmSquad;
  toAgent?: string;
  handoffReason: string;
  diagnosticsAttempted: string;
  recommendedNextStep: string;
}

export const HANDOFF_MIN = { handoffReason: 15, diagnosticsAttempted: 15, recommendedNextStep: 10 } as const;

// §3.2 — No silent handoffs. Returns field errors; empty object means valid.
export function validateHandoff(ticket: Ticket, input: HandoffInput): Partial<Record<keyof HandoffInput, string>> {
  const errors: Partial<Record<keyof HandoffInput, string>> = {};
  (Object.keys(HANDOFF_MIN) as (keyof typeof HANDOFF_MIN)[]).forEach((field) => {
    const len = input[field].trim().length;
    if (len < HANDOFF_MIN[field]) errors[field] = `At least ${HANDOFF_MIN[field]} characters (${len} so far)`;
  });
  if (input.toSquad === ticket.swarmSquad && !input.toAgent) {
    errors.toSquad = 'Pick a different squad, or name the agent you are handing to';
  }
  if (ticket.status === 'RESOLVED_KB_LINKED') errors.toSquad = 'Reopen the ticket before handing it off';
  return errors;
}

export function nextTicketId(type: Ticket['type'], existing: readonly Ticket[]): string {
  const prefixes = { INCIDENT: 'INC', SERVICE_REQUEST: 'SR', CHANGE: 'CHG', PROJECT: 'PRJ' } as const;
  const bases = { INC: 1049, SR: 2088, CHG: 301, PRJ: 40 } as const;
  const prefix = prefixes[type];
  const nums = existing
    .filter((t) => t.id.startsWith(`${prefix}-`))
    .map((t) => Number.parseInt(t.id.slice(prefix.length + 1), 10))
    .filter(Number.isFinite);
  return `${prefix}-${Math.max(bases[prefix], ...nums) + 1}`;
}
