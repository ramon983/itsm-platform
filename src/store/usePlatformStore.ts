'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  AGENTS,
  CURRENT_AGENT,
  INITIAL_FLAGS,
  INITIAL_PROFILE,
  METRICS_BASELINE,
  createSeedState,
  type SeedState,
} from '@/data/seed';
import {
  RuleViolation,
  SLA_PAUSING,
  SLA_TARGET_SECONDS,
  STATUS_LABEL,
  assertTransition,
  nextTicketId,
  validateHandoff,
  type HandoffInput,
} from '@/lib/rules';
import { liveSlaSeconds } from '@/lib/sla';
import type {
  AgentProfile,
  FeatureFlags,
  InspectorTarget,
  KbArticle,
  ModuleKey,
  SwarmSquad,
  TelemetryEvent,
  Ticket,
  TicketMessage,
  TicketStatus,
  Toast,
} from '@/types/platform';

export type ViewKey = 'dashboard';
export type PaletteScope = 'all' | 'tickets' | 'assets' | 'saas' | 'vault' | 'macros';
export interface BoardFilter {
  status: TicketStatus | 'ALL' | 'WAITING';
  priority: 'ALL' | 'P1';
  query: string;
}
export type ActionResult = { ok: true } | { ok: false; error: string };

interface UiState {
  activeView: ViewKey;
  inspector: InspectorTarget;
  palette: { open: boolean; scope: PaletteScope };
  sidebarCollapsed: boolean;
  toasts: Toast[];
  jitModal: { open: boolean; vaultId?: string; ticketId?: string };
  boardFilter: BoardFilter;
}

export interface PlatformState extends SeedState, UiState {
  flags: FeatureFlags;
  profile: AgentProfile;
  baseline: typeof METRICS_BASELINE;
  reclaimedMonthlySavings: number;

  // ui
  setView: (view: ViewKey) => void;
  openInspector: (target: Exclude<InspectorTarget, null>) => void;
  closeInspector: () => void;
  openPalette: (scope?: PaletteScope) => void;
  closePalette: () => void;
  toggleSidebar: () => void;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  openJitModal: (opts?: { vaultId?: string; ticketId?: string }) => void;
  closeJitModal: () => void;
  setBoardFilter: (patch: Partial<BoardFilter>) => void;

  // domain
  transitionTicket: (ticketId: string, to: TicketStatus, opts?: { kbId?: string; note?: string }) => ActionResult;
  handoffTicket: (ticketId: string, input: HandoffInput) => ActionResult;
  joinSwarm: (ticketId: string) => ActionResult;
  executeMacro: (ticketId: string) => ActionResult;
  createKbArticle: (input: Omit<KbArticle, 'id'>) => KbArticle;
  reclaimIdleSeats: (appId: string) => ActionResult;
  grantJitAccess: (vaultId: string, ticketId: string, agentName: string) => ActionResult;
  revokeJitAccess: (vaultId: string) => ActionResult;
  simulateSentinelAlert: () => string;
  toggleFlag: (key: ModuleKey) => ActionResult;
  awardXp: (amount: number, reason: string) => void;
  resetDemo: () => void;
}

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const nowIso = () => new Date().toISOString();

function rotatingToken(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return raw.match(/.{1,6}/g)!.join('-');
}

export const MODULE_LABEL: Record<ModuleKey, string> = {
  itsm_core: 'ITSM Core',
  ai_agents: 'Dual AI Agents',
  torii_saas: 'Torii SaaS',
  itam_cmdb: 'ITAM / CMDB',
  password_vault: 'Password Vault',
};

const initialUi = (): UiState => ({
  activeView: 'dashboard',
  inspector: null,
  palette: { open: false, scope: 'all' },
  sidebarCollapsed: false,
  toasts: [],
  jitModal: { open: false },
  boardFilter: { status: 'ALL', priority: 'ALL', query: '' },
});

const initialData = () => ({
  ...createSeedState(),
  flags: { ...INITIAL_FLAGS },
  profile: { ...INITIAL_PROFILE },
  baseline: { ...METRICS_BASELINE },
  reclaimedMonthlySavings: 0,
});

