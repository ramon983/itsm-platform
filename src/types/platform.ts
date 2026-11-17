// Core schemas from the AdminZero spec (§4). Ticket-related interfaces are implemented exactly as specified.

export type TicketStatus =
  | 'AI_TRIAGED'
  | 'ACTIVE_SWARM'
  | 'WAITING_ON_CUSTOMER'
  | 'WAITING_ON_VENDOR'
  | 'RESOLVED_KB_LINKED';
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type SwarmSquad = 'Network & Identity' | 'Endpoint & Mac' | 'SaaS & Cloud Ops' | 'Security & SIEM';

export interface TicketMessage {
  id: string;
  sender: string;
  role: 'end_user' | 'agent' | 'ai_system' | 'handoff_audit' | 'diagnostic_telemetry';
  originalText: string;
  originalLang: string;
  translatedText?: string;
  timestamp: string;
  metadata?: Record<string, string>;
}

export interface Ticket {
  id: string; // e.g., 'INC-1049', 'SR-2088', 'CHG-301'
  type: 'INCIDENT' | 'SERVICE_REQUEST' | 'CHANGE' | 'PROJECT';
  templateId: string; // e.g., '#INC-NET-04'
  title: string;
  requesterName: string;
  requesterEmail: string;
  detectedLanguage: string;
  channel: 'Slack' | 'MS Teams' | 'Portal' | 'Email' | 'SIEM Webhook';
  priority: TicketPriority;
  sentiment: 'Calm' | 'Frustrated' | 'Urgent Client Impact';
  status: TicketStatus;
  swarmSquad: SwarmSquad;
  activeSwarmAgents: string[];
  slaRemainingSeconds: number;
  slaPaused: boolean;
  linkedAssetId?: string;
  linkedSaasId?: string;
  linkedKbId?: string;
  linkedJiraIssue?: string;
  recommendedMacro?: { id: string; label: string; command: string };
  messages: TicketMessage[];
}

// ---------------------------------------------------------------- supporting entities

export type ModuleKey = 'itsm_core' | 'ai_agents' | 'torii_saas' | 'itam_cmdb' | 'password_vault';
export type FeatureFlags = Record<ModuleKey, boolean>;

export type AssetLifecycle = 'Procured' | 'In Stock' | 'Deployed' | 'In Repair' | 'Retired';
export type FileVaultStatus = 'Encrypted' | 'Encrypting' | 'Disabled' | 'N/A';

export interface HardwareAsset {
  id: string; // asset tag, e.g. 'MBP-0942'
  name: string;
  model: string;
  category: 'Laptop' | 'Network' | 'Mobile' | 'Peripheral';
  serialNumber: string;
  hostname?: string;
  ipAddress?: string;
  assignedTo: string | null;
  assignedEmail: string | null;
  lifecycle: AssetLifecycle;
  mdmEnrolled: boolean;
  fileVault: FileVaultStatus;
  osVersion: string;
  appleCareExpires: string | null; // ISO date
  location: string;
  specs: Record<string, string>;
  installedSoftware: string[];
  linkedTicketIds: string[];
}

export interface SaasInactiveUser {
  name: string;
  email: string;
  lastSsoLoginDaysAgo: number;
}

export interface SaasApp {
  id: string; // e.g. 'saas-figma'
  name: string;
  vendor: string;
  category: string;
  approved: boolean; // false = shadow IT
  discoveredVia: 'Okta SSO' | 'Google OAuth' | 'Expense Report' | 'Browser Extension';
  provisionedSeats: number;
  activeSeats: number;
  costPerSeatMonthly: number;
  annualSpend: number;
  renewalDate: string; // ISO date
  oauthRisk: 'Low' | 'Medium' | 'High';
  owner: string;
  inactiveUsers: SaasInactiveUser[];
}

export interface JitGrant {
  ticketId: string;
  agentName: string;
  token: string;
  grantedAt: string;
  expiresAt: string;
}

export interface VaultItem {
  id: string;
  name: string;
  kind: 'Local Admin' | 'Infrastructure' | 'Database' | 'API Key' | 'Network Device';
  scope: string; // asset tag or system it unlocks
  allowedSquads: SwarmSquad[];
  rotationDays: number;
  lastRotated: string;
  activeGrant: JitGrant | null;
}

export type TelemetrySource = 'Microsoft Sentinel' | 'Splunk' | 'Datadog' | 'Okta' | 'Jamf' | 'Torii' | 'Vault' | 'AdminZero';

export interface TelemetryEvent {
  id: string;
  source: TelemetrySource;
  severity: 'critical' | 'high' | 'medium' | 'info';
  title: string;
  detail: string;
  assetId?: string;
  ticketId?: string;
  timestamp: string;
}

export interface KbArticle {
  id: string; // 'KB-402'
  title: string;
  summary: string;
  squad: SwarmSquad;
  steps: string[];
  keywords?: string[];
}

export interface Agent {
  name: string;
  initials: string;
  squad: SwarmSquad;
  color: string; // tailwind bg class for avatar
}

export interface AgentProfile {
  name: string;
  title: string;
  squad: SwarmSquad;
  level: number;
  xp: number;
  xpForNextLevel: number;
}

export interface MetricsBaseline {
  // Trailing-30-day history before the live tickets; KPIs blend these with live store state.
  resolvedCount: number;
  firstContactResolved: number;
  totalResolutionMinutes: number;
  slaMet: number;
  slaTotal: number;
}

