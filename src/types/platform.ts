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
