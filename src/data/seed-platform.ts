import type {
  AiSettings,
  AuditEntry,
  AutomationRule,
  ChangeDetails,
  ClosedTicket,
  CustomField,
  Integration,
  KbStats,
  PlatformUser,
  Problem,
  SpotlightEntry,
  TimeOff,
  SlaPolicy,
  SwarmSquad,
  Ticket,
} from '@/types/platform';

const H = 3600_000;
const D = 24 * H;

type ClosedSeed = [title: string, summary: string, template: string, squad: SwarmSquad, resolution: string, resolvedBy: string, kbId: string | undefined, assetModel: string | undefined, daysAgo: number, minutes: number, firstContact: boolean];

// 30 days of closed tickets. Recurring topics are deliberate: some are covered by KB, some are not —
// that gap is what the Knowledge pattern detector finds.
const CLOSED: ClosedSeed[] = [
  // Outlook calendar sync — recurring, no KB article
  ['Outlook calendar not syncing with Exchange', 'Meetings created on phone do not appear in Outlook for Mac calendar.', '#INC-SAAS-03', 'SaaS & Cloud Ops', 'Removed and re-added the Exchange account in Outlook; cleared the cached Exchange credentials in Keychain.', 'Jonas Weber', undefined, 'MacBook Pro 14"', 2, 95, true],
  ['Outlook calendar sync stuck after migration', 'Calendar shows events from last week only; sync stuck at "Updating".', '#INC-SAAS-03', 'SaaS & Cloud Ops', 'Reset the Outlook profile and re-added the Exchange account; sync completed in 5 minutes.', 'Fatima Khan', undefined, 'MacBook Air 13"', 4, 120, true],
  ['Calendar invites missing in Outlook', 'Accepted invites never show in the Outlook calendar.', '#INC-SAAS-03', 'SaaS & Cloud Ops', 'Cleared cached Exchange credentials in Keychain, then re-added the account in Outlook.', 'Jonas Weber', undefined, 'MacBook Pro 16"', 7, 80, true],
  ['Outlook calendar out of sync on Mac', 'Calendar and mailbox out of sync since the tenant migration.', '#INC-SAAS-03', 'SaaS & Cloud Ops', 'Removed the stale Exchange account and re-added it; advised to keep Outlook updated.', 'Fatima Khan', undefined, 'MacBook Pro 14"', 11, 140, false],
  ['Shared calendar not syncing in Outlook', 'Team shared calendar not updating in Outlook for Mac.', '#INC-SAAS-03', 'SaaS & Cloud Ops', 'Re-added the Exchange account and re-subscribed to the shared calendar.', 'Jonas Weber', undefined, 'MacBook Air 13"', 15, 110, true],
  ['Outlook calendar sync error 1025', 'Sync error 1025 when opening calendar in Outlook.', '#INC-SAAS-03', 'SaaS & Cloud Ops', 'Cleared Keychain Exchange entries and re-added the account; error resolved.', 'Fatima Khan', undefined, 'MacBook Pro 14"', 21, 70, true],
  // Okta lockout / MFA — recurring, no KB article
  ['Locked out of Okta after password change', 'User changed password and is now locked out of Okta on all devices.', '#INC-IAM-02', 'Network & Identity', 'Unlocked the Okta account and cleared old sessions; user signed in with the new password.', 'Sam Okafor', undefined, undefined, 1, 25, true],
  ['Locked out of Okta — MFA not working on new phone', 'New phone; Okta Verify push never arrives so the account locks.', '#INC-IAM-02', 'Network & Identity', 'Reset Okta Verify factor; user re-enrolled on the new phone.', 'Alex Rivera', undefined, undefined, 3, 20, true],
  ['Okta account locked, MFA prompts failing', 'Too many failed MFA attempts; account locked.', '#INC-IAM-02', 'Network & Identity', 'Unlocked the Okta account and reset Okta Verify; confirmed sign-in.', 'Sam Okafor', undefined, undefined, 9, 30, true],
  ['Cannot sign in to Okta — account locked', 'Locked out of Okta before a customer call.', '#INC-IAM-02', 'Network & Identity', 'Unlocked the Okta account; reminded the user about the self-service unlock link.', 'Alex Rivera', undefined, undefined, 13, 15, true],
  ['Locked out of Okta after losing phone', 'Lost phone, account locked; needs MFA reset to sign in.', '#INC-IAM-02', 'Network & Identity', 'Verified identity with manager, reset Okta Verify factor and re-enrolled.', 'Sam Okafor', undefined, undefined, 18, 45, false],
  // Zoom audio after macOS update — recurring, no KB article
  ['Zoom audio drops after macOS update', 'Audio cuts out in Zoom meetings since updating macOS.', '#INC-EP-05', 'Endpoint & Mac', 'Restarted Core Audio (killall coreaudiod) and updated Zoom to 6.2; audio stable.', 'Mei Chen', undefined, 'MacBook Pro 14"', 2, 35, true],
  ['No microphone in Zoom after update', 'Microphone not detected in Zoom after macOS 15.4 update.', '#INC-EP-05', 'Endpoint & Mac', 'Re-granted the Zoom microphone permission and restarted Core Audio.', 'Diego Torres', undefined, 'MacBook Air 13"', 6, 40, true],
  ['Zoom audio crackling on MacBook', 'Crackling audio in Zoom calls after the macOS update.', '#INC-EP-05', 'Endpoint & Mac', 'Restarted Core Audio and updated Zoom; crackling gone.', 'Mei Chen', undefined, 'MacBook Pro 16"', 10, 30, true],
  ['Zoom audio cuts out every few minutes', 'Audio drops in Zoom; started after OS update.', '#INC-EP-05', 'Endpoint & Mac', 'Updated Zoom to 6.2 and restarted Core Audio.', 'Diego Torres', undefined, 'MacBook Pro 14"', 17, 50, false],
  // VPN certificate — covered by KB-402
  ['AnyConnect VPN fails at authentication', 'VPN fails at IKE auth; device certificate expired.', '#INC-NET-04', 'Network & Identity', 'Re-pushed the split-tunnel certificate via Jamf (KB-402).', 'Alex Rivera', 'KB-402', 'MacBook Pro 14"', 3, 30, true],
  ['VPN not connecting — certificate expired', 'AnyConnect reports certificate validation failure.', '#INC-NET-04', 'Network & Identity', 'Ran the split-tunnel certificate macro (KB-402); VPN connected.', 'Sam Okafor', 'KB-402', 'MacBook Air 13"', 8, 25, true],
  ['Cisco AnyConnect VPN keeps failing', 'VPN fails every morning since Monday.', '#INC-NET-04', 'Network & Identity', 'Expired device certificate; re-pushed via Jamf per KB-402.', 'Alex Rivera', 'KB-402', 'MacBook Pro 16"', 14, 40, true],
  ['VPN certificate error on MacBook', 'Certificate error when connecting to the VPN.', '#INC-NET-04', 'Network & Identity', 'Re-pushed split-tunnel certificate (KB-402).', 'Sam Okafor', 'KB-402', 'MacBook Pro 14"', 20, 20, true],
  // Figma seats — covered by KB-405, not yet self-service
  ['Figma editor seat request', 'Need Figma editor access for a new project.', '#SR-SAAS-09', 'SaaS & Cloud Ops', 'Reused an idle Figma seat and added user to Okta "Figma Editors" (KB-405).', 'Fatima Khan', 'KB-405', undefined, 5, 15, true],
  ['Figma editor licence for contractor', 'Contractor needs Figma editor seat for 3 months.', '#SR-SAAS-09', 'SaaS & Cloud Ops', 'Added to Okta "Figma Editors" with expiry; reused idle seat (KB-405).', 'Jonas Weber', 'KB-405', undefined, 12, 20, true],
  ['Upgrade Figma viewer to editor seat', 'Viewer seat needs edit rights for the design sprint.', '#SR-SAAS-09', 'SaaS & Cloud Ops', 'Moved user to the Okta "Figma Editors" group (KB-405).', 'Fatima Khan', 'KB-405', undefined, 19, 10, true],
  // Salesforce SSO — covered and already self-service
  ['Salesforce SSO redirect loop', 'Infinite redirect between Okta and Salesforce.', '#INC-SAAS-03', 'SaaS & Cloud Ops', 'Self-served with KB-415: opened Salesforce from the Okta dashboard tile.', 'AdminZero AI (self-service)', 'KB-415', undefined, 4, 3, true],
  ['Salesforce login loop after session expiry', 'Login loops after Okta session expired.', '#INC-SAAS-03', 'SaaS & Cloud Ops', 'Self-served with KB-415.', 'AdminZero AI (self-service)', 'KB-415', undefined, 16, 2, true],
  // Singles
  ['Monitor flickering on USB-C dock', 'External Dell monitor flickers when docked.', '#INC-EP-07', 'Endpoint & Mac', 'Replaced USB-C cable with a certified Thunderbolt cable.', 'Diego Torres', undefined, 'MacBook Pro 14"', 9, 60, true],
  ['Datadog dashboard access for new SRE', 'New SRE needs Datadog read access.', '#SR-SAAS-09', 'SaaS & Cloud Ops', 'Added to Okta "Datadog Read" group.', 'Jonas Weber', undefined, undefined, 11, 15, true],
  ['Floor 3 printer offline', 'Printer on floor 3 shows offline.', '#INC-EP-08', 'Endpoint & Mac', 'Power-cycled the printer and re-added it via Jamf printer profile.', 'Mei Chen', undefined, undefined, 22, 55, true],
  ['Suspicious login alert from Okta', 'Okta flagged a login from a new country.', '#INC-SEC-01', 'Security & SIEM', 'Confirmed travel with the user; no compromise. Session kept.', 'Riley Park', 'KB-430', 'MacBook Air 13"', 24, 35, true],
];