export const usePlatformStore = create<PlatformState>()(
  persist(
    (set, get) => {
      const fail = (error: string): ActionResult => {
        get().pushToast({ tone: 'error', title: 'Blocked', detail: error });
        return { ok: false, error };
      };

      const updateTicket = (ticketId: string, fn: (t: Ticket) => Ticket) =>
        set((s) => ({ tickets: s.tickets.map((t) => (t.id === ticketId ? fn(t) : t)) }));

      const appendMessage = (ticketId: string, message: Omit<TicketMessage, 'id' | 'timestamp'>) =>
        updateTicket(ticketId, (t) => ({
          ...t,
          messages: [...t.messages, { ...message, id: uid('msg'), timestamp: nowIso() }],
        }));

      const addTelemetry = (event: Omit<TelemetryEvent, 'id' | 'timestamp'>) =>
        set((s) => ({ telemetry: [{ ...event, id: uid('evt'), timestamp: nowIso() }, ...s.telemetry].slice(0, 60) }));

      return {
        ...initialData(),
        ...initialUi(),

        // ------------------------------------------------------------ ui
        setView: (activeView) => set({ activeView }),
        openInspector: (inspector) => set({ inspector, palette: { ...get().palette, open: false } }),
        closeInspector: () => set({ inspector: null }),
        openPalette: (scope = 'all') => set({ palette: { open: true, scope } }),
        closePalette: () => set((s) => ({ palette: { ...s.palette, open: false } })),
        toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
        pushToast: (toast) => {
          const id = uid('toast');
          set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-4) }));
          setTimeout(() => get().dismissToast(id), 4200);
        },
        dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
        openJitModal: (opts = {}) => set({ jitModal: { open: true, ...opts }, palette: { ...get().palette, open: false } }),
        closeJitModal: () => set({ jitModal: { open: false } }),
        setBoardFilter: (patch) => set((s) => ({ boardFilter: { ...s.boardFilter, ...patch } })),

        // ------------------------------------------------------------ tickets
        transitionTicket: (ticketId, to, opts = {}) => {
          const ticket = get().tickets.find((t) => t.id === ticketId);
          if (!ticket) return fail(`Ticket ${ticketId} not found`);
          try {
            assertTransition(ticket, to, opts.kbId);
          } catch (e) {
            if (e instanceof RuleViolation) return fail(e.message);
            throw e;
          }
          if (opts.kbId && !get().kbArticles.some((k) => k.id === opts.kbId)) {
            return fail(`${opts.kbId} is not a published Knowledge Base article`);
          }
          const now = Date.now();
          const live = liveSlaSeconds(ticket, get().slaAnchors[ticketId], now);
          const pausing = SLA_PAUSING.has(to);
          const reopening = ticket.status === 'RESOLVED_KB_LINKED';
          updateTicket(ticketId, (t) => ({
            ...t,
            status: to,
            slaPaused: pausing,
            slaRemainingSeconds: reopening ? SLA_TARGET_SECONDS[t.priority] : live,
            linkedKbId: to === 'RESOLVED_KB_LINKED' ? opts.kbId : t.linkedKbId,
          }));
          set((s) => ({ slaAnchors: { ...s.slaAnchors, [ticketId]: now } }));
          const slaNote = pausing ? ' SLA timer paused.' : SLA_PAUSING.has(ticket.status) ? ' SLA timer resumed.' : '';
          appendMessage(ticketId, {
            sender: CURRENT_AGENT,
            role: 'ai_system',
            originalLang: 'en',
            originalText: `Status ${STATUS_LABEL[ticket.status]} → ${STATUS_LABEL[to]}.${slaNote}${
              opts.kbId ? ` Resolution linked to ${opts.kbId}.` : ''
            }${opts.note ? ` Note: ${opts.note}` : ''}`,
            metadata: { event: 'status_change', from: ticket.status, to },
          });
          if (to === 'RESOLVED_KB_LINKED') get().awardXp(25, `Resolved ${ticketId} with ${opts.kbId}`);
          get().pushToast({ tone: 'success', title: `${ticketId} → ${STATUS_LABEL[to]}`, detail: slaNote.trim() || undefined });
          return { ok: true };
        },

        handoffTicket: (ticketId, input) => {
          const ticket = get().tickets.find((t) => t.id === ticketId);
          if (!ticket) return fail(`Ticket ${ticketId} not found`);
          const errors = validateHandoff(ticket, input);
          if (Object.keys(errors).length) return fail(Object.values(errors)[0]!);
          const now = Date.now();
          const live = liveSlaSeconds(ticket, get().slaAnchors[ticketId], now);
          const squadAgents = AGENTS.filter((a) => a.squad === input.toSquad).map((a) => a.name);
          const nextAgents = input.toAgent
            ? [input.toAgent, ...ticket.activeSwarmAgents.filter((a) => a !== input.toAgent)]
            : Array.from(new Set([...squadAgents.slice(0, 1), ...ticket.activeSwarmAgents]));
          updateTicket(ticketId, (t) => ({
            ...t,
            swarmSquad: input.toSquad,
            activeSwarmAgents: nextAgents.slice(0, 4),
            // Automatic status update: the receiving squad actively owns the work.
            status: 'ACTIVE_SWARM',
            slaPaused: false,
            slaRemainingSeconds: live,
          }));
          set((s) => ({ slaAnchors: { ...s.slaAnchors, [ticketId]: now } }));
          appendMessage(ticketId, {
            sender: CURRENT_AGENT,
            role: 'handoff_audit',
            originalLang: 'en',
            originalText: `Handoff ${ticket.swarmSquad} → ${input.toSquad}${input.toAgent ? ` (${input.toAgent})` : ''}`,
            metadata: {
              fromSquad: ticket.swarmSquad,
              toSquad: input.toSquad,
              toAgent: input.toAgent ?? '',
              handoffReason: input.handoffReason.trim(),
              diagnosticsAttempted: input.diagnosticsAttempted.trim(),
              recommendedNextStep: input.recommendedNextStep.trim(),
              previousStatus: ticket.status,
            },
          });
          addTelemetry({
            source: 'AdminZero', severity: 'info', title: `Handoff ${ticketId}`,
            detail: `${ticket.swarmSquad} → ${input.toSquad}. Requester notified.`, ticketId,
          });
          get().pushToast({ tone: 'success', title: `Handed off to ${input.toSquad}`, detail: 'Audit card added · requester notified' });
          return { ok: true };
        },

        joinSwarm: (ticketId) => {
          const ticket = get().tickets.find((t) => t.id === ticketId);
          if (!ticket) return fail(`Ticket ${ticketId} not found`);
          if (ticket.activeSwarmAgents.includes(CURRENT_AGENT)) return fail('You are already in this swarm');
          updateTicket(ticketId, (t) => ({ ...t, activeSwarmAgents: [...t.activeSwarmAgents, CURRENT_AGENT] }));
          appendMessage(ticketId, {
            sender: CURRENT_AGENT, role: 'agent', originalLang: 'en',
            originalText: `${CURRENT_AGENT} joined the swarm.`, metadata: { visibility: 'internal' },
          });
          get().pushToast({ tone: 'success', title: `Joined ${ticketId} swarm` });
          return { ok: true };
        },

        executeMacro: (ticketId) => {
          const ticket = get().tickets.find((t) => t.id === ticketId);
          if (!ticket?.recommendedMacro) return fail('No remediation macro is attached to this ticket');
          if (ticket.status === 'RESOLVED_KB_LINKED') return fail('Ticket is already resolved');
          const macro = ticket.recommendedMacro;
          appendMessage(ticketId, {
            sender: 'Macro Runner',
            role: 'diagnostic_telemetry',
            originalLang: 'en',
            originalText: `✓ ${macro.label} — exit 0. Approved by ${CURRENT_AGENT}.`,
            metadata: { command: macro.command, macroId: macro.id, exitCode: '0', approvedBy: CURRENT_AGENT },
          });
          addTelemetry({
            source: 'AdminZero', severity: 'info', title: `Macro executed on ${ticketId}`,
            detail: macro.label, ticketId, assetId: ticket.linkedAssetId,
          });
          get().awardXp(50, `Executed ${macro.label}`);
          get().pushToast({ tone: 'success', title: 'Macro executed', detail: `${macro.label} · +50 Empathy XP` });
          return { ok: true };
        },

        createKbArticle: (input) => {
          const max = Math.max(...get().kbArticles.map((k) => Number.parseInt(k.id.slice(3), 10)));
          const article: KbArticle = { ...input, id: `KB-${max + 1}` };
          set((s) => ({ kbArticles: [...s.kbArticles, article] }));
          get().pushToast({ tone: 'success', title: `Published ${article.id}`, detail: article.title });
          return article;
        },

        // ------------------------------------------------------------ SaaS
        reclaimIdleSeats: (appId) => {
          const app = get().saasApps.find((a) => a.id === appId);
          if (!app) return fail(`SaaS app ${appId} not found`);
          const count = app.inactiveUsers.length;
          if (!count) return fail(`${app.name} has no idle seats to reclaim`);
          const monthly = count * app.costPerSeatMonthly;
          set((s) => ({
            saasApps: s.saasApps.map((a) =>
              a.id === appId
                ? {
                    ...a,
                    provisionedSeats: a.provisionedSeats - count,
                    inactiveUsers: [],
                    annualSpend: Math.round((a.provisionedSeats - count) * a.costPerSeatMonthly * 12),
                  }
                : a,
            ),
            reclaimedMonthlySavings: s.reclaimedMonthlySavings + monthly,
          }));
          addTelemetry({
            source: 'Torii', severity: 'info', title: `Reclaimed ${count} ${app.name} seats`,
            detail: `Users idle >45 days removed via SCIM · saving $${monthly.toLocaleString()}/mo`,
          });
          get().pushToast({ tone: 'success', title: `Reclaimed ${count} seats`, detail: `${app.name} · $${monthly.toLocaleString()}/mo saved` });
          return { ok: true };
        },

        // ------------------------------------------------------------ vault
        grantJitAccess: (vaultId, ticketId, agentName) => {
          const item = get().vault.find((v) => v.id === vaultId);
          if (!item) return fail(`Vault item ${vaultId} not found`);
          const ticket = get().tickets.find((t) => t.id === ticketId.trim().toUpperCase());
          if (!ticket) return fail(`Ticket ${ticketId} does not exist — JIT access must be tied to a real ticket`);
          if (ticket.status === 'RESOLVED_KB_LINKED') return fail(`${ticket.id} is resolved; JIT access needs an open ticket`);
          if (!item.allowedSquads.includes(ticket.swarmSquad)) {
            return fail(`${item.name} is restricted to ${item.allowedSquads.join(' / ')} tickets`);
          }
          if (item.activeGrant && Date.parse(item.activeGrant.expiresAt) > Date.now()) {
            return fail(`${item.name} already has an active grant for ${item.activeGrant.ticketId}`);
          }
          const grantedAt = new Date();
          const grant = {
            ticketId: ticket.id, agentName, token: rotatingToken(),
            grantedAt: grantedAt.toISOString(), expiresAt: new Date(grantedAt.getTime() + 3600_000).toISOString(),
          };
          set((s) => ({ vault: s.vault.map((v) => (v.id === vaultId ? { ...v, activeGrant: grant } : v)) }));
          appendMessage(ticket.id, {
            sender: 'Password Vault', role: 'diagnostic_telemetry', originalLang: 'en',
            originalText: `JIT elevation granted to ${agentName} for ${item.name} · expires in 60 minutes.`,
            metadata: { vaultId, scope: item.scope, expiresAt: grant.expiresAt },
          });
          addTelemetry({
            source: 'Vault', severity: 'medium', title: `JIT access: ${item.name}`,
            detail: `${agentName} · 1 hour · tied to ${ticket.id}`, ticketId: ticket.id,
          });
          get().pushToast({ tone: 'success', title: 'JIT access granted', detail: `${item.name} · 60 minutes · ${ticket.id}` });
          return { ok: true };
        },

        revokeJitAccess: (vaultId) => {
          const item = get().vault.find((v) => v.id === vaultId);
          if (!item?.activeGrant) return fail('No active grant to revoke');
          const { ticketId } = item.activeGrant;
          set((s) => ({ vault: s.vault.map((v) => (v.id === vaultId ? { ...v, activeGrant: null, lastRotated: nowIso() } : v)) }));
          addTelemetry({ source: 'Vault', severity: 'info', title: `JIT revoked: ${item.name}`, detail: `Credential rotated · ${ticketId}`, ticketId });
          get().pushToast({ tone: 'info', title: 'Access revoked', detail: `${item.name} rotated` });
          return { ok: true };
        },

        // ------------------------------------------------------------ SIEM
        simulateSentinelAlert: () => {
          const s = get();
          const id = nextTicketId('INCIDENT', s.tickets);
          const asset = s.assets.find((a) => a.id === 'MBP-0942');
          const ip = `45.${(Date.now() % 200) + 20}.${(Date.now() % 97) + 3}.${(Date.now() % 250) + 1}`;
          const now = Date.now();
          const ticket: Ticket = {
            id,
            type: 'INCIDENT',
            templateId: '#INC-SEC-01',
            title: `Sentinel: MFA brute-force on ${asset?.id ?? 'MBP-0942'} (${asset?.assignedTo ?? 'unknown user'})`,
            requesterName: 'Microsoft Sentinel',
            requesterEmail: 'soc-alerts@adminzero.io',
            detectedLanguage: 'en',
            channel: 'SIEM Webhook',
            priority: 'P1',
            sentiment: 'Urgent Client Impact',
            status: 'AI_TRIAGED',
            swarmSquad: 'Security & SIEM',
            activeSwarmAgents: ['Riley Park'],
            slaRemainingSeconds: SLA_TARGET_SECONDS.P1,
            slaPaused: false,
            linkedAssetId: 'MBP-0942',
            recommendedMacro: {
              id: 'macro-isolate-endpoint',
              label: 'Isolate MBP-0942 via CrowdStrike & revoke Okta sessions',
              command: 'falconctl contain --host MBP-0942 && okta users sessions revoke maria.gonzalez@adminzero.io',
            },
            messages: [
              {
                id: uid('msg'), sender: 'Microsoft Sentinel', role: 'diagnostic_telemetry', originalLang: 'en', timestamp: nowIso(),
                originalText: `Analytics rule "Okta MFA brute force": 41 failed MFA challenges in 4 minutes from ${ip} against maria.gonzalez@adminzero.io.`,
                metadata: { source: 'Microsoft Sentinel', severity: 'High', asset: 'MBP-0942', sourceIp: ip },
              },
              {
                id: uid('msg'), sender: 'AdminZero AI', role: 'ai_system', originalLang: 'en', timestamp: nowIso(),
                originalText: `Correlated alert with CMDB asset MBP-0942 (${asset?.assignedTo ?? 'unassigned'}, FileVault ${asset?.fileVault ?? 'unknown'}). Linked open ticket INC-1049 on same asset. Spawned P1 for Security & SIEM swarm. Runbook KB-430.`,
                metadata: { relatedTicket: 'INC-1049', runbook: 'KB-430' },
              },
            ],
          };
          set((st) => ({
            tickets: [ticket, ...st.tickets],
            slaAnchors: { ...st.slaAnchors, [id]: now },
            assets: st.assets.map((a) => (a.id === 'MBP-0942' ? { ...a, linkedTicketIds: [...a.linkedTicketIds, id] } : a)),
          }));
          addTelemetry({
            source: 'Microsoft Sentinel', severity: 'critical', title: 'MFA brute-force detected',
            detail: `41 failed MFA challenges from ${ip} · auto-created ${id}`, assetId: 'MBP-0942', ticketId: id,
          });
          get().pushToast({ tone: 'error', title: `P1 ${id} created`, detail: 'Sentinel MFA brute-force on MBP-0942' });
          return id;
        },

        // ------------------------------------------------------------ platform
        toggleFlag: (key) => {
          if (key === 'itsm_core') return fail('ITSM Core is the platform foundation and cannot be disabled');
          const enabled = !get().flags[key];
          set((s) => ({ flags: { ...s.flags, [key]: enabled } }));
          if (!enabled && get().inspector?.kind === (key === 'torii_saas' ? 'saas' : key === 'itam_cmdb' ? 'asset' : '')) {
            set({ inspector: null });
          }
          get().pushToast({ tone: 'info', title: `${MODULE_LABEL[key]} ${enabled ? 'enabled' : 'disabled'}` });
          return { ok: true };
        },

        awardXp: (amount) =>
          set((s) => {
            let { level, xp, xpForNextLevel } = s.profile;
            xp += amount;
            while (xp >= xpForNextLevel) {
              level += 1;
              xpForNextLevel += 600;
            }
            return { profile: { ...s.profile, level, xp, xpForNextLevel } };
          }),

        resetDemo: () => {
          set({ ...initialData(), ...initialUi() });
          get().pushToast({ tone: 'info', title: 'Demo state reset', detail: 'All tickets, assets and SaaS data re-seeded' });
        },
      };
    },
    {
      name: 'adminzero-platform',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        tickets: s.tickets,
        slaAnchors: s.slaAnchors,
        assets: s.assets,
        saasApps: s.saasApps,
        vault: s.vault,
        telemetry: s.telemetry,
        kbArticles: s.kbArticles,
        flags: s.flags,
        profile: s.profile,
        baseline: s.baseline,
        reclaimedMonthlySavings: s.reclaimedMonthlySavings,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
);

export const agentsForSquad = (squad: SwarmSquad) => AGENTS.filter((a) => a.squad === squad);
export const agentByName = (name: string) => AGENTS.find((a) => a.name === name);