export interface Toast {
  id: string;
  tone: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

export type InspectorTarget =
  | { kind: 'ticket'; id: string }
  | { kind: 'asset'; id: string }
  | { kind: 'saas'; id: string }
  | null;

// ---------------------------------------------------------------- end-user intake (Phase 2)

export interface EndUserProfile {
  name: string;
  email: string;
  department: string;
  location: string;
  preferredLanguage: string;
  assetIds: string[];
  saasIds: string[];
}

export type IntakeTemplateId = '#INC-NET-04' | '#SR-HW-01' | '#SR-SAAS-09' | '#CHG-SEC-02' | '#INC-SEC-01' | '#INC-GEN-01';

export interface IntakeField {
  key: string;
  label: string;
  value: string | null; // null = not provided yet
  critical: boolean;
}

export interface IntakeAnalysis {
  detectedLanguage: string;
  languageConfidence: number;
  sentiment: Ticket['sentiment'];
  sentimentSignals: string[];
  priority: TicketPriority;
  priorityReasons: string[];
  templateId: IntakeTemplateId;
  templateName: string;
  ticketType: Ticket['type'];
  swarmSquad: SwarmSquad;
  templateConfidence: number;
  fields: IntakeField[];
  requiredApprovals: string[];
  title: string;
  englishSummary: string;
  linkedAssetId?: string;
  linkedSaasId?: string;
  suggestedKbId?: string;
  recommendedMacro?: Ticket['recommendedMacro'];
  replyNative: string;
  replyEnglish: string;
  replyLanguage: string; // language the reply is actually written in
  clarifyingQuestion: string | null;
}

export interface IntakeChatMessage {
  id: string;
  from: 'user' | 'agent';
  text: string;
  lang: string;
  translation?: string; // English, when known
  timestamp: string;
}

// ---------------------------------------------------------------- platform expansion (ITSM modules, AI, admin)

/** A previously closed ticket — the corpus the copilot and the pattern detector learn from. */
export interface ClosedTicket {
  id: string;
  title: string;
  summary: string;
  templateId: string;
  type: Ticket['type'];
  swarmSquad: SwarmSquad;
  requesterName: string;
  resolution: string;
  resolvedBy: string; // agent name, or 'AdminZero AI (self-service)'
  kbId?: string;
  assetModel?: string;
  closedAt: string;
  minutesToResolve: number;
  firstContact: boolean;
}

export type ProblemStatus = 'INVESTIGATING' | 'WAITING_ON_VENDOR' | 'KNOWN_ERROR' | 'RESOLVED';

export interface Problem {
  id: string; // 'PRB-104'
  title: string;
  description: string;
  status: ProblemStatus;
  priority: TicketPriority;
  swarmSquad: SwarmSquad;
  activeSwarmAgents: string[];
  linkedTicketIds: string[];
  linkedClosedTicketIds: string[];
  rootCause: string | null;
  workaround: string | null;
  linkedKbId?: string;
  linkedJiraIssue?: string;
  createdAt: string;
  notes: { id: string; author: string; text: string; timestamp: string }[];
}

export type CabStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ChangeDetails {
  ticketId: string;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  riskFactors: Record<string, number>;
  cabStatus: CabStatus;
  cabDecisionBy?: string;
  windowStart: string;
  windowEnd: string;
  implementationPlan: string;
  rollbackPlan: string | null;
  affectedAssetIds: string[];
  jiraRelease?: string;
}

export interface KbStats {
  views: number;
  deflections: number; // employees who self-served with this article and never opened a ticket
  helpful: number;
  selfServiceEnabled: boolean;
  status: 'published' | 'draft';
  version: number;
  updatedAt: string;
  author: string;
  sourcePattern?: string;
}

export type Role = 'Agent' | 'Approver' | 'Admin';

export interface PlatformUser {
  name: string;
  email: string;
  role: Role;
  squad: SwarmSquad;
  active: boolean;
}

export interface SlaPolicy {
  priority: TicketPriority;
  responseMinutes: number;
  resolutionMinutes: number;
}

export type AutomationTrigger = 'ticket_created' | 'status_changed' | 'siem_alert';
export type AutomationConditionField = 'priority' | 'swarmSquad' | 'channel' | 'detectedLanguage' | 'type';
export type AutomationActionType = 'notify_slack' | 'notify_teams' | 'add_swarm_agent' | 'post_internal_note' | 'page_oncall';

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: { field: AutomationConditionField; op: 'is' | 'is_not'; value: string }[];
  actions: { type: AutomationActionType; value: string }[];
  runs: number;
  lastRunAt?: string;
}

export interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'select' | 'date' | 'number';
  appliesTo: Ticket['type'][];
  required: boolean;
  usage30d: number; // % of tickets where it was filled
}

export type IntegrationKey = 'slack' | 'teams' | 'jira' | 'sentinel' | 'splunk' | 'datadog' | 'okta' | 'jamf' | 'secret_manager';

export interface Integration {
  key: IntegrationKey;
  name: string;
  category: 'Chat' | 'Dev' | 'Security' | 'Identity' | 'Endpoint' | 'Platform';
  connected: boolean;
  detail: string;
}

export interface AiSettings {
  autonomy: 'suggest_only' | 'self_service_deflection' | 'auto_resolve_low_risk';
  confidenceThreshold: number; // 0..1 — below this the AI never acts or answers on its own
  sources: { knowledgeBase: boolean; closedTickets: boolean; cmdb: boolean; internetFallback: boolean };
  humanApprovalForMacros: true; // locked: macros always need a human
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
  category: 'ticket' | 'problem' | 'change' | 'knowledge' | 'vault' | 'saas' | 'asset' | 'admin' | 'ai' | 'automation';
}
