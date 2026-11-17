/** Live third-party status: reads public status APIs from the browser and normalises them to one shape. */
import type { ToolDef } from '@/data/tools';

export type StatusLevel = 'operational' | 'maintenance' | 'degraded' | 'partial_outage' | 'major_outage' | 'unknown' | 'link_only';

export interface ToolIncident {
  name: string;
  status: string;
  impact: string;
  url?: string;
  updatedAt?: string;
  latestUpdate?: string;
  components: string[];
}

export interface ToolStatus {
  id: string;
  level: StatusLevel;
  description: string;
  affectedComponents: { name: string; status: string }[];
  incidents: ToolIncident[];
  maintenances: { name: string; scheduledFor?: string; url?: string }[];
  fetchedAt: string;
  error?: string;
}

export const LEVEL_RANK: Record<StatusLevel, number> = {
  major_outage: 0, partial_outage: 1, degraded: 2, maintenance: 3, unknown: 4, operational: 5, link_only: 6,
};
export const LEVEL_LABEL: Record<StatusLevel, string> = {
  operational: 'Operational', maintenance: 'Maintenance', degraded: 'Degraded', partial_outage: 'Partial outage',
  major_outage: 'Major outage', unknown: 'Status unavailable', link_only: 'Status page',
};
export const isDown = (l: StatusLevel) => l === 'degraded' || l === 'partial_outage' || l === 'major_outage';

interface StatuspageSummary {
  status: { indicator: 'none' | 'minor' | 'major' | 'critical' | 'maintenance'; description: string };
  components: { name: string; status: string; group: boolean }[];
  incidents: { name: string; status: string; impact: string; shortlink?: string; updated_at?: string; incident_updates?: { body: string }[]; components?: { name: string }[] }[];
  scheduled_maintenances?: { name: string; status: string; scheduled_for?: string; shortlink?: string }[];
}

export function parseStatuspage(id: string, d: StatuspageSummary, fetchedAt: string): ToolStatus {
  const level: StatusLevel = { none: 'operational', minor: 'degraded', major: 'partial_outage', critical: 'major_outage', maintenance: 'maintenance' }[d.status.indicator] as StatusLevel ?? 'unknown';
  const affected = d.components.filter((c) => !c.group && c.status !== 'operational').map((c) => ({ name: c.name, status: c.status.replaceAll('_', ' ') }));
  return {
    id,
    // Statuspage sometimes reports "none" while a component is degraded — trust the components.
    level: level === 'operational' && affected.some((c) => c.status !== 'under maintenance') ? 'degraded' : level,
    description: d.status.description,
    affectedComponents: affected,
    incidents: d.incidents.map((i) => ({
      name: i.name, status: i.status, impact: i.impact, url: i.shortlink, updatedAt: i.updated_at,
      latestUpdate: i.incident_updates?.[0]?.body, components: (i.components ?? []).map((c) => c.name),
    })),
    maintenances: (d.scheduled_maintenances ?? []).filter((m) => m.status !== 'completed').slice(0, 3).map((m) => ({ name: m.name, scheduledFor: m.scheduled_for, url: m.shortlink })),
    fetchedAt,
  };
}

interface SlackCurrent {
  status: string;
  active_incidents: { title: string; type: 'incident' | 'outage' | 'notice'; status: string; url?: string; date_updated?: string; services?: string[]; notes?: { body: string }[] }[];
}

export function parseSlack(id: string, d: SlackCurrent, fetchedAt: string): ToolStatus {
  const inc = d.active_incidents ?? [];
  const level: StatusLevel = inc.some((i) => i.type === 'outage') ? 'major_outage' : inc.some((i) => i.type === 'incident') ? 'degraded' : inc.length ? 'maintenance' : 'operational';
  return {
    id, level, description: inc.length ? `${inc.length} active ${inc.length === 1 ? 'issue' : 'issues'}` : 'All systems operational',
    affectedComponents: [...new Set(inc.flatMap((i) => i.services ?? []))].map((name) => ({ name, status: 'affected' })),
    incidents: inc.map((i) => ({ name: i.title, status: i.status, impact: i.type, url: i.url, updatedAt: i.date_updated, latestUpdate: i.notes?.[0]?.body, components: i.services ?? [] })),
    maintenances: [], fetchedAt,
  };
}

export function parseSalesforce(id: string, d: { id: number | string }[], fetchedAt: string): ToolStatus {
  return {
    id, level: d.length ? 'degraded' : 'operational',
    description: d.length ? `${d.length} active incident${d.length === 1 ? '' : 's'} across Salesforce instances` : 'All systems operational',
    affectedComponents: [],
    incidents: d.map((i) => ({ name: `Salesforce incident #${i.id}`, status: 'active', impact: 'minor', url: `https://status.salesforce.com/incidents/${i.id}`, components: [] })),
    maintenances: [], fetchedAt,
  };
}

export async function fetchToolStatus(tool: ToolDef, fetchImpl: typeof fetch = fetch): Promise<ToolStatus> {
  const fetchedAt = new Date().toISOString();
  if (tool.api === 'link' || !tool.apiUrl) {
    return { id: tool.id, level: 'link_only', description: 'No public status API — open the official page', affectedComponents: [], incidents: [], maintenances: [], fetchedAt };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl(tool.apiUrl, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (tool.api === 'slack') return parseSlack(tool.id, json as SlackCurrent, fetchedAt);
    if (tool.api === 'salesforce') return parseSalesforce(tool.id, json as { id: number }[], fetchedAt);
    return parseStatuspage(tool.id, json as StatuspageSummary, fetchedAt);
  } catch (e) {
    return { id: tool.id, level: 'unknown', description: 'Could not reach the status API', affectedComponents: [], incidents: [], maintenances: [], fetchedAt, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
