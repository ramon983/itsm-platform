/**
 * AdminZero Open API client.
 *
 * Live mode: NEXT_PUBLIC_API_BASE_URL points at the FastAPI backend (Cloud Run).
 * Simulated mode: no backend configured (e.g. the GitHub Pages demo) — the same endpoints run in the browser
 * with the same request/response contract, so the dashboard and the API playground behave identically.
 */
import { END_USERS } from '@/data/seed';
import { analyzeIntake } from '@/lib/intake';
import type { HardwareAsset, SaasApp } from '@/types/platform';

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
export const API_MODE: 'live' | 'simulated' = API_BASE ? 'live' : 'simulated';

// ------------------------------------------------------------------ contract (mirrors backend/adminzero_api/schemas.py)

export interface HealthResponse {
  status: 'ok';
  version: string;
  environment: string;
  secrets: { source: 'gcp_secret_manager' | 'env_local'; resolved: Record<string, boolean> };
  ai: { engine: 'claude' | 'offline'; model: string | null };
}

export interface IntakeApiResponse {
  reply: string;
  analysis: {
    detected_language: string;
    urgency_score: number;
    sentiment: 'Calm' | 'Frustrated' | 'Urgent Client Impact';
    selected_template_id: string;
    template_name: string;
    ticket_type: 'INCIDENT' | 'SERVICE_REQUEST' | 'CHANGE';
    priority: 'P1' | 'P2' | 'P3' | 'P4';
    english_summary_for_agent: string;
    required_approvals: string[];
    recommended_swarm_group: 'Network & Identity' | 'Endpoint & Mac' | 'SaaS & Cloud Ops' | 'Security & SIEM';
    clarifying_question: string | null;
    self_service_kb_ids: string[];
  };
  engine: 'claude' | 'offline';
  model?: string | null;
  fallback_reason?: string | null;
}

export interface AssistApiResponse {
  summary: string;
  recommendations: { action: string; rationale: string; kb_citations: string[] }[];
  macro: { macro_id: string; reason: string; kb_citations: string[] } | null;
  jit_elevation: { credential: string; reason: string } | null;
  draft_reply: string;
  draft_reply_english: string | null;
  knowledge_gaps: string[];
  rejected_ungrounded: string[];
  engine: 'claude' | 'offline';
  model?: string | null;
  fallback_reason?: string | null;
}

export interface SiemApiResponse {
  alert_id: string;
  source: 'sentinel' | 'splunk' | 'datadog';
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  indicators: { hosts: string[]; ips: string[]; users: string[] };
  matched_assets: { id: string; name: string; owner_name: string | null; owner_email: string | null }[];
  incident: {
    priority: 'P1' | 'P2' | 'P3' | 'P4';
    title: string;
    template_id: string;
    swarm_squad: 'Network & Identity' | 'Endpoint & Mac' | 'SaaS & Cloud Ops' | 'Security & SIEM';
    requester_name: string;
    requester_email: string;
    linked_asset_id: string | null;
    summary: string;
    recommended_macro: { id: string; label: string; command: string } | null;
  } | null;
}

export interface DiscoveryApiResponse {
  apps: {
    id: string; name: string; approved: boolean; provisioned_seats: number; active_seats: number; idle_seats: number;
    monthly_cost: number; annual_spend: number; reclaimable_monthly: number; renewal_days: number; oauth_risk: string; discovered_via: string;
  }[];
  totals: { annual_spend: number; monthly_spend: number; reclaimable_monthly: number; idle_seats: number; shadow_it_apps: number };
}

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  ms: number;
  body: T | { detail: string };
  mode: 'live' | 'simulated';
}

// ------------------------------------------------------------------ HMAC signing (WebCrypto, secret never stored)

