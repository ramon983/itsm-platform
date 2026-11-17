/** No-code automation rules (When → If → Then). Evaluated by the store; never touches status or ownership silently. */
import type { AutomationActionType, AutomationConditionField, AutomationRule, AutomationTrigger, Ticket } from '@/types/platform';

export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  ticket_created: 'A ticket is created',
  status_changed: 'A ticket changes status',
  siem_alert: 'A SIEM alert arrives',
};

export const FIELD_LABEL: Record<AutomationConditionField, string> = {
  priority: 'Priority',
  swarmSquad: 'Swarm squad',
  channel: 'Channel',
  detectedLanguage: 'Requester language',
  type: 'Ticket type',
};

export const FIELD_OPTIONS: Record<AutomationConditionField, string[]> = {
  priority: ['P1', 'P2', 'P3', 'P4'],
  swarmSquad: ['Network & Identity', 'Endpoint & Mac', 'SaaS & Cloud Ops', 'Security & SIEM'],
  channel: ['Slack', 'MS Teams', 'Portal', 'Email', 'SIEM Webhook'],
  detectedLanguage: ['en', 'es', 'fr', 'de', 'ja', 'pt', 'it'],
  type: ['INCIDENT', 'SERVICE_REQUEST', 'CHANGE', 'PROJECT'],
};

export const ACTION_LABEL: Record<AutomationActionType, string> = {
  notify_slack: 'Post to Slack channel',
  notify_teams: 'Post to Teams channel',
  add_swarm_agent: 'Add agent to the swarm',
  post_internal_note: 'Add an internal note',
  page_oncall: 'Page on-call',
};

export function ruleMatches(rule: AutomationRule, trigger: AutomationTrigger, ticket: Ticket): boolean {
  if (!rule.enabled || rule.trigger !== trigger) return false;
  return rule.conditions.every((c) => {
    const actual = String(ticket[c.field]);
    return c.op === 'is' ? actual === c.value : actual !== c.value;
  });
}

export function describeAction(type: AutomationActionType, value: string): string {
  switch (type) {
    case 'notify_slack':
      return `Posted to Slack ${value}`;
    case 'notify_teams':
      return `Posted to Teams “${value}”`;
    case 'add_swarm_agent':
      return `Added ${value} to the swarm`;
    case 'post_internal_note':
      return value;
    case 'page_oncall':
      return `Paged ${value}`;
  }
}