export function createPlatformSeed(now: number) {
  const iso = (ms: number) => new Date(now + ms).toISOString();
  // Dates relative to "today" so the demo always has something to celebrate this week.
  const day = (offset: number) => new Date(now + offset * D);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const md = (offset: number) => ymd(day(offset)).slice(5);
  const started = (yearsAgo: number, offset: number) => { const d = day(offset); d.setFullYear(d.getFullYear() - yearsAgo); return ymd(d); };

  const closedTickets: ClosedTicket[] = CLOSED.map(([title, summary, templateId, swarmSquad, resolution, resolvedBy, kbId, assetModel, daysAgo, minutes, firstContact], i) => ({
    id: `${templateId.startsWith('#SR') ? 'SR' : 'INC'}-${templateId.startsWith('#SR') ? 1990 + i : 960 + i}`,
    title, summary, templateId, type: templateId.startsWith('#SR') ? 'SERVICE_REQUEST' : 'INCIDENT', swarmSquad,
    requesterName: ['Ava Adams', 'Ben Berg', 'Chloe Costa', 'Dev Patel', 'Elif Engel', 'Finn Fischer', 'Grace Hughes', 'Hiro Ito'][i % 8]!,
    resolution, resolvedBy, kbId, assetModel, closedAt: iso(-daysAgo * D - (i % 5) * H), minutesToResolve: minutes, firstContact,
  }));

  // Two more change tickets so the Changes view has a real CAB pipeline.
  const extraTickets: Ticket[] = [
    {
      id: 'CHG-302', type: 'CHANGE', templateId: '#CHG-STD-07', title: 'Datadog agent 7.58 rollout to production hosts',
      requesterName: 'Jonas Weber', requesterEmail: 'jonas.weber@adminzero.io', detectedLanguage: 'en', channel: 'Portal',
      priority: 'P3', sentiment: 'Calm', status: 'ACTIVE_SWARM', swarmSquad: 'SaaS & Cloud Ops', activeSwarmAgents: ['Jonas Weber', 'Fatima Khan'],
      slaRemainingSeconds: 20 * 3600, slaPaused: false, linkedSaasId: 'saas-datadog', linkedJiraIssue: 'PLAT-1188',
      messages: [
        { id: 'msg-chg302-1', sender: 'Jonas Weber', role: 'agent', originalText: 'Rolling Datadog agent 7.58 to 214 production hosts in two waves. Canary on 10 hosts passed for 48h.', originalLang: 'en', timestamp: iso(-30 * H), metadata: { visibility: 'internal' } },
        { id: 'msg-chg302-2', sender: 'Riley Park', role: 'agent', originalText: 'CAB approved. Keep the 7.56 package pinned for rollback.', originalLang: 'en', timestamp: iso(-6 * H), metadata: { visibility: 'internal' } },
      ],
    },
    {
      id: 'CHG-303', type: 'CHANGE', templateId: '#CHG-STD-02', title: 'macOS 15.5 staged rollout via Jamf (ring 1)',
      requesterName: 'Mei Chen', requesterEmail: 'mei.chen@adminzero.io', detectedLanguage: 'en', channel: 'Portal',
      priority: 'P4', sentiment: 'Calm', status: 'AI_TRIAGED', swarmSquad: 'Endpoint & Mac', activeSwarmAgents: ['Mei Chen'],
      slaRemainingSeconds: 60 * 3600, slaPaused: false, linkedAssetId: 'MBP-1120', linkedJiraIssue: 'EP-311',
      messages: [
        { id: 'msg-chg303-1', sender: 'Mei Chen', role: 'agent', originalText: 'Standard change: ring 1 (IT + 25 volunteers) gets macOS 15.5 via Jamf. Known issue: Zoom audio after update (see closed tickets).', originalLang: 'en', timestamp: iso(-3 * H), metadata: { visibility: 'internal' } },
      ],
    },
  ];

  const changeDetails: Record<string, ChangeDetails> = {
    'CHG-301': {
      ticketId: 'CHG-301', riskScore: 64, riskLevel: 'HIGH', riskFactors: { 'Impact (company-wide SSO)': 32, 'Blast radius (14 SPs)': 20, 'Touches security controls': 10, 'Outside window': 2 },
      cabStatus: 'PENDING', windowStart: iso(9 * H), windowEnd: iso(10 * H),
      implementationPlan: 'Generate new signing cert in Okta, stage metadata on all 14 SPs, activate at 22:00, verify SSO on each SP.',
      rollbackPlan: 'Re-activate the previous signing certificate in Okta (kept for 7 days) and restore SP metadata.',
      affectedAssetIds: [], jiraRelease: 'iam-2026.11.2',
    },
    'CHG-302': {
      ticketId: 'CHG-302', riskScore: 38, riskLevel: 'MEDIUM', riskFactors: { 'Impact (production monitoring)': 16, 'Blast radius (214 hosts)': 20, 'Tested in canary': 0, 'Rollback plan': 0, 'Failure history': 2 },
      cabStatus: 'APPROVED', cabDecisionBy: 'Riley Park', windowStart: iso(16 * H), windowEnd: iso(18 * H),
      implementationPlan: 'Wave 1: 50% of hosts via Ansible, 30 min soak, wave 2: remaining hosts.',
      rollbackPlan: 'apt pin datadog-agent=7.56 and re-run the Ansible playbook.', affectedAssetIds: [], jiraRelease: 'PLAT-R-142',
    },
    'CHG-303': {
      ticketId: 'CHG-303', riskScore: 22, riskLevel: 'LOW', riskFactors: { 'Impact (ring 1 only)': 8, 'Blast radius (26 devices)': 10, 'Known issue: Zoom audio': 4 },
      cabStatus: 'NOT_REQUIRED', windowStart: iso(2 * D), windowEnd: iso(2 * D + 4 * H),
      implementationPlan: 'Jamf policy "macOS 15.5 ring 1" scoped to IT + volunteers smart group; deferral 2 days.',
      rollbackPlan: null, affectedAssetIds: ['MBP-1120'], jiraRelease: 'EP-R-15',
    },
  };

  const problems: Problem[] = [
    {
      id: 'PRB-104', title: 'Recurring AnyConnect certificate expiry on the macOS fleet', status: 'KNOWN_ERROR', priority: 'P2',
      description: 'Split-tunnel device certificates expire without renewal, breaking VPN for Mac users.',
      swarmSquad: 'Network & Identity', activeSwarmAgents: ['Alex Rivera', 'Mei Chen'],
      linkedTicketIds: ['INC-1049'], linkedClosedTicketIds: [], rootCause: 'Jamf certificate renewal policy is scoped to the legacy "Corp Macs" smart group; devices enrolled after August are not in it.',
      workaround: 'Re-push the split-tunnel certificate (KB-402).', linkedKbId: 'KB-402', linkedJiraIssue: 'JAMF-219', createdAt: iso(-12 * D),
      notes: [{ id: 'n1', author: 'Mei Chen', text: 'Fix is a scope change on the renewal policy — raising a standard change.', timestamp: iso(-2 * D) }],
    },
    {
      id: 'PRB-105', title: 'Outlook calendar sync failures since the M365 tenant migration', status: 'INVESTIGATING', priority: 'P3',
      description: 'Six calendar-sync incidents in 30 days, all on Outlook for Mac after the tenant migration.',
      swarmSquad: 'SaaS & Cloud Ops', activeSwarmAgents: ['Jonas Weber'], linkedTicketIds: [], linkedClosedTicketIds: [],
      rootCause: null, workaround: 'Remove and re-add the Exchange account; clear cached credentials in Keychain.', createdAt: iso(-5 * D), notes: [],
    },
    {
      id: 'PRB-106', title: 'Floor 3 Wi-Fi roaming drops real-time calls', status: 'WAITING_ON_VENDOR', priority: 'P3',
      description: 'Calls drop when users walk between access points on floor 3 (Lisbon).',
      swarmSquad: 'Network & Identity', activeSwarmAgents: ['Alex Rivera'], linkedTicketIds: ['INC-1045'], linkedClosedTicketIds: [],
      rootCause: 'Sticky-client roaming on MR46 firmware 29.x.', workaround: 'Enable 802.11r on the Corp SSID (KB-377).', linkedKbId: 'KB-377',
      linkedJiraIssue: 'NET-901', createdAt: iso(-9 * D), notes: [{ id: 'n2', author: 'Alex Rivera', text: 'Meraki case #08812 open for firmware fix.', timestamp: iso(-1 * D) }],
    },
  ];
  // Link the closed tickets that belong to each problem.
  problems[0]!.linkedClosedTicketIds = closedTickets.filter((t) => t.kbId === 'KB-402').map((t) => t.id);
  problems[1]!.linkedClosedTicketIds = closedTickets.filter((t) => /outlook/i.test(t.title)).map((t) => t.id);

  const kbStats: Record<string, KbStats> = {
    'KB-402': { views: 412, deflections: 0, helpful: 57, selfServiceEnabled: false, status: 'published', version: 3, updatedAt: iso(-20 * D), author: 'Alex Rivera' },
    'KB-388': { views: 120, deflections: 0, helpful: 18, selfServiceEnabled: false, status: 'published', version: 2, updatedAt: iso(-40 * D), author: 'Mei Chen' },
    'KB-405': { views: 96, deflections: 0, helpful: 22, selfServiceEnabled: false, status: 'published', version: 1, updatedAt: iso(-60 * D), author: 'Fatima Khan' },
    'KB-415': { views: 230, deflections: 41, helpful: 64, selfServiceEnabled: true, status: 'published', version: 2, updatedAt: iso(-15 * D), author: 'Fatima Khan' },
    'KB-421': { views: 18, deflections: 0, helpful: 4, selfServiceEnabled: false, status: 'published', version: 1, updatedAt: iso(-90 * D), author: 'Sam Okafor' },
    'KB-430': { views: 64, deflections: 0, helpful: 12, selfServiceEnabled: false, status: 'published', version: 4, updatedAt: iso(-8 * D), author: 'Riley Park' },
    'KB-377': { views: 55, deflections: 9, helpful: 11, selfServiceEnabled: true, status: 'published', version: 1, updatedAt: iso(-9 * D), author: 'Alex Rivera' },
  };

  const users: PlatformUser[] = [
    { name: 'Alex Rivera', email: 'alex.rivera@adminzero.io', role: 'Admin', squad: 'Network & Identity', active: true, country: 'US', timezone: 'America/New_York', birthday: md(18), startDate: started(4, 6) },
    { name: 'Sam Okafor', email: 'sam.okafor@adminzero.io', role: 'Approver', squad: 'Network & Identity', active: true, country: 'GB', timezone: 'Europe/London', birthday: md(3), startDate: started(2, 40) },
    { name: 'Mei Chen', email: 'mei.chen@adminzero.io', role: 'Agent', squad: 'Endpoint & Mac', active: true, country: 'CA', timezone: 'America/Toronto', birthday: md(0), startDate: started(6, 25) },
    { name: 'Diego Torres', email: 'diego.torres@adminzero.io', role: 'Agent', squad: 'Endpoint & Mac', active: true, country: 'ES', timezone: 'Europe/Madrid', birthday: md(-1), startDate: started(1, 11) },
    { name: 'Fatima Khan', email: 'fatima.khan@adminzero.io', role: 'Agent', squad: 'SaaS & Cloud Ops', active: true, country: 'IN', timezone: 'Asia/Kolkata', birthday: md(27), startDate: started(3, 2) },
    { name: 'Jonas Weber', email: 'jonas.weber@adminzero.io', role: 'Agent', squad: 'SaaS & Cloud Ops', active: true, country: 'DE', timezone: 'Europe/Berlin', birthday: md(45), startDate: started(5, 1) },
    { name: 'Riley Park', email: 'riley.park@adminzero.io', role: 'Approver', squad: 'Security & SIEM', active: true, country: 'US', timezone: 'America/Los_Angeles', birthday: md(9), startDate: started(7, 20) },
    { name: 'Noor Haddad', email: 'noor.haddad@adminzero.io', role: 'Agent', squad: 'Security & SIEM', active: true, country: 'FR', timezone: 'Europe/Paris', birthday: md(60), startDate: started(2, 4) },
  ];


  const slaPolicies: SlaPolicy[] = [
    { priority: 'P1', responseMinutes: 15, resolutionMinutes: 4 * 60 },
    { priority: 'P2', responseMinutes: 30, resolutionMinutes: 8 * 60 },
    { priority: 'P3', responseMinutes: 4 * 60, resolutionMinutes: 24 * 60 },
    { priority: 'P4', responseMinutes: 8 * 60, resolutionMinutes: 72 * 60 },
  ];

  const automations: AutomationRule[] = [
    { id: 'auto-p1', name: 'P1 → major-incident channel + on-call page', enabled: true, trigger: 'ticket_created',
      conditions: [{ field: 'priority', op: 'is', value: 'P1' }],
      actions: [{ type: 'notify_slack', value: '#it-major-incidents' }, { type: 'page_oncall', value: 'Squad on-call' }], runs: 14, lastRunAt: iso(-72 * 60_000) },
    { id: 'auto-lang', name: 'Non-English requester → bilingual reply reminder', enabled: true, trigger: 'ticket_created',
      conditions: [{ field: 'detectedLanguage', op: 'is_not', value: 'en' }],
      actions: [{ type: 'post_internal_note', value: 'AI translation attached — reply in the requester’s language with the bilingual composer.' }], runs: 38, lastRunAt: iso(-95 * 60_000) },
    { id: 'auto-siem', name: 'SIEM alert → add SOC analyst + Teams bridge', enabled: true, trigger: 'siem_alert',
      conditions: [],
      actions: [{ type: 'add_swarm_agent', value: 'Noor Haddad' }, { type: 'notify_teams', value: 'SOC Bridge' }], runs: 9, lastRunAt: iso(-72 * 60_000) },
    { id: 'auto-vendor', name: 'Waiting on vendor → note vendor case in Slack', enabled: false, trigger: 'status_changed',
      conditions: [{ field: 'type', op: 'is', value: 'INCIDENT' }],
      actions: [{ type: 'notify_slack', value: '#vendor-escalations' }], runs: 0 },
  ];

  const customFields: CustomField[] = [
    { id: 'cf-cost-center', label: 'Cost center', type: 'select', appliesTo: ['SERVICE_REQUEST'], required: true, usage30d: 92 },
    { id: 'cf-office', label: 'Affected office', type: 'select', appliesTo: ['INCIDENT'], required: false, usage30d: 71 },
    { id: 'cf-impact', label: 'Customer impact', type: 'select', appliesTo: ['INCIDENT'], required: false, usage30d: 64 },
    { id: 'cf-vendor-case', label: 'Vendor case #', type: 'text', appliesTo: ['INCIDENT', 'CHANGE'], required: false, usage30d: 22 },
    { id: 'cf-freeze', label: 'Change freeze override', type: 'select', appliesTo: ['CHANGE'], required: false, usage30d: 3 },
    { id: 'cf-approval-old', label: 'Approval reason (legacy)', type: 'text', appliesTo: ['SERVICE_REQUEST'], required: true, usage30d: 11 },
    { id: 'cf-remedy', label: 'Legacy Remedy ID', type: 'text', appliesTo: ['INCIDENT', 'SERVICE_REQUEST', 'CHANGE'], required: false, usage30d: 0 },
  ];

  const integrations: Integration[] = [
    { key: 'slack', name: 'Slack', category: 'Chat', connected: true, detail: 'Employees open and follow tickets in Slack DMs; #it-major-incidents for P1s.' },
    { key: 'teams', name: 'Microsoft Teams', category: 'Chat', connected: true, detail: 'Conversational intake bot + SOC Bridge channel.' },
    { key: 'jira', name: 'Jira Software', category: 'Dev', connected: true, detail: 'Link incidents and changes to issues and releases.' },
    { key: 'sentinel', name: 'Microsoft Sentinel', category: 'Security', connected: true, detail: 'Signed webhook → auto-correlated P1 incidents.' },
    { key: 'splunk', name: 'Splunk', category: 'Security', connected: true, detail: 'Saved-search alerts via webhook.' },
    { key: 'datadog', name: 'Datadog', category: 'Platform', connected: true, detail: 'Monitor alerts and host telemetry.' },
    { key: 'okta', name: 'Okta Workforce', category: 'Identity', connected: true, detail: 'SSO discovery, session revoke and MFA reset macros.' },
    { key: 'jamf', name: 'Jamf Pro', category: 'Endpoint', connected: true, detail: 'MDM inventory, FileVault status and remediation policies.' },
    { key: 'secret_manager', name: 'Google Cloud Secret Manager', category: 'Platform', connected: false, detail: 'Backend secrets (ANTHROPIC_API_KEY, DATABASE_URL, SIEM_WEBHOOK_SECRET, VAULT_KMS_KEY). Connects when the FastAPI backend is deployed.' },
  ];

  const aiSettings: AiSettings = {
    autonomy: 'self_service_deflection',
    confidenceThreshold: 0.8,
    sources: { knowledgeBase: true, closedTickets: true, cmdb: true, internetFallback: true },
    humanApprovalForMacros: true,
  };

  const auditLog: AuditEntry[] = [
    { id: 'aud-3', timestamp: iso(-6 * H), actor: 'Riley Park', action: 'CAB approved', entity: 'CHG-302', detail: 'Datadog agent 7.58 rollout approved (risk 38, MEDIUM).', category: 'change' },
    { id: 'aud-2', timestamp: iso(-2 * D), actor: 'Alex Rivera', action: 'Automation enabled', entity: 'auto-siem', detail: 'SIEM alert → add SOC analyst + Teams bridge.', category: 'automation' },
    { id: 'aud-1', timestamp: iso(-5 * D), actor: 'Alex Rivera', action: 'Module enabled', entity: 'password_vault', detail: 'Enterprise Password Vault turned on.', category: 'admin' },
  ];

  const timeOff: TimeOff[] = [
    { id: 'to-1', person: 'Diego Torres', type: 'PTO', start: ymd(day(0)), end: ymd(day(4)), note: 'Family trip to Sevilla', source: 'manual' },
    { id: 'to-2', person: 'Sam Okafor', type: 'Sick', start: ymd(day(0)), end: ymd(day(0)), source: 'manual' },
    { id: 'to-3', person: 'Fatima Khan', type: 'Conference', start: ymd(day(2)), end: ymd(day(3)), note: 'SaaS Ops Summit', source: 'manual' },
    { id: 'to-4', person: 'Riley Park', type: 'PTO', start: ymd(day(6)), end: ymd(day(10)), source: 'manual' },
    { id: 'to-5', person: 'Jonas Weber', type: 'Parental', start: ymd(day(15)), end: ymd(day(40)), note: 'Parental leave 🍼', source: 'manual' },
  ];

  const spotlight: SpotlightEntry[] = [
    { id: 'sp-1', kind: 'pet', name: 'Biscuit', subtitle: 'Mei Chen’s corgi', emoji: '🐶', kudos: 14, addedBy: 'Mei Chen',
      funFact: 'Attends every Friday stand-up and has never once forgotten to unmute.' },
    { id: 'sp-2', kind: 'team', name: 'Riley Park', subtitle: 'Security & SIEM', emoji: '🏃', kudos: 9, addedBy: 'Noor Haddad',
      funFact: 'Ran the London Marathon in a shirt that said “Have you tried turning it off and on again?”' },
    { id: 'sp-3', kind: 'pet', name: 'Nimbus', subtitle: 'Alex Rivera’s cat', emoji: '🐱', kudos: 21, addedBy: 'Alex Rivera',
      funFact: 'Walked across the keyboard and closed a P4 with a perfect KB link. Promoted to Junior Agent.' },
    { id: 'sp-4', kind: 'team', name: 'Mei Chen', subtitle: 'Endpoint & Mac', emoji: '🍎', kudos: 12, addedBy: 'Diego Torres',
      funFact: 'Has imaged over 1,400 MacBooks and can name every macOS release from its wallpaper.' },
    { id: 'sp-5', kind: 'pet', name: 'Pixel', subtitle: 'Fatima Khan’s parrot', emoji: '🦜', kudos: 17, addedBy: 'Fatima Khan',
      funFact: 'Greets every visitor with “Did you raise a ticket?”' },
  ];

  const selectedTools = ['slack', 'zoom', 'microsoft-365', 'google-workspace', 'okta', 'salesforce', 'github', 'jira', 'figma', 'notion', 'claude', 'cloudflare'];

  return { timeOff, spotlight, selectedTools, wishes: [] as import('@/types/platform').Wish[], closedTickets, extraTickets, changeDetails, problems, kbStats, users, slaPolicies, automations, customFields, integrations, aiSettings, auditLog };
}
