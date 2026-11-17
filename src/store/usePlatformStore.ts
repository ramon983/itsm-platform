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
  SWARM_SQUADS,
  assertTransition,
  nextTicketId,
  validateHandoff,
  type HandoffInput,
} from '@/lib/rules';
import { liveSlaSeconds } from '@/lib/sla';
import { ruleMatches, describeAction } from '@/lib/automation';
import { scoreChange } from '@/lib/changes';
import type { SiemApiResponse } from '@/lib/api';
import { INTAKE_AGENT_NAME, LANGUAGE_NAMES } from '@/lib/intake';
import { findDeflectionArticle } from '@/lib/patterns';
import type {
  Density,
  OrgProfile,
  SpotlightEntry,
  TimeOff,
  Wish,
  AiSettings,
  AuditEntry,
  AutomationRule,
  AutomationTrigger,
  CustomField,
  IntegrationKey,
  PlatformUser,
  Problem,
  ProblemStatus,
  SlaPolicy,
  TicketPriority,
  AgentProfile,
  EndUserProfile,
  FeatureFlags,
  IntakeAnalysis,
  IntakeChatMessage,
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

export type ViewKey = 'dashboard' | 'reports' | 'tickets' | 'problems' | 'changes' | 'knowledge' | 'portal' | 'saas' | 'assets' | 'vault' | 'admin';
export type PaletteScope = 'all' | 'tickets' | 'assets' | 'saas' | 'vault' | 'macros';
export interface BoardFilter {
  status: TicketStatus | 'ALL' | 'WAITING';
  priority: 'ALL' | 'P1';
  query: string;
}
export type ThemePreference = 'system' | 'light' | 'dark' | 'contrast';
export type ActionResult = { ok: true } | { ok: false; error: string };

interface UiState {
  activeView: ViewKey;
  selectedTicketId: string | null;
  openTicketTabs: string[];
  inspector: InspectorTarget;
  palette: { open: boolean; scope: PaletteScope };
  sidebarCollapsed: boolean;
  themePreference: ThemePreference;
  toasts: Toast[];
  jitModal: { open: boolean; vaultId?: string; ticketId?: string };
  boardFilter: BoardFilter;
}

export interface PlatformState extends SeedState, UiState {
  flags: FeatureFlags;
  orgProfile: OrgProfile;
  squads: SwarmSquad[];
  density: Density;
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
  setThemePreference: (pref: ThemePreference) => void;
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
  ingestSiemAlert: (alert: SiemApiResponse, via: 'live' | 'simulated') => string | null;
  createTicketFromIntake: (input: { requester: EndUserProfile; analysis: IntakeAnalysis; conversation: IntakeChatMessage[] }) => string;
  toggleFlag: (key: ModuleKey) => ActionResult;
  awardXp: (amount: number, reason: string) => void;
  resetDemo: () => void;

  // tickets workspace
  selectTicket: (ticketId: string | null) => void;
  closeTicketTab: (ticketId: string) => void;
  addReply: (ticketId: string, reply: { text: string; translatedText?: string; lang: string; internal: boolean }) => ActionResult;
  linkJiraIssue: (ticketId: string, key: string) => ActionResult;

  // problems
  createProblem: (input: { title: string; description: string; priority: TicketPriority; swarmSquad: SwarmSquad; linkedTicketIds: string[]; linkedClosedTicketIds: string[]; workaround?: string }) => string;
  updateProblem: (id: string, patch: Partial<Pick<Problem, 'rootCause' | 'workaround' | 'linkedJiraIssue'>>) => ActionResult;
  transitionProblem: (id: string, to: ProblemStatus) => ActionResult;
  linkTicketToProblem: (problemId: string, ticketId: string) => ActionResult;
  addProblemNote: (id: string, text: string) => ActionResult;
  publishKnownError: (problemId: string) => ActionResult;

  // changes
  createChange: (input: {
    title: string; description: string; swarmSquad: SwarmSquad; impact: number; affectedAssetIds: string[]; testedInStaging: boolean;
    outsideMaintenanceWindow: boolean; touchesSecurityControls: boolean; windowStart: string; windowEnd: string;
    implementationPlan: string; rollbackPlan: string | null; jiraRelease?: string;
  }) => string;
  decideCab: (ticketId: string, approve: boolean, reason?: string) => ActionResult;

  // knowledge
  publishArticle: (input: Omit<KbArticle, 'id'> & { selfService: boolean; sourcePattern?: string; status?: 'published' | 'draft' }) => KbArticle;
  updateArticle: (id: string, patch: Partial<Pick<KbArticle, 'title' | 'summary' | 'steps' | 'keywords'>>) => ActionResult;
  setSelfService: (kbId: string, enabled: boolean) => ActionResult;
  recordDeflection: (kbId: string, requesterName: string) => void;
  recordKbView: (kbId: string) => void;

  // admin
  addUser: (user: PlatformUser) => ActionResult;
  updateUser: (email: string, patch: Partial<Pick<PlatformUser, 'role' | 'squad' | 'active' | 'country'>>) => ActionResult;
  updateSlaPolicy: (priority: TicketPriority, patch: Partial<Omit<SlaPolicy, 'priority'>>) => ActionResult;
  saveAutomation: (rule: AutomationRule) => ActionResult;
  toggleAutomation: (id: string) => ActionResult;
  deleteAutomation: (id: string) => ActionResult;
  addCustomField: (field: Omit<CustomField, 'id' | 'usage30d'>) => ActionResult;
  updateCustomField: (id: string, patch: Partial<Pick<CustomField, 'required' | 'label'>>) => ActionResult;
  removeCustomField: (id: string) => ActionResult;
  toggleIntegration: (key: IntegrationKey) => ActionResult;
  updateAiSettings: (patch: Partial<Omit<AiSettings, 'humanApprovalForMacros'>>) => ActionResult;

  // organisation
  setOrgProfile: (profile: OrgProfile) => ActionResult;
  addSquad: (name: string) => ActionResult;
  renameSquad: (from: string, to: string) => ActionResult;
  removeSquad: (name: string, moveTo: string) => ActionResult;
  setDensity: (density: Density) => void;

  // home
  setSelectedTools: (ids: string[]) => void;
  addTimeOff: (entry: Omit<TimeOff, 'id' | 'source'>) => ActionResult;
  removeTimeOff: (id: string) => ActionResult;
  importTimeOff: (entries: Omit<TimeOff, 'id'>[]) => number;
  sendWish: (person: string, occasion: Wish['occasion'], year: number) => ActionResult;
  addSpotlight: (entry: Omit<SpotlightEntry, 'id' | 'kudos' | 'addedBy'>) => ActionResult;
  giveKudos: (id: string) => void;
  removeSpotlight: (id: string) => ActionResult;
}

export const MAX_CUSTOM_FIELDS = 12;
export const PROBLEM_TRANSITIONS: Record<ProblemStatus, ProblemStatus[]> = {
  INVESTIGATING: ['WAITING_ON_VENDOR', 'KNOWN_ERROR', 'RESOLVED'],
  WAITING_ON_VENDOR: ['INVESTIGATING', 'KNOWN_ERROR'],
  KNOWN_ERROR: ['RESOLVED', 'INVESTIGATING'],
  RESOLVED: ['INVESTIGATING'],
};

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
  selectedTicketId: null,
  openTicketTabs: [],
  inspector: null,
  palette: { open: false, scope: 'all' },
  sidebarCollapsed: false,
  themePreference: 'system',
  toasts: [],
  jitModal: { open: false },
  boardFilter: { status: 'ALL', priority: 'ALL', query: '' },
});