export async function signWebhook(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  return `sha256=${Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function live<T>(method: 'GET' | 'POST', path: string, body?: string, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const started = performance.now();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
      body,
    });
    const json = (await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))) as T | { detail: string };
    return { status: res.status, ok: res.ok, ms: Math.round(performance.now() - started), body: json, mode: 'live' };
  } catch (e) {
    return { status: 0, ok: false, ms: Math.round(performance.now() - started), body: { detail: `Network error: ${(e as Error).message}` }, mode: 'live' };
  }
}

function simulated<T>(status: number, body: T | { detail: string }, started: number): ApiResult<T> {
  return { status, ok: status < 400, ms: Math.max(1, Math.round(performance.now() - started)), body, mode: 'simulated' };
}

// ------------------------------------------------------------------ endpoints

export async function getHealth(): Promise<ApiResult<HealthResponse>> {
  return live<HealthResponse>('GET', '/api/v1/health');
}

export interface IntakeRequestBody {
  message: string;
  requester_name?: string;
  requester_email?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  context?: { assets?: Record<string, unknown>[]; saas_apps?: string[]; kb_articles?: { id: string; title: string; summary?: string; steps: string[] }[] };
}

export async function postIntake(req: IntakeRequestBody, world: { assets: HardwareAsset[]; saasApps: SaasApp[] }): Promise<ApiResult<IntakeApiResponse>> {
  if (API_MODE === 'live') return live<IntakeApiResponse>('POST', '/api/v1/tickets/intake', JSON.stringify(req));
  const started = performance.now();
  if (!req.message?.trim()) return simulated<IntakeApiResponse>(422, { detail: 'message is required' }, started);
  const requester = END_USERS.find((u) => u.email === req.requester_email) ?? {
    name: req.requester_name ?? 'there', email: req.requester_email ?? 'unknown@adminzero.io', department: 'Unknown', location: 'Unknown',
    preferredLanguage: 'en', assetIds: [], saasIds: [],
  };
  const userMessages = [...(req.history ?? []).filter((h) => h.role === 'user').map((h) => h.content), req.message];
  const a = analyzeIntake({ requester, assets: world.assets, saasApps: world.saasApps, userMessages });
  const urgency = { P1: 5, P2: 4, P3: 3, P4: 2 }[a.priority];
  return simulated<IntakeApiResponse>(200, {
    reply: a.replyNative,
    analysis: {
      detected_language: a.detectedLanguage, urgency_score: urgency, sentiment: a.sentiment, selected_template_id: a.templateId,
      template_name: a.templateName, ticket_type: a.ticketType === 'PROJECT' ? 'INCIDENT' : a.ticketType, priority: a.priority,
      english_summary_for_agent: a.englishSummary, required_approvals: a.requiredApprovals, recommended_swarm_group: a.swarmSquad,
      clarifying_question: a.clarifyingQuestion, self_service_kb_ids: a.suggestedKbId && a.replyNative.includes(a.suggestedKbId) ? [a.suggestedKbId] : [],
    },
    engine: 'offline',
    fallback_reason: 'browser_simulation',
  }, started);
}

export async function postAssist(req: Record<string, unknown>): Promise<ApiResult<AssistApiResponse>> {
  return live<AssistApiResponse>('POST', '/api/v1/agent/assist', JSON.stringify(req));
}

// SIEM normalisation + CMDB correlation — same rules as backend/adminzero_api/siem.py
type Source = SiemApiResponse['source'];

function normalise(source: Source, p: Record<string, unknown>) {
  const sev = (v: unknown): SiemApiResponse['severity'] => {
    const s = String(v ?? 'medium').toLowerCase();
    const m = ({ sev1: 'critical', sev2: 'high', '1': 'critical', '2': 'high', '3': 'medium', '4': 'low', warning: 'medium', error: 'high', info: 'informational' } as Record<string, string>)[s] ?? s;
    return (['critical', 'high', 'medium', 'low', 'informational'].includes(m) ? m : 'medium') as SiemApiResponse['severity'];
  };
  const isIp = (v: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v) || v.includes(':');
  if (source === 'sentinel') {
    const props = (p.properties ?? p) as Record<string, unknown>;
    const hosts: string[] = [];
    const ips: string[] = [];
    const users: string[] = [];
    for (const e of (props.entities as Record<string, string>[] | undefined) ?? []) {
      const kind = String(e.kind ?? e.type ?? '').toLowerCase();
      if (kind === 'host' && e.hostName) hosts.push(e.hostName);
      else if (kind === 'ip' && e.address) ips.push(e.address);
      else if (kind === 'account') {
        const upn = e.upn ?? (e.accountName && e.upnSuffix ? `${e.accountName}@${e.upnSuffix}` : '');
        if (upn) users.push(upn);
      }
    }
    return { id: String(props.systemAlertId ?? props.alertId ?? 'sentinel-alert'), title: String(props.alertDisplayName ?? props.title ?? 'Sentinel alert'), severity: sev(props.severity), hosts, ips, users };
  }
  if (source === 'splunk') {
    const r = (p.result ?? {}) as Record<string, string>;
    const vals = [r.host, r.src, r.dest].filter(Boolean) as string[];
    return { id: String(p.sid ?? p.search_name ?? 'splunk-alert'), title: String(p.search_name ?? 'Splunk alert'), severity: sev(r.severity ?? r.urgency), hosts: vals.filter((v) => !isIp(v)), ips: vals.filter(isIp), users: r.user ? [r.user] : [] };
  }
  const tags = typeof p.tags === 'string' ? p.tags.split(',') : ((p.tags as string[] | undefined) ?? []);
  const hosts = [...(p.hostname ? [String(p.hostname)] : []), ...tags.filter((t) => t.startsWith('host:')).map((t) => t.slice(5))];
  return { id: String(p.alert_id ?? p.id ?? 'datadog-alert'), title: String(p.title ?? 'Datadog alert'), severity: sev(p.priority ?? p.alert_type), hosts: [...new Set(hosts)], ips: [], users: String(p.body ?? '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [] };
}

export function buildSiemResponse(source: Source, payload: Record<string, unknown>, assets: HardwareAsset[]): SiemApiResponse {
  const n = normalise(source, payload);
  const hosts = new Set(n.hosts.map((h) => h.toLowerCase()));
  const users = new Set(n.users.map((u) => u.toLowerCase()));
  const matched = assets.filter((a) =>
    (a.hostname && hosts.has(a.hostname.toLowerCase())) || hosts.has(a.id.toLowerCase()) || hosts.has(a.serialNumber.toLowerCase())
    || (a.ipAddress && n.ips.includes(a.ipAddress)) || (a.assignedEmail && users.has(a.assignedEmail.toLowerCase())));
  const primary = matched.find((a) => a.assignedEmail) ?? matched[0];
  const mfa = /mfa|brute|fatigue|push/i.test(n.title);
  return {
    alert_id: n.id, source, title: n.title, severity: n.severity,
    indicators: { hosts: n.hosts, ips: n.ips, users: n.users },
    matched_assets: matched.map((a) => ({ id: a.id, name: a.name, owner_name: a.assignedTo, owner_email: a.assignedEmail })),
    incident: n.severity === 'critical' || n.severity === 'high' ? {
      priority: 'P1',
      title: `${source[0]!.toUpperCase()}${source.slice(1)}: ${n.title}${primary ? ` on ${primary.id}${primary.assignedTo ? ` (${primary.assignedTo})` : ''}` : ''}`,
      template_id: '#INC-SEC-01', swarm_squad: 'Security & SIEM',
      requester_name: { sentinel: 'Microsoft Sentinel', splunk: 'Splunk', datadog: 'Datadog' }[source], requester_email: 'soc-alerts@adminzero.io',
      linked_asset_id: primary?.id ?? null,
      summary: `${n.severity.toUpperCase()} alert ${n.id}. Indicators — hosts: ${n.hosts.join(', ') || '—'}; IPs: ${n.ips.join(', ') || '—'}; users: ${n.users.join(', ') || '—'}. ${primary ? `Correlated with CMDB ${primary.id} (${primary.name}, FileVault ${primary.fileVault}).` : 'No CMDB match.'}`,
      recommended_macro: mfa && primary?.assignedEmail
        ? { id: 'macro-revoke-okta-sessions', label: 'Revoke Okta sessions & force MFA re-enrolment', command: `okta users sessions revoke ${primary.assignedEmail}` }
        : primary ? { id: 'macro-isolate-endpoint', label: `Isolate ${primary.id} via CrowdStrike`, command: `falconctl contain --host ${primary.hostname ?? primary.id}` } : null,
    } : null,
  };
}

export async function postSiemWebhook(
  source: Source,
  rawBody: string,
  opts: { secret?: string; assets: HardwareAsset[] },
): Promise<ApiResult<SiemApiResponse> & { signature?: string; timestamp?: string }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = opts.secret ? await signWebhook(opts.secret, timestamp, rawBody) : undefined;
  if (API_MODE === 'live') {
    const res = await live<SiemApiResponse>('POST', `/api/v1/siem/webhook?source=${source}`, rawBody, signature ? { 'X-AdminZero-Timestamp': timestamp, 'X-AdminZero-Signature': signature } : {});
    return { ...res, signature, timestamp };
  }
  const started = performance.now();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ...simulated<SiemApiResponse>(422, { detail: 'Body must be JSON' }, started), signature, timestamp };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ...simulated<SiemApiResponse>(422, { detail: 'Body must be a JSON object' }, started), signature, timestamp };
  return { ...simulated(202, buildSiemResponse(source, payload as Record<string, unknown>, opts.assets), started), signature, timestamp };
}

export async function getSaasDiscovery(saasApps: SaasApp[]): Promise<ApiResult<DiscoveryApiResponse>> {
  if (API_MODE === 'live') return live<DiscoveryApiResponse>('GET', '/api/v1/saas/discovery');
  const started = performance.now();
  const apps = saasApps.map((a) => {
    const idle = a.inactiveUsers.length;
    const monthly = a.provisionedSeats * a.costPerSeatMonthly;
    return {
      id: a.id, name: a.name, approved: a.approved, provisioned_seats: a.provisionedSeats, active_seats: a.activeSeats, idle_seats: idle,
      monthly_cost: Math.round(monthly * 100) / 100, annual_spend: a.annualSpend, reclaimable_monthly: Math.round(idle * a.costPerSeatMonthly * 100) / 100,
      renewal_days: Math.ceil((Date.parse(a.renewalDate) - Date.now()) / 86_400_000), oauth_risk: a.oauthRisk, discovered_via: a.discoveredVia,
    };
  });
  const sum = (k: 'annual_spend' | 'monthly_cost' | 'reclaimable_monthly' | 'idle_seats') => Math.round(apps.reduce((n, a) => n + a[k], 0) * 100) / 100;
  return simulated(200, {
    apps,
    totals: { annual_spend: sum('annual_spend'), monthly_spend: sum('monthly_cost'), reclaimable_monthly: sum('reclaimable_monthly'), idle_seats: sum('idle_seats'), shadow_it_apps: apps.filter((a) => !a.approved).length },
  }, started);
}