const initialData = () => ({
  ...createSeedState(),
  orgProfile: 'team' as OrgProfile,
  squads: [...SWARM_SQUADS],
  density: 'comfortable' as Density,
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

      // Immutable, append-only audit trail (ServiceNow-grade compliance, available on every plan).
      const audit = (category: AuditEntry['category'], action: string, entity: string, detail: string, actor = CURRENT_AGENT) =>
        set((s) => ({ auditLog: [{ id: uid('aud'), timestamp: nowIso(), actor, action, entity, detail, category }, ...s.auditLog].slice(0, 500) }));

      const slaTarget = (p: TicketPriority) => (get().slaPolicies.find((x) => x.priority === p)?.resolutionMinutes ?? SLA_TARGET_SECONDS[p] / 60) * 60;

      const currentUser = () => get().users.find((u) => u.name === CURRENT_AGENT);
      /** Map a squad name (from a template, SIEM rule, or seed) onto this org's configured squads. */
      const resolveSquad = (wanted: SwarmSquad) =>
        get().squads.includes(wanted) ? wanted : (get().squads.find((q) => /security|siem|soc/i.test(q) && /security|siem/i.test(wanted)) ?? get().squads[0]!);
      const leadFor = (squad: SwarmSquad) => get().users.find((u) => u.active && u.squad === squad)?.name ?? CURRENT_AGENT;

      // Automations add context (notes, people, notifications) — they never change status or ownership silently.
      const runAutomations = (trigger: AutomationTrigger, ticketId: string) => {
        const ticket = get().tickets.find((t) => t.id === ticketId);
        if (!ticket) return;
        for (const rule of get().automations.filter((r) => ruleMatches(r, trigger, ticket))) {
          const effects = rule.actions.map((a) => describeAction(a.type, a.value));
          for (const a of rule.actions) {
            if (a.type === 'add_swarm_agent' && !get().tickets.find((t) => t.id === ticketId)!.activeSwarmAgents.includes(a.value)) {
              updateTicket(ticketId, (t) => ({ ...t, activeSwarmAgents: [...t.activeSwarmAgents, a.value] }));
            }
          }
          appendMessage(ticketId, {
            sender: `Automation · ${rule.name}`, role: 'ai_system', originalLang: 'en',
            originalText: effects.join(' · '), metadata: { automation: rule.id },
          });
          set((s) => ({ automations: s.automations.map((r) => (r.id === rule.id ? { ...r, runs: r.runs + 1, lastRunAt: nowIso() } : r)) }));
          audit('automation', 'Automation ran', ticketId, `${rule.name}: ${effects.join('; ')}`, 'Automation engine');
        }
      };

      return {
        ...initialData(),
        ...initialUi(),

        // ------------------------------------------------------------ ui
        setView: (activeView) => set({ activeView, inspector: null }),
        // ServiceNow-style record tabs: every ticket you open stays one click away (up to 6).
        selectTicket: (selectedTicketId) =>
          set((s) => ({
            selectedTicketId,
            openTicketTabs: !selectedTicketId || s.openTicketTabs.includes(selectedTicketId) ? s.openTicketTabs : [...s.openTicketTabs, selectedTicketId].slice(-6),
          })),
        closeTicketTab: (ticketId) =>
          set((s) => {
            const tabs = s.openTicketTabs.filter((t) => t !== ticketId);
            return { openTicketTabs: tabs, selectedTicketId: s.selectedTicketId === ticketId ? (tabs.at(-1) ?? null) : s.selectedTicketId };
          }),
        openInspector: (inspector) => set({ inspector, palette: { ...get().palette, open: false } }),
        closeInspector: () => set({ inspector: null }),
        openPalette: (scope = 'all') => set({ palette: { open: true, scope } }),
        closePalette: () => set((s) => ({ palette: { ...s.palette, open: false } })),
        toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
        setThemePreference: (themePreference) => set({ themePreference }),
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
            slaRemainingSeconds: reopening ? slaTarget(t.priority) : live,
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
          audit('ticket', 'Status changed', ticketId, `${STATUS_LABEL[ticket.status]} → ${STATUS_LABEL[to]}${opts.kbId ? ` (KB ${opts.kbId})` : ''}`);
          runAutomations('status_changed', ticketId);
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
          const squadAgents = get().users.filter((u) => u.active && u.squad === input.toSquad).map((u) => u.name);
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
          audit('ticket', 'Handoff', ticketId, `${ticket.swarmSquad} → ${input.toSquad}: ${input.handoffReason.trim()}`);
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
          audit('ticket', 'Joined swarm', ticketId, CURRENT_AGENT);
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
          audit('ai', 'Macro approved & executed', ticketId, `${macro.label} — ${macro.command}`);
          get().pushToast({ tone: 'success', title: 'Macro executed', detail: `${macro.label} · +50 Empathy XP` });
          return { ok: true };
        },

        createKbArticle: (input) => {
          const max = Math.max(...get().kbArticles.map((k) => Number.parseInt(k.id.slice(3), 10)));
          const article: KbArticle = { ...input, id: `KB-${max + 1}` };
          set((s) => ({
            kbArticles: [...s.kbArticles, article],
            kbStats: { ...s.kbStats, [article.id]: { views: 0, deflections: 0, helpful: 0, selfServiceEnabled: false, status: 'published', version: 1, updatedAt: nowIso(), author: CURRENT_AGENT } },
          }));
          audit('knowledge', 'Article published', article.id, article.title);
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
          audit('saas', 'Idle seats reclaimed', app.name, `${count} seats · $${monthly.toLocaleString()}/mo`);
          get().pushToast({ tone: 'success', title: `Reclaimed ${count} seats`, detail: `${app.name} · $${monthly.toLocaleString()}/mo saved` });
          return { ok: true };
        },

        // ------------------------------------------------------------ vault
        grantJitAccess: (vaultId, ticketId, agentName) => {
          const fail = (error: string): ActionResult => {
            audit('vault', 'JIT access denied', vaultId, `${agentName} · ${ticketId || 'no ticket'} · ${error}`);
            get().pushToast({ tone: 'error', title: 'Blocked', detail: error });
            return { ok: false, error };
          };
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
          audit('vault', 'JIT access granted', item.name, `${agentName} · 1 hour · ${ticket.id}`);
          get().pushToast({ tone: 'success', title: 'JIT access granted', detail: `${item.name} · 60 minutes · ${ticket.id}` });
          return { ok: true };
        },

        revokeJitAccess: (vaultId) => {
          const item = get().vault.find((v) => v.id === vaultId);
          if (!item?.activeGrant) return fail('No active grant to revoke');
          const { ticketId } = item.activeGrant;
          set((s) => ({ vault: s.vault.map((v) => (v.id === vaultId ? { ...v, activeGrant: null, lastRotated: nowIso() } : v)) }));
          addTelemetry({ source: 'Vault', severity: 'info', title: `JIT revoked: ${item.name}`, detail: `Credential rotated · ${ticketId}`, ticketId });
          audit('vault', 'JIT access revoked', item.name, `Credential rotated · ${ticketId}`);
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
            swarmSquad: resolveSquad('Security & SIEM'),
            activeSwarmAgents: [leadFor(resolveSquad('Security & SIEM'))],
            slaRemainingSeconds: slaTarget('P1'),
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
          audit('ticket', 'SIEM incident created', id, `Sentinel MFA brute-force on MBP-0942 (${ip})`, 'Microsoft Sentinel');
          get().pushToast({ tone: 'error', title: `P1 ${id} created`, detail: 'Sentinel MFA brute-force on MBP-0942' });
          runAutomations('siem_alert', id);
          runAutomations('ticket_created', id);
          return id;
        },

        // ------------------------------------------------------------ end-user intake
        createTicketFromIntake: ({ requester, analysis: a, conversation }) => {
          const st = get();
          const id = nextTicketId(a.ticketType, st.tickets);
          const now = Date.now();
          const squad = st.squads.includes(a.swarmSquad) ? a.swarmSquad : st.squads[0]!; // template squad may not exist in this org
          const squadLead = st.users.find((u) => u.active && u.squad === squad)?.name ?? CURRENT_AGENT;
          const messages: TicketMessage[] = conversation.map((m) =>
            m.from === 'user'
              ? {
                  id: uid('msg'), sender: requester.name, role: 'end_user', originalText: m.text, originalLang: m.lang,
                  translatedText: m.lang !== 'en' ? m.translation : undefined, timestamp: m.timestamp,
                }
              : {
                  id: uid('msg'), sender: INTAKE_AGENT_NAME, role: 'ai_system', originalText: m.text, originalLang: m.lang,
                  translatedText: m.lang !== 'en' ? m.translation : undefined, timestamp: m.timestamp,
                  metadata: { visibility: 'sent_to_requester' },
                },
          );
          messages.push({
            id: uid('msg'), sender: 'AdminZero AI', role: 'ai_system', originalLang: 'en', timestamp: nowIso(),
            originalText: `Mapped to ${a.templateId} (${a.templateName}) at ${Math.round(a.templateConfidence * 100)}% confidence. ${a.priorityReasons.join(' · ')}. ${
              a.linkedAssetId ? `Attached ${a.linkedAssetId} from CMDB. ` : ''
            }Routed to ${a.swarmSquad} swarm. ${a.englishSummary}`,
            metadata: {
              template: a.templateId, confidence: a.templateConfidence.toFixed(2), language: LANGUAGE_NAMES[a.detectedLanguage] ?? a.detectedLanguage,
              ...(a.suggestedKbId ? { suggestedKb: a.suggestedKbId } : {}),
              ...(a.requiredApprovals.length ? { approvals: a.requiredApprovals.join(', ') } : {}),
            },
          });
          const ticket: Ticket = {
            id, type: a.ticketType, templateId: a.templateId, title: a.title, requesterName: requester.name,
            requesterEmail: requester.email, detectedLanguage: a.detectedLanguage, channel: 'Portal', priority: a.priority,
            sentiment: a.sentiment, status: 'AI_TRIAGED', swarmSquad: squad, activeSwarmAgents: [squadLead],
            slaRemainingSeconds: slaTarget(a.priority), slaPaused: false, linkedAssetId: a.linkedAssetId,
            linkedSaasId: a.linkedSaasId, recommendedMacro: a.recommendedMacro, messages,
          };
          set((s2) => ({
            tickets: [ticket, ...s2.tickets],
            slaAnchors: { ...s2.slaAnchors, [id]: now },
            assets: s2.assets.map((as) => (as.id === a.linkedAssetId ? { ...as, linkedTicketIds: [...as.linkedTicketIds, id] } : as)),
          }));
          addTelemetry({
            source: 'AdminZero', severity: a.priority === 'P1' ? 'high' : 'info', title: `Portal intake → ${id}`,
            detail: `${requester.name} (${a.detectedLanguage.toUpperCase()}) · ${a.templateId} · ${a.priority} · ${a.swarmSquad}`,
            ticketId: id, assetId: a.linkedAssetId,
          });
          audit('ai', 'Intake ticket created', id, `${requester.name} · ${a.templateId} · ${a.priority} · ${a.swarmSquad}`, INTAKE_AGENT_NAME);
          get().pushToast({ tone: 'success', title: `${id} routed to ${a.swarmSquad}`, detail: `${a.priority} · ${a.templateId}` });
          runAutomations('ticket_created', id);
          // Optional AI autonomy: close low-risk requests that a self-service article answers with high confidence.
          const ai = get().aiSettings;
          if (ai.autonomy === 'auto_resolve_low_risk' && a.priority === 'P4' && get().flags.ai_agents) {
            const match = findDeflectionArticle(conversation.filter((m) => m.from === 'user').map((m) => m.translation ?? m.text).join(' '), get().kbArticles, get().kbStats, ai.confidenceThreshold);
            if (match) {
              get().transitionTicket(id, 'RESOLVED_KB_LINKED', { kbId: match.article.id, note: `Auto-resolved by AI (low risk, ${Math.round(match.confidence * 100)}% match)` });
              audit('ai', 'Auto-resolved (low risk)', id, `${match.article.id} at ${Math.round(match.confidence * 100)}% confidence`, INTAKE_AGENT_NAME);
            }
          }
          return id;
        },

        // ------------------------------------------------------------ tickets workspace
        addReply: (ticketId, { text, translatedText, lang, internal }) => {
          const ticket = get().tickets.find((t) => t.id === ticketId);
          if (!ticket) return fail(`Ticket ${ticketId} not found`);
          if (!text.trim()) return fail('Write a message first');
          appendMessage(ticketId, {
            sender: CURRENT_AGENT, role: 'agent', originalText: text.trim(), originalLang: lang,
            translatedText: translatedText?.trim() || undefined,
            metadata: internal ? { visibility: 'internal' } : { visibility: 'public', channel: ticket.channel },
          });
          if (!internal && ticket.status === 'AI_TRIAGED') {
            // First human response moves the ticket into active swarming.
            get().transitionTicket(ticketId, 'ACTIVE_SWARM', { note: 'First agent reply' });
          }
          audit('ticket', internal ? 'Internal note' : 'Reply sent', ticketId, text.trim().slice(0, 140));
          if (!internal) get().awardXp(10, 'Replied to requester');
          get().pushToast({ tone: 'success', title: internal ? 'Internal note added' : `Reply sent via ${ticket.channel}` });
          return { ok: true };
        },

        linkJiraIssue: (ticketId, key) => {
          const k = key.trim().toUpperCase();
          if (!/^[A-Z][A-Z0-9]+-\d+$/.test(k)) return fail('Jira keys look like PROJ-123');
          updateTicket(ticketId, (t) => ({ ...t, linkedJiraIssue: k }));
          appendMessage(ticketId, { sender: CURRENT_AGENT, role: 'ai_system', originalLang: 'en', originalText: `Linked Jira issue ${k}.`, metadata: { jira: k } });
          audit('ticket', 'Jira linked', ticketId, k);
          get().pushToast({ tone: 'success', title: `Linked ${k}` });
          return { ok: true };
        },

        // ------------------------------------------------------------ problems
        createProblem: (input) => {
          const max = Math.max(103, ...get().problems.map((p) => Number.parseInt(p.id.slice(4), 10)));
          const id = `PRB-${max + 1}`;
          const problem: Problem = {
            id, title: input.title, description: input.description, status: 'INVESTIGATING', priority: input.priority,
            swarmSquad: input.swarmSquad, activeSwarmAgents: [CURRENT_AGENT], linkedTicketIds: input.linkedTicketIds,
            linkedClosedTicketIds: input.linkedClosedTicketIds, rootCause: null, workaround: input.workaround ?? null,
            createdAt: nowIso(), notes: [],
          };
          set((s) => ({ problems: [problem, ...s.problems] }));
          input.linkedTicketIds.forEach((tid) =>
            appendMessage(tid, { sender: CURRENT_AGENT, role: 'ai_system', originalLang: 'en', originalText: `Linked to problem ${id}: ${input.title}`, metadata: { problem: id } }),
          );
          audit('problem', 'Problem created', id, `${input.title} · ${input.linkedTicketIds.length + input.linkedClosedTicketIds.length} linked tickets`);
          get().pushToast({ tone: 'success', title: `${id} created`, detail: input.title });
          return id;
        },

        updateProblem: (id, patch) => {
          if (!get().problems.some((p) => p.id === id)) return fail(`Problem ${id} not found`);
          set((s) => ({ problems: s.problems.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
          audit('problem', 'Problem updated', id, Object.keys(patch).join(', '));
          get().pushToast({ tone: 'success', title: `${id} updated` });
          return { ok: true };
        },

        transitionProblem: (id, to) => {
          const p = get().problems.find((x) => x.id === id);
          if (!p) return fail(`Problem ${id} not found`);
          if (!PROBLEM_TRANSITIONS[p.status].includes(to)) return fail(`${p.status} → ${to} is not an allowed transition`);
          if ((to === 'KNOWN_ERROR' || to === 'RESOLVED') && !p.rootCause?.trim()) return fail('Record the root cause first');
          if (to === 'KNOWN_ERROR' && !p.workaround?.trim()) return fail('A known error needs a documented workaround');
          set((s) => ({ problems: s.problems.map((x) => (x.id === id ? { ...x, status: to } : x)) }));
          audit('problem', 'Problem status changed', id, `${p.status} → ${to}`);
          get().pushToast({ tone: 'success', title: `${id} → ${to.replaceAll('_', ' ').toLowerCase()}` });
          return { ok: true };
        },

        linkTicketToProblem: (problemId, ticketId) => {
          const p = get().problems.find((x) => x.id === problemId);
          if (!p) return fail(`Problem ${problemId} not found`);
          if (p.linkedTicketIds.includes(ticketId)) return fail(`${ticketId} is already linked`);
          set((s) => ({ problems: s.problems.map((x) => (x.id === problemId ? { ...x, linkedTicketIds: [...x.linkedTicketIds, ticketId] } : x)) }));
          appendMessage(ticketId, { sender: CURRENT_AGENT, role: 'ai_system', originalLang: 'en', originalText: `Linked to problem ${problemId}: ${p.title}`, metadata: { problem: problemId } });
          audit('problem', 'Incident linked', problemId, ticketId);
          get().pushToast({ tone: 'success', title: `${ticketId} linked to ${problemId}` });
          return { ok: true };
        },

        addProblemNote: (id, text) => {
          if (!text.trim()) return fail('Write a note first');
          set((s) => ({ problems: s.problems.map((p) => (p.id === id ? { ...p, notes: [...p.notes, { id: uid('note'), author: CURRENT_AGENT, text: text.trim(), timestamp: nowIso() }] } : p)) }));
          audit('problem', 'Note added', id, text.trim().slice(0, 140));
          return { ok: true };
        },

        publishKnownError: (problemId) => {
          const p = get().problems.find((x) => x.id === problemId);
          if (!p) return fail(`Problem ${problemId} not found`);
          if (!p.workaround?.trim()) return fail('Document the workaround before publishing it');
          if (p.linkedKbId) return fail(`Already published as ${p.linkedKbId}`);
          const article = get().publishArticle({
            title: `Known error: ${p.title}`, summary: p.rootCause ? `Root cause: ${p.rootCause}` : p.description, squad: p.swarmSquad,
            steps: p.workaround.split(/(?<=\.)\s+|;\s*/).map((x) => x.trim()).filter(Boolean), selfService: false, sourcePattern: problemId,
          });
          set((s) => ({ problems: s.problems.map((x) => (x.id === problemId ? { ...x, linkedKbId: article.id } : x)) }));
          return { ok: true };
        },

        // ------------------------------------------------------------ changes
        createChange: (input) => {
          const risk = scoreChange({
            impact: input.impact, affectedCount: input.affectedAssetIds.length, hasRollbackPlan: !!input.rollbackPlan?.trim(),
            testedInStaging: input.testedInStaging, outsideMaintenanceWindow: input.outsideMaintenanceWindow, touchesSecurityControls: input.touchesSecurityControls,
          });
          const id = nextTicketId('CHANGE', get().tickets);
          const priority: TicketPriority = risk.level === 'HIGH' ? 'P2' : risk.level === 'MEDIUM' ? 'P3' : 'P4';
          const ticket: Ticket = {
            id, type: 'CHANGE', templateId: risk.cabRequired ? '#CHG-NOR-01' : '#CHG-STD-01', title: input.title,
            requesterName: CURRENT_AGENT, requesterEmail: currentUser()?.email ?? 'alex.rivera@adminzero.io', detectedLanguage: 'en',
            channel: 'Portal', priority, sentiment: 'Calm', status: 'AI_TRIAGED', swarmSquad: input.swarmSquad, activeSwarmAgents: [CURRENT_AGENT],
            slaRemainingSeconds: slaTarget(priority), slaPaused: false, linkedAssetId: input.affectedAssetIds[0],
            messages: [
              { id: uid('msg'), sender: CURRENT_AGENT, role: 'agent', originalLang: 'en', timestamp: nowIso(), originalText: input.description, metadata: { visibility: 'internal' } },
              { id: uid('msg'), sender: 'AdminZero AI', role: 'ai_system', originalLang: 'en', timestamp: nowIso(),
                originalText: `CAB risk ${risk.score}/100 (${risk.level}). ${risk.cabRequired ? 'CAB approval required.' : 'Standard change — no CAB needed.'} Factors: ${Object.entries(risk.factors).map(([k, v]) => `${k} +${v}`).join(', ')}.` },
            ],
          };
          set((s) => ({
            tickets: [ticket, ...s.tickets],
            slaAnchors: { ...s.slaAnchors, [id]: Date.now() },
            changeDetails: {
              ...s.changeDetails,
              [id]: {
                ticketId: id, riskScore: risk.score, riskLevel: risk.level, riskFactors: risk.factors, cabStatus: risk.cabRequired ? 'PENDING' : 'NOT_REQUIRED',
                windowStart: input.windowStart, windowEnd: input.windowEnd, implementationPlan: input.implementationPlan,
                rollbackPlan: input.rollbackPlan?.trim() || null, affectedAssetIds: input.affectedAssetIds, jiraRelease: input.jiraRelease?.trim() || undefined,
              },
            },
            assets: s.assets.map((a) => (input.affectedAssetIds.includes(a.id) ? { ...a, linkedTicketIds: [...a.linkedTicketIds, id] } : a)),
          }));
          audit('change', 'Change requested', id, `${input.title} · risk ${risk.score} ${risk.level}`);
          get().pushToast({ tone: 'success', title: `${id} created`, detail: `Risk ${risk.score} · ${risk.cabRequired ? 'CAB required' : 'standard change'}` });
          runAutomations('ticket_created', id);
          return id;
        },

        decideCab: (ticketId, approve, reason) => {
          const details = get().changeDetails[ticketId];
          const ticket = get().tickets.find((t) => t.id === ticketId);
          if (!details || !ticket) return fail(`Change ${ticketId} not found`);
          if (details.cabStatus !== 'PENDING') return fail(`CAB decision already recorded (${details.cabStatus})`);
          const me = currentUser();
          if (!me || (me.role !== 'Approver' && me.role !== 'Admin')) return fail('Only Approvers and Admins can record CAB decisions');
          const solo = get().orgProfile === 'solo';
          if (ticket.requesterName === CURRENT_AGENT && !solo) return fail('You cannot approve your own change');
          if (ticket.requesterName === CURRENT_AGENT && solo && (reason?.trim().length ?? 0) < 10) {
            return fail('Solo self-approval needs a reason (10+ characters) for the audit trail');
          }
          set((s) => ({ changeDetails: { ...s.changeDetails, [ticketId]: { ...details, cabStatus: approve ? 'APPROVED' : 'REJECTED', cabDecisionBy: CURRENT_AGENT } } }));
          appendMessage(ticketId, { sender: CURRENT_AGENT, role: 'ai_system', originalLang: 'en', originalText: `CAB ${approve ? 'approved' : 'rejected'} by ${CURRENT_AGENT}.`, metadata: { cab: approve ? 'APPROVED' : 'REJECTED' } });
          audit('change', approve ? (ticket.requesterName === CURRENT_AGENT ? 'Solo self-approved' : 'CAB approved') : 'CAB rejected', ticketId, `Risk ${details.riskScore} ${details.riskLevel}${reason ? ` · reason: ${reason.trim()}` : ''}`);
          get().pushToast({ tone: approve ? 'success' : 'info', title: `${ticketId} ${approve ? 'approved' : 'rejected'} by CAB` });
          return { ok: true };
        },

        // ------------------------------------------------------------ knowledge
        publishArticle: ({ selfService, sourcePattern, status = 'published', ...input }) => {
          const max = Math.max(...get().kbArticles.map((k) => Number.parseInt(k.id.slice(3), 10)));
          const article: KbArticle = { ...input, id: `KB-${max + 1}` };
          set((s) => ({
            kbArticles: [...s.kbArticles, article],
            kbStats: {
              ...s.kbStats,
              [article.id]: { views: 0, deflections: 0, helpful: 0, selfServiceEnabled: selfService, status, version: 1, updatedAt: nowIso(), author: CURRENT_AGENT, sourcePattern },
            },
          }));
          audit('knowledge', status === 'published' ? 'Article published' : 'Draft saved', article.id, `${article.title}${selfService ? ' · self-service ON' : ''}${sourcePattern ? ` · from ${sourcePattern}` : ''}`);
          get().awardXp(40, `Published ${article.id}`);
          get().pushToast({ tone: 'success', title: `${status === 'published' ? 'Published' : 'Saved draft'} ${article.id}`, detail: selfService ? 'The portal AI will now offer this to employees' : article.title });
          return article;
        },

        updateArticle: (id, patch) => {
          const stats = get().kbStats[id];
          if (!stats) return fail(`${id} not found`);
          set((s) => ({
            kbArticles: s.kbArticles.map((k) => (k.id === id ? { ...k, ...patch } : k)),
            kbStats: { ...s.kbStats, [id]: { ...stats, version: stats.version + 1, updatedAt: nowIso(), status: 'published' } },
          }));
          audit('knowledge', 'Article revised', id, `v${stats.version} → v${stats.version + 1}`);
          get().pushToast({ tone: 'success', title: `${id} updated to v${stats.version + 1}` });
          return { ok: true };
        },

        setSelfService: (kbId, enabled) => {
          const stats = get().kbStats[kbId];
          if (!stats) return fail(`${kbId} not found`);
          if (get().aiSettings.autonomy === 'suggest_only' && enabled) return fail('AI autonomy is "Suggest only" — enable self-service deflection in Admin → AI & Grounding');
          set((s) => ({ kbStats: { ...s.kbStats, [kbId]: { ...stats, selfServiceEnabled: enabled } } }));
          audit('knowledge', enabled ? 'Self-service enabled' : 'Self-service disabled', kbId, enabled ? 'Portal AI may answer employees with this article' : 'Agents only');
          get().pushToast({ tone: 'success', title: `${kbId} ${enabled ? 'offered to employees' : 'agent-only'}` });
          return { ok: true };
        },

        recordDeflection: (kbId, requesterName) => {
          const stats = get().kbStats[kbId];
          if (!stats) return;
          set((s) => ({ kbStats: { ...s.kbStats, [kbId]: { ...stats, deflections: stats.deflections + 1, helpful: stats.helpful + 1 } } }));
          addTelemetry({ source: 'AdminZero', severity: 'info', title: `Self-service resolution · ${kbId}`, detail: `${requesterName} solved it without a ticket` });
          audit('ai', 'Deflected by self-service', kbId, `${requesterName} resolved without a human`, INTAKE_AGENT_NAME);
        },

        recordKbView: (kbId) => {
          const stats = get().kbStats[kbId];
          if (stats) set((s) => ({ kbStats: { ...s.kbStats, [kbId]: { ...stats, views: stats.views + 1 } } }));
        },

        // ------------------------------------------------------------ admin
        addUser: (user) => {
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user.email)) return fail('Enter a valid email address');
          if (get().users.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) return fail(`${user.email} already exists`);
          set((s) => ({ users: [...s.users, user] }));
          audit('admin', 'User added', user.email, `${user.name} · ${user.role} · ${user.squad}`);
          get().pushToast({ tone: 'success', title: `${user.name} added`, detail: `${user.role} · ${user.squad}` });
          return { ok: true };
        },

        updateUser: (email, patch) => {
          const user = get().users.find((u) => u.email === email);
          if (!user) return fail(`${email} not found`);
          if (user.name === CURRENT_AGENT && (patch.role && patch.role !== 'Admin' || patch.active === false)) {
            return fail('You cannot remove your own admin access');
          }
          set((s) => ({ users: s.users.map((u) => (u.email === email ? { ...u, ...patch } : u)) }));
          audit('admin', 'User updated', email, Object.entries(patch).map(([k, v]) => `${k}: ${String(v)}`).join(', '));
          get().pushToast({ tone: 'success', title: `${user.name} updated` });
          return { ok: true };
        },

        updateSlaPolicy: (priority, patch) => {
          const values = Object.values(patch);
          if (values.some((v) => typeof v === 'number' && (!Number.isFinite(v) || v <= 0))) return fail('SLA targets must be positive');
          const current = get().slaPolicies.find((p) => p.priority === priority)!;
          const next = { ...current, ...patch };
          if (next.responseMinutes >= next.resolutionMinutes) return fail('Response target must be shorter than the resolution target');
          set((s) => ({ slaPolicies: s.slaPolicies.map((p) => (p.priority === priority ? next : p)) }));
          audit('admin', 'SLA policy changed', priority, `response ${next.responseMinutes}m · resolution ${next.resolutionMinutes}m`);
          get().pushToast({ tone: 'success', title: `${priority} SLA updated`, detail: 'Applies to new tickets' });
          return { ok: true };
        },

        saveAutomation: (rule) => {
          if (!rule.name.trim()) return fail('Give the automation a name');
          if (!rule.actions.length) return fail('Add at least one action');
          if (rule.actions.some((a) => !a.value.trim())) return fail('Every action needs a value');
          const exists = get().automations.some((r) => r.id === rule.id);
          set((s) => ({ automations: exists ? s.automations.map((r) => (r.id === rule.id ? rule : r)) : [...s.automations, rule] }));
          audit('automation', exists ? 'Automation updated' : 'Automation created', rule.id, rule.name);
          get().pushToast({ tone: 'success', title: exists ? 'Automation saved' : 'Automation created', detail: rule.name });
          return { ok: true };
        },

        toggleAutomation: (id) => {
          const rule = get().automations.find((r) => r.id === id);
          if (!rule) return fail('Automation not found');
          set((s) => ({ automations: s.automations.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)) }));
          audit('automation', rule.enabled ? 'Automation disabled' : 'Automation enabled', id, rule.name);
          return { ok: true };
        },

        deleteAutomation: (id) => {
          const rule = get().automations.find((r) => r.id === id);
          if (!rule) return fail('Automation not found');
          set((s) => ({ automations: s.automations.filter((r) => r.id !== id) }));
          audit('automation', 'Automation deleted', id, rule.name);
          get().pushToast({ tone: 'info', title: 'Automation deleted', detail: rule.name });
          return { ok: true };
        },

        addCustomField: (field) => {
          // Guardrail against the "Jira trap": a hard cap on custom fields.
          if (get().customFields.length >= MAX_CUSTOM_FIELDS) return fail(`Limit of ${MAX_CUSTOM_FIELDS} custom fields reached — archive unused fields first`);
          if (!field.label.trim()) return fail('Give the field a label');
          if (!field.appliesTo.length) return fail('Pick at least one ticket type');
          const id = `cf-${field.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          if (get().customFields.some((f) => f.id === id)) return fail('A field with that name already exists');
          set((s) => ({ customFields: [...s.customFields, { ...field, id, usage30d: 0 }] }));
          audit('admin', 'Custom field added', id, `${field.label} (${field.type})${field.required ? ' · required' : ''}`);
          get().pushToast({ tone: 'success', title: `Field “${field.label}” added` });
          return { ok: true };
        },

        updateCustomField: (id, patch) => {
          if (!get().customFields.some((f) => f.id === id)) return fail('Field not found');
          set((s) => ({ customFields: s.customFields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
          audit('admin', 'Custom field updated', id, Object.entries(patch).map(([k, v]) => `${k}: ${String(v)}`).join(', '));
          return { ok: true };
        },

        removeCustomField: (id) => {
          const field = get().customFields.find((f) => f.id === id);
          if (!field) return fail('Field not found');
          set((s) => ({ customFields: s.customFields.filter((f) => f.id !== id) }));
          audit('admin', 'Custom field archived', id, field.label);
          get().pushToast({ tone: 'info', title: `Archived “${field.label}”`, detail: 'Existing values stay in ticket history' });
          return { ok: true };
        },

        toggleIntegration: (key) => {
          const integ = get().integrations.find((i) => i.key === key);
          if (!integ) return fail('Integration not found');
          if (key === 'secret_manager') return fail('Secret Manager connects automatically when the FastAPI backend is deployed with GCP_PROJECT_ID');
          set((s) => ({ integrations: s.integrations.map((i) => (i.key === key ? { ...i, connected: !i.connected } : i)) }));
          audit('admin', integ.connected ? 'Integration disconnected' : 'Integration connected', key, integ.name);
          get().pushToast({ tone: 'info', title: `${integ.name} ${integ.connected ? 'disconnected' : 'connected'}` });
          return { ok: true };
        },

        updateAiSettings: (patch) => {
          if (patch.confidenceThreshold !== undefined && (patch.confidenceThreshold < 0.5 || patch.confidenceThreshold > 0.99)) {
            return fail('Confidence threshold must be between 50% and 99%');
          }
          set((s) => ({ aiSettings: { ...s.aiSettings, ...patch, sources: { ...s.aiSettings.sources, ...patch.sources } } }));
          if (patch.autonomy === 'suggest_only') {
            set((s) => ({ kbStats: Object.fromEntries(Object.entries(s.kbStats).map(([k, v]) => [k, { ...v, selfServiceEnabled: false }])) }));
          }
          audit('admin', 'AI settings changed', 'ai', JSON.stringify(patch));
          get().pushToast({ tone: 'success', title: 'AI settings saved' });
          return { ok: true };
        },

        // ------------------------------------------------------------ SIEM webhook (live API or simulated)
        ingestSiemAlert: (alert, via) => {
          const vendor = { sentinel: 'Microsoft Sentinel', splunk: 'Splunk', datadog: 'Datadog' } as const;
          addTelemetry({
            source: vendor[alert.source], severity: alert.severity === 'critical' ? 'critical' : alert.severity === 'high' ? 'high' : alert.severity === 'medium' ? 'medium' : 'info',
            title: alert.title, detail: `Webhook ${alert.alert_id} (${via}) · ${alert.matched_assets.length ? `matched ${alert.matched_assets.map((a) => a.id).join(', ')}` : 'no CMDB match'}`,
            assetId: alert.matched_assets[0]?.id,
          });
          const inc = alert.incident;
          if (!inc) {
            audit('ticket', 'SIEM alert logged (no incident)', alert.alert_id, `${alert.severity} · ${alert.title}`, vendor[alert.source]);
            return null;
          }
          const id = nextTicketId('INCIDENT', get().tickets);
          const now = Date.now();
          const ticket: Ticket = {
            id, type: 'INCIDENT', templateId: inc.template_id, title: inc.title, requesterName: inc.requester_name, requesterEmail: inc.requester_email,
            detectedLanguage: 'en', channel: 'SIEM Webhook', priority: inc.priority, sentiment: 'Urgent Client Impact', status: 'AI_TRIAGED',
            swarmSquad: resolveSquad(inc.swarm_squad), activeSwarmAgents: [leadFor(resolveSquad(inc.swarm_squad))],
            slaRemainingSeconds: slaTarget(inc.priority), slaPaused: false, linkedAssetId: inc.linked_asset_id ?? undefined,
            recommendedMacro: inc.recommended_macro ?? undefined,
            messages: [
              { id: uid('msg'), sender: vendor[alert.source], role: 'diagnostic_telemetry', originalLang: 'en', timestamp: nowIso(), originalText: inc.summary,
                metadata: { source: vendor[alert.source], severity: alert.severity, alertId: alert.alert_id, via } },
            ],
          };
          set((st) => ({
            tickets: [ticket, ...st.tickets],
            slaAnchors: { ...st.slaAnchors, [id]: now },
            assets: st.assets.map((a) => (a.id === inc.linked_asset_id ? { ...a, linkedTicketIds: [...a.linkedTicketIds, id] } : a)),
          }));
          audit('ticket', 'SIEM incident created', id, `${alert.alert_id} · ${alert.title} (${via})`, vendor[alert.source]);
          get().pushToast({ tone: 'error', title: `${inc.priority} ${id} created`, detail: inc.title });
          runAutomations('siem_alert', id);
          runAutomations('ticket_created', id);
          return id;
        },

        // ------------------------------------------------------------ organisation (Solo ↔ Enterprise)
        setOrgProfile: (profile) => {
          const prev = get().orgProfile;
          if (profile === prev) return { ok: true };
          if (profile === 'solo') {
            // One person does everything: fold every squad into "IT" so nothing is orphaned.
            const into = 'IT';
            const remap = <T extends { swarmSquad: SwarmSquad }>(x: T) => ({ ...x, swarmSquad: into });
            set((s) => ({
              orgProfile: 'solo',
              squads: [into],
              density: 'compact',
              tickets: s.tickets.map(remap),
              problems: s.problems.map(remap),
              kbArticles: s.kbArticles.map((k) => ({ ...k, squad: into })),
              users: s.users.map((u) => ({ ...u, squad: into })),
              aiSettings: { ...s.aiSettings, autonomy: 'auto_resolve_low_risk' },
            }));
          } else {
            const squads = get().squads.length > 1 ? get().squads : [...SWARM_SQUADS, ...(get().squads[0] && !SWARM_SQUADS.includes(get().squads[0]!) ? [get().squads[0]!] : [])];
            set({ orgProfile: profile, squads, density: 'comfortable' });
          }
          audit('admin', 'Organization profile changed', 'org', `${prev} → ${profile}`);
          get().pushToast({
            tone: 'success',
            title: { solo: 'Solo mode: one IT team, self-approval with a reason', team: 'Team mode', enterprise: 'Enterprise mode: strict separation of duties' }[profile],
          });
          return { ok: true };
        },

        addSquad: (name) => {
          const n = name.trim();
          if (n.length < 2) return fail('Give the squad a name');
          if (get().squads.some((q) => q.toLowerCase() === n.toLowerCase())) return fail(`${n} already exists`);
          if (get().squads.length >= 40) return fail('40 squads maximum');
          set((s) => ({ squads: [...s.squads, n], orgProfile: s.orgProfile === 'solo' ? 'team' : s.orgProfile }));
          audit('admin', 'Squad added', n, '');
          get().pushToast({ tone: 'success', title: `Squad “${n}” added` });
          return { ok: true };
        },

        renameSquad: (from, to) => {
          const n = to.trim();
          if (n.length < 2) return fail('Give the squad a name');
          if (from !== n && get().squads.some((q) => q.toLowerCase() === n.toLowerCase())) return fail(`${n} already exists`);
          const ren = (q: SwarmSquad) => (q === from ? n : q);
          set((s) => ({
            squads: s.squads.map(ren),
            tickets: s.tickets.map((t) => ({ ...t, swarmSquad: ren(t.swarmSquad) })),
            problems: s.problems.map((p) => ({ ...p, swarmSquad: ren(p.swarmSquad) })),
            users: s.users.map((u) => ({ ...u, squad: ren(u.squad) })),
            kbArticles: s.kbArticles.map((k) => ({ ...k, squad: ren(k.squad) })),
          }));
          audit('admin', 'Squad renamed', from, `→ ${n}`);
          return { ok: true };
        },

        removeSquad: (name, moveTo) => {
          if (get().squads.length <= 1) return fail('You need at least one squad');
          if (name === moveTo || !get().squads.includes(moveTo)) return fail('Pick another squad to move work to');
          const mv = (q: SwarmSquad) => (q === name ? moveTo : q);
          set((s) => ({
            squads: s.squads.filter((q) => q !== name),
            tickets: s.tickets.map((t) => ({ ...t, swarmSquad: mv(t.swarmSquad) })),
            problems: s.problems.map((p) => ({ ...p, swarmSquad: mv(p.swarmSquad) })),
            users: s.users.map((u) => ({ ...u, squad: mv(u.squad) })),
            kbArticles: s.kbArticles.map((k) => ({ ...k, squad: mv(k.squad) })),
          }));
          audit('admin', 'Squad removed', name, `work moved to ${moveTo}`);
          get().pushToast({ tone: 'info', title: `Squad “${name}” removed`, detail: `Everything moved to ${moveTo}` });
          return { ok: true };
        },

        setDensity: (density) => set({ density }),

        // ------------------------------------------------------------ home
        setSelectedTools: (ids) => {
          set({ selectedTools: [...new Set(ids)] });
          get().pushToast({ tone: 'success', title: 'Tool status updated', detail: `Watching ${ids.length} tools` });
        },

        addTimeOff: (entry) => {
          if (!get().users.some((u) => u.name === entry.person)) return fail(`${entry.person} is not on the team`);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.start) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.end)) return fail('Pick a start and end date');
          if (entry.end < entry.start) return fail('End date is before the start date');
          const overlap = get().timeOff.find((t) => t.person === entry.person && t.start <= entry.end && t.end >= entry.start);
          if (overlap) return fail(`${entry.person} already has ${overlap.type} from ${overlap.start} to ${overlap.end}`);
          set((s) => ({ timeOff: [...s.timeOff, { ...entry, id: uid('to'), source: 'manual' }] }));
          audit('admin', 'Time off added', entry.person, `${entry.type} ${entry.start} → ${entry.end}`);
          get().pushToast({ tone: 'success', title: 'Time off added', detail: `${entry.person} · ${entry.start === entry.end ? entry.start : `${entry.start} → ${entry.end}`}` });
          return { ok: true };
        },

        removeTimeOff: (id) => {
          const t = get().timeOff.find((x) => x.id === id);
          if (!t) return fail('Time off not found');
          set((s) => ({ timeOff: s.timeOff.filter((x) => x.id !== id) }));
          audit('admin', 'Time off removed', t.person, `${t.type} ${t.start} → ${t.end}`);
          get().pushToast({ tone: 'info', title: 'Time off removed', detail: t.person });
          return { ok: true };
        },

        importTimeOff: (entries) => {
          const existing = new Set(get().timeOff.map((t) => `${t.person}|${t.start}|${t.end}`));
          const fresh = entries.filter((e) => e.end >= e.start && !existing.has(`${e.person}|${e.start}|${e.end}`));
          set((s) => ({ timeOff: [...s.timeOff, ...fresh.map((e) => ({ ...e, id: uid('to') }))] }));
          if (fresh.length) audit('admin', 'Calendar imported', 'timeOff', `${fresh.length} entries from .ics`);
          get().pushToast({ tone: fresh.length ? 'success' : 'info', title: fresh.length ? `Imported ${fresh.length} time-off entries` : 'Nothing new to import' });
          return fresh.length;
        },

        sendWish: (person, occasion, year) => {
          if (get().wishes.some((w) => w.person === person && w.occasion === occasion && w.year === year && w.from === CURRENT_AGENT)) {
            return fail('You already sent your wishes 🙂');
          }
          set((s) => ({ wishes: [...s.wishes, { person, occasion, year, from: CURRENT_AGENT }] }));
          get().awardXp(5, 'Celebrated a teammate');
          get().pushToast({ tone: 'success', title: occasion === 'birthday' ? `🎂 Birthday wishes sent to ${person}` : `🎉 Congrats sent to ${person}`, detail: 'Posted to #team-celebrations' });
          return { ok: true };
        },

        addSpotlight: (entry) => {
          if (entry.name.trim().length < 2 || entry.funFact.trim().length < 10) return fail('Add a name and a fun fact (10+ characters)');
          if (entry.photo && entry.photo.length > 400_000) return fail('Photo is too large — try a smaller image');
          if (get().spotlight.length >= 24) return fail('The spotlight is full — remove an older entry first');
          set((s) => ({ spotlight: [{ ...entry, name: entry.name.trim(), funFact: entry.funFact.trim(), id: uid('sp'), kudos: 0, addedBy: CURRENT_AGENT }, ...s.spotlight] }));
          get().pushToast({ tone: 'success', title: `${entry.emoji} ${entry.name} is in the spotlight!` });
          return { ok: true };
        },

        giveKudos: (id) => set((s) => ({ spotlight: s.spotlight.map((e) => (e.id === id ? { ...e, kudos: e.kudos + 1 } : e)) })),

        removeSpotlight: (id) => {
          if (!get().spotlight.some((e) => e.id === id)) return fail('Entry not found');
          set((s) => ({ spotlight: s.spotlight.filter((e) => e.id !== id) }));
          return { ok: true };
        },

        // ------------------------------------------------------------ platform
        toggleFlag: (key) => {
          if (key === 'itsm_core') return fail('ITSM Core is the platform foundation and cannot be disabled');
          const enabled = !get().flags[key];
          set((s) => ({ flags: { ...s.flags, [key]: enabled } }));
          if (!enabled && get().inspector?.kind === (key === 'torii_saas' ? 'saas' : key === 'itam_cmdb' ? 'asset' : '')) {
            set({ inspector: null });
          }
          audit('admin', enabled ? 'Module enabled' : 'Module disabled', key, MODULE_LABEL[key]);
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
          set({ ...initialData(), ...initialUi(), themePreference: get().themePreference }); // keep the user's theme
          get().pushToast({ tone: 'info', title: 'Demo state reset', detail: 'All tickets, assets and SaaS data re-seeded' });
        },
      };
    },
    {
      name: 'adminzero-platform-v3',
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
        orgProfile: s.orgProfile,
        squads: s.squads,
        density: s.density,
        profile: s.profile,
        baseline: s.baseline,
        reclaimedMonthlySavings: s.reclaimedMonthlySavings,
        sidebarCollapsed: s.sidebarCollapsed,
        themePreference: s.themePreference,
        closedTickets: s.closedTickets,
        problems: s.problems,
        changeDetails: s.changeDetails,
        kbStats: s.kbStats,
        users: s.users,
        slaPolicies: s.slaPolicies,
        automations: s.automations,
        customFields: s.customFields,
        integrations: s.integrations,
        aiSettings: s.aiSettings,
        auditLog: s.auditLog,
        timeOff: s.timeOff,
        spotlight: s.spotlight,
        selectedTools: s.selectedTools,
        wishes: s.wishes,
      }),
    },
  ),
);

export const agentsForSquad = (squad: SwarmSquad) => AGENTS.filter((a) => a.squad === squad);
export const agentByName = (name: string) => AGENTS.find((a) => a.name === name);
