import { SLA_TARGET_SECONDS } from '@/lib/rules';
import type {
  Agent,
  AgentProfile,
  FeatureFlags,
  HardwareAsset,
  KbArticle,
  MetricsBaseline,
  SaasApp,
  SaasInactiveUser,
  TelemetryEvent,
  Ticket,
  TicketMessage,
  VaultItem,
} from '@/types/platform';

export const CURRENT_AGENT = 'Alex Rivera';

export const AGENTS: Agent[] = [
  { name: 'Alex Rivera', initials: 'AR', squad: 'Network & Identity', color: 'bg-indigo-500' },
  { name: 'Sam Okafor', initials: 'SO', squad: 'Network & Identity', color: 'bg-sky-500' },
  { name: 'Mei Chen', initials: 'MC', squad: 'Endpoint & Mac', color: 'bg-emerald-500' },
  { name: 'Diego Torres', initials: 'DT', squad: 'Endpoint & Mac', color: 'bg-amber-500' },
  { name: 'Fatima Khan', initials: 'FK', squad: 'SaaS & Cloud Ops', color: 'bg-fuchsia-500' },
  { name: 'Jonas Weber', initials: 'JW', squad: 'SaaS & Cloud Ops', color: 'bg-teal-500' },
  { name: 'Riley Park', initials: 'RP', squad: 'Security & SIEM', color: 'bg-rose-500' },
  { name: 'Noor Haddad', initials: 'NH', squad: 'Security & SIEM', color: 'bg-violet-500' },
];

export const KB_ARTICLES: KbArticle[] = [
  {
    id: 'KB-402',
    title: 'Cisco AnyConnect drops: re-push split-tunnel certificate',
    summary: 'VPN fails at IKE auth when the Okta-issued split-tunnel device certificate expires or is revoked.',
    squad: 'Network & Identity',
    steps: [
      'Confirm the device cert expiry in Jamf (Inventory → Certificates).',
      'Run macro "Push Split-Tunnel Certificate" against the asset tag.',
      'Ask the user to quit and reopen Cisco AnyConnect, then reconnect.',
      'Verify a tunnel in the ASA session log within 2 minutes.',
    ],
  },
  {
    id: 'KB-388',
    title: 'MacBook screen damage: AppleCare+ claim and loaner swap',
    summary: 'Cracked or delaminated displays are replaced under AppleCare+; issue a pre-imaged loaner same day.',
    squad: 'Endpoint & Mac',
    steps: [
      'Check AppleCare+ coverage on the asset record.',
      'Assign a pre-imaged loaner from In Stock and migrate with Jamf Setup Manager.',
      'Open the AppleCare+ repair with the serial number and ship the device.',
    ],
  },
  {
    id: 'KB-405',
    title: 'Granting a Figma Enterprise editor seat',
    summary: 'Editor seats are provisioned through the Okta "Figma Editors" group; reuse idle seats before buying.',
    squad: 'SaaS & Cloud Ops',
    steps: [
      'Check idle Figma seats in Torii; reclaim one if available.',
      'Add the user to the Okta group "Figma Editors".',
      'Confirm the seat appears in Figma Admin within 15 minutes.',
    ],
  },
  {
    id: 'KB-415',
    title: 'Salesforce SSO redirect loop after Okta session expiry',
    summary: 'Stale SAML assertions cause an infinite redirect; clearing the Okta session fixes it.',
    squad: 'SaaS & Cloud Ops',
    steps: ['Clear the user session in Okta Admin.', 'Have the user sign in via the Okta dashboard tile.'],
  },
  {
    id: 'KB-421',
    title: 'Okta SAML signing certificate rotation (emergency change)',
    summary: 'Rotating the SAML signing cert needs a CAB-approved window and coordinated SP metadata updates.',
    squad: 'Network & Identity',
    steps: [
      'Generate the new signing cert in Okta and download metadata.',
      'Stage metadata on all SPs in the change plan.',
      'Activate the new cert during the approved window; keep the old cert for rollback.',
    ],
  },
  {
    id: 'KB-430',
    title: 'MFA push-fatigue attack response',
    summary: 'Repeated denied pushes followed by an approval indicate MFA fatigue; contain before investigating.',
    squad: 'Security & SIEM',
    steps: [
      'Revoke all Okta sessions for the user and force factor re-enrolment.',
      'Isolate the endpoint via EDR if any approval succeeded.',
      'Pull Sentinel sign-in logs for source IPs and geo-velocity.',
    ],
  },
  {
    id: 'KB-377',
    title: 'Meraki Wi-Fi roaming drops on dense floors',
    summary: 'Sticky-client roaming on MR access points drops real-time calls; enable 802.11r and band steering.',
    squad: 'Network & Identity',
    steps: ['Check client roaming events in Meraki Dashboard.', 'Enable 802.11r on the SSID.', 'Ask the user to retest.'],
  },
];

const FIRST = ['Ava', 'Ben', 'Chloe', 'Dev', 'Elif', 'Finn', 'Grace', 'Hiro', 'Isla', 'Jai', 'Kofi', 'Lena', 'Mateo',
  'Nia', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sven', 'Tara', 'Uma', 'Vik', 'Wren', 'Yara', 'Zane'];
const LAST = ['Adams', 'Berg', 'Costa', 'Dubois', 'Engel', 'Fischer', 'Garcia', 'Hughes', 'Ito', 'Jensen', 'Kim',
  'Lopez', 'Moreau', 'Novak', 'Olsen', 'Patel', 'Reyes', 'Sato', 'Tanaka', 'Usman', 'Varga', 'Wong'];

function inactiveUsers(count: number, offset: number): SaasInactiveUser[] {
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST[(i * 7 + offset) % FIRST.length];
    const last = LAST[(i * 5 + offset * 3) % LAST.length];
    return {
      name: `${first} ${last}`,
      email: `${first}.${last}@adminzero.io`.toLowerCase(),
      lastSsoLoginDaysAgo: 46 + ((i * 13 + offset * 17) % 120),
    };
  });
}

function saas(
  app: Omit<SaasApp, 'annualSpend' | 'inactiveUsers' | 'activeSeats'> & { idle: number; seed: number },
): SaasApp {
  const { idle, seed, ...rest } = app;
  return {
    ...rest,
    activeSeats: rest.provisionedSeats - idle,
    inactiveUsers: inactiveUsers(idle, seed),
    annualSpend: Math.round(rest.provisionedSeats * rest.costPerSeatMonthly * 12),
  };
}

export const INITIAL_FLAGS: FeatureFlags = {
  itsm_core: true,
  ai_agents: true,
  torii_saas: true,
  itam_cmdb: true,
  password_vault: true,
};

export const INITIAL_PROFILE: AgentProfile = {
  name: CURRENT_AGENT,
  title: 'Empathy Champion',
  squad: 'Network & Identity',
  level: 14,
  xp: 2450,
  xpForNextLevel: 3000,
};

export const METRICS_BASELINE: MetricsBaseline = {
  resolvedCount: 142,
  firstContactResolved: 109,
  totalResolutionMinutes: 142 * 186,
  slaMet: 133,
  slaTotal: 142,
};

export interface SeedState {
  tickets: Ticket[];
  slaAnchors: Record<string, number>;
  assets: HardwareAsset[];
  saasApps: SaasApp[];
  vault: VaultItem[];
  telemetry: TelemetryEvent[];
  kbArticles: KbArticle[];
}

export function createSeedState(now: number = Date.now()): SeedState {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const daysFromNow = (d: number) => new Date(now + d * 86_400_000).toISOString().slice(0, 10);
  let n = 0;
  const msg = (m: Omit<TicketMessage, 'id' | 'timestamp'> & { minAgo: number }): TicketMessage => {
    const { minAgo, ...rest } = m;
    n += 1;
    return { id: `msg-${n}`, timestamp: ago(minAgo), ...rest };
  };
  const remaining = (p: Ticket['priority'], elapsedMin: number) => SLA_TARGET_SECONDS[p] - elapsedMin * 60;

  const tickets: Ticket[] = [
    {
      id: 'INC-1049',
      type: 'INCIDENT',
      templateId: '#INC-NET-04',
      title: 'VPN failing before client pitch in 45 minutes',
      requesterName: 'María González',
      requesterEmail: 'maria.gonzalez@adminzero.io',
      detectedLanguage: 'es',
      channel: 'Slack',
      priority: 'P1',
      sentiment: 'Urgent Client Impact',
      status: 'ACTIVE_SWARM',
      swarmSquad: 'Network & Identity',
      activeSwarmAgents: ['Alex Rivera', 'Sam Okafor'],
      slaRemainingSeconds: remaining('P1', 38),
      slaPaused: false,
      linkedAssetId: 'MBP-0942',
      linkedKbId: undefined,
      linkedJiraIssue: 'NET-882',
      recommendedMacro: {
        id: 'macro-push-split-tunnel',
        label: 'Push Split-Tunnel Certificate to MBP-0942',
        command: 'jamf policy -event push-anyconnect-cert -serial C02FK3ZHMD6T',
      },
      messages: [
        msg({
          sender: 'María González', role: 'end_user', originalLang: 'es', minAgo: 38,
          originalText: 'Hola, no puedo conectarme a la VPN desde esta mañana y tengo una presentación con un cliente en 45 minutos.',
          translatedText: "Hi, I haven't been able to connect to the VPN since this morning and I have a client presentation in 45 minutes.",
        }),
        msg({
          sender: 'AdminZero AI', role: 'ai_system', originalLang: 'en', minAgo: 37,
          originalText: 'Mapped to #INC-NET-04 (VPN connectivity). Priority P1: client-facing deadline under 1 hour. Attached MBP-0942 from CMDB. Routed to Network & Identity swarm.',
          metadata: { confidence: '0.97', template: '#INC-NET-04' },
        }),
        msg({
          sender: 'Pre-check Bot', role: 'diagnostic_telemetry', originalLang: 'en', minAgo: 36,
          originalText: 'Okta device trust: PASS · Cisco AnyConnect 5.1.2: IKE auth FAILED · Split-tunnel cert CN=MBP-0942 expired 09:12 UTC.',
          metadata: { source: 'Jamf + Okta', asset: 'MBP-0942', result: 'cert_expired' },
        }),
        msg({
          sender: 'Sam Okafor', role: 'agent', originalLang: 'en', minAgo: 30,
          originalText: 'Joined swarm. Cert expiry matches KB-402 pattern — macro is queued for approval.',
          metadata: { visibility: 'internal' },
        }),
      ],
    },
    {
      id: 'INC-1046',
      type: 'INCIDENT',
      templateId: '#SR-HW-01',
      title: 'Cracked MacBook Pro screen, needs loaner before Thursday trip',
      requesterName: 'Camille Laurent',
      requesterEmail: 'camille.laurent@adminzero.io',
      detectedLanguage: 'fr',
      channel: 'MS Teams',
      priority: 'P2',
      sentiment: 'Frustrated',
      status: 'AI_TRIAGED',
      swarmSquad: 'Endpoint & Mac',
      activeSwarmAgents: ['Mei Chen'],
      slaRemainingSeconds: remaining('P2', 95),
      slaPaused: false,
      linkedAssetId: 'MBP-1004',
      recommendedMacro: {
        id: 'macro-assign-loaner',
        label: 'Assign pre-imaged loaner & open AppleCare+ claim',
        command: 'jamf setup-manager assign --loaner MBP-1120 --migrate-from MBP-1004 && applecare claim --serial C02GT1ABQ05D',
      },
      messages: [
        msg({
          sender: 'Camille Laurent', role: 'end_user', originalLang: 'fr', minAgo: 95,
          originalText: "Bonjour, mon écran MacBook Pro est fissuré, j'ai besoin d'un ordinateur de prêt avant mon déplacement jeudi.",
          translatedText: 'Hello, my MacBook Pro screen is cracked, I need a loaner computer before my trip on Thursday.',
        }),
        msg({
          sender: 'AdminZero AI', role: 'ai_system', originalLang: 'en', minAgo: 94,
          originalText: 'Mapped to #SR-HW-01 (hardware damage). AppleCare+ active on MBP-1004 until 2027-03-14. Loaner MBP-1120 available In Stock.',
          metadata: { confidence: '0.94', template: '#SR-HW-01' },
        }),
      ],
    },
    {
      id: 'SR-2088',
      type: 'SERVICE_REQUEST',
      templateId: '#SR-SAAS-09',
      title: 'Figma editor licence for next week’s design sprint',
      requesterName: 'Haruto Tanaka',
      requesterEmail: 'haruto.tanaka@adminzero.io',
      detectedLanguage: 'ja',
      channel: 'Portal',
      priority: 'P3',
      sentiment: 'Calm',
      status: 'AI_TRIAGED',
      swarmSquad: 'SaaS & Cloud Ops',
      activeSwarmAgents: ['Fatima Khan'],
      slaRemainingSeconds: remaining('P3', 140),
      slaPaused: false,
      linkedSaasId: 'saas-figma',
      recommendedMacro: {
        id: 'macro-reclaim-and-grant-figma',
        label: 'Reuse an idle Figma seat for Haruto',
        command: 'okta groups add "Figma Editors" haruto.tanaka@adminzero.io --reuse-idle-seat',
      },
      messages: [
        msg({
          sender: 'Haruto Tanaka', role: 'end_user', originalLang: 'ja', minAgo: 140,
          originalText: '来週のデザインスプリントのためにFigmaの編集ライセンスを付与してください。',
          translatedText: "Please grant me a Figma editor licence for next week's design sprint.",
        }),
        msg({
          sender: 'AdminZero AI', role: 'ai_system', originalLang: 'en', minAgo: 139,
          originalText: 'Mapped to #SR-SAAS-09 (SaaS access). Torii shows 7 idle Figma Enterprise seats — no new purchase needed. Manager approval auto-granted (standard catalogue item).',
          metadata: { confidence: '0.98', template: '#SR-SAAS-09' },
        }),
      ],
    },
    {
      id: 'CHG-301',
      type: 'CHANGE',
      templateId: '#CHG-SEC-02',
      title: 'Emergency Okta SAML certificate rotation tonight 22:00',
      requesterName: 'Lukas Becker',
      requesterEmail: 'lukas.becker@adminzero.io',
      detectedLanguage: 'de',
      channel: 'Email',
      priority: 'P2',
      sentiment: 'Urgent Client Impact',
      status: 'WAITING_ON_VENDOR',
      swarmSquad: 'Network & Identity',
      activeSwarmAgents: ['Sam Okafor', 'Riley Park'],
      slaRemainingSeconds: remaining('P2', 210),
      slaPaused: true,
      linkedSaasId: 'saas-okta',
      linkedJiraIssue: 'IAM-412',
      messages: [
        msg({
          sender: 'Lukas Becker', role: 'end_user', originalLang: 'de', minAgo: 260,
          originalText: 'Wir benötigen heute Abend um 22:00 Uhr ein Notfall-Wartungsfenster für das Okta SAML-Zertifikat.',
          translatedText: 'We need an emergency maintenance window tonight at 22:00 for the Okta SAML certificate.',
        }),
        msg({
          sender: 'AdminZero AI', role: 'ai_system', originalLang: 'en', minAgo: 259,
          originalText: 'Mapped to #CHG-SEC-02 (emergency security change). CAB risk score 64 (HIGH): 14 SAML service providers affected. Linked to Jira IAM-412.',
          metadata: { confidence: '0.92', template: '#CHG-SEC-02', cabRisk: '64' },
        }),
        msg({
          sender: 'Sam Okafor', role: 'agent', originalLang: 'en', minAgo: 50,
          originalText: 'Waiting on Okta support case #04418832 to confirm the new signing cert can be staged without session invalidation. SLA paused.',
          metadata: { visibility: 'internal' },
        }),
      ],
    },
    {
      id: 'INC-1047',
      type: 'INCIDENT',
      templateId: '#INC-SEC-01',
      title: 'Sentinel: MFA push-fatigue pattern for Priya Shah',
      requesterName: 'Microsoft Sentinel',
      requesterEmail: 'soc-alerts@adminzero.io',
      detectedLanguage: 'en',
      channel: 'SIEM Webhook',
      priority: 'P1',
      sentiment: 'Urgent Client Impact',
      status: 'ACTIVE_SWARM',
      swarmSquad: 'Security & SIEM',
      activeSwarmAgents: ['Riley Park', 'Noor Haddad'],
      slaRemainingSeconds: remaining('P1', 72),
      slaPaused: false,
      linkedAssetId: 'MBP-1188',
      recommendedMacro: {
        id: 'macro-revoke-okta-sessions',
        label: 'Revoke Okta sessions & force MFA re-enrolment',
        command: 'okta users sessions revoke priya.shah@adminzero.io && okta factors reset priya.shah@adminzero.io',
      },
      messages: [
        msg({
          sender: 'Microsoft Sentinel', role: 'diagnostic_telemetry', originalLang: 'en', minAgo: 72,
          originalText: 'Analytics rule "MFA fatigue": 23 denied Okta Verify pushes in 6 minutes, followed by 1 approval from 185.220.101.4 (TOR exit).',
          metadata: { source: 'Microsoft Sentinel', severity: 'High', asset: 'MBP-1188' },
        }),
        msg({
          sender: 'AdminZero AI', role: 'ai_system', originalLang: 'en', minAgo: 71,
          originalText: 'Correlated with CMDB asset MBP-1188 (Priya Shah). No open tickets on the asset. Created P1 for Security & SIEM swarm. Suggested runbook KB-430.',
        }),
      ],
    },
    {
      id: 'INC-1045',
      type: 'INCIDENT',
      templateId: '#INC-NET-07',
      title: 'Slack huddles dropping on 3rd-floor Wi-Fi',
      requesterName: 'Lucas Silva',
      requesterEmail: 'lucas.silva@adminzero.io',
      detectedLanguage: 'pt',
      channel: 'Slack',
      priority: 'P3',
      sentiment: 'Frustrated',
      status: 'WAITING_ON_CUSTOMER',
      swarmSquad: 'Network & Identity',
      activeSwarmAgents: ['Alex Rivera'],
      slaRemainingSeconds: remaining('P3', 300),
      slaPaused: true,
      linkedAssetId: 'MERAKI-SW-01',
      messages: [
        msg({
          sender: 'Lucas Silva', role: 'end_user', originalLang: 'pt', minAgo: 340,
          originalText: 'As chamadas no Slack caem toda vez que ando pelo terceiro andar.',
          translatedText: 'Slack calls drop every time I walk around the third floor.',
        }),
        msg({
          sender: 'Alex Rivera', role: 'agent', originalLang: 'en', minAgo: 120,
          originalText: 'Enabled 802.11r on the Corp SSID per KB-377. Could you walk the floor during a huddle and tell me if it still drops?',
          translatedText: 'Ativei o 802.11r na rede Corp conforme o KB-377. Você pode andar pelo andar durante uma chamada e me dizer se ainda cai?',
        }),
      ],
    },
    {
      id: 'SR-2087',
      type: 'SERVICE_REQUEST',
      templateId: '#SR-SAAS-11',
      title: 'Approve Notion AI for Marketing (currently expensed)',
      requesterName: 'Grace Hughes',
      requesterEmail: 'grace.hughes@adminzero.io',
      detectedLanguage: 'en',
      channel: 'Portal',
      priority: 'P4',
      sentiment: 'Calm',
      status: 'ACTIVE_SWARM',
      swarmSquad: 'SaaS & Cloud Ops',
      activeSwarmAgents: ['Jonas Weber'],
      slaRemainingSeconds: remaining('P4', 900),
      slaPaused: false,
      linkedSaasId: 'saas-notion',
      messages: [
        msg({
          sender: 'Grace Hughes', role: 'end_user', originalLang: 'en', minAgo: 900,
          originalText: 'Marketing has been using Notion AI on our cards for a month. Can IT make it official so we stop expensing it?',
        }),
        msg({
          sender: 'AdminZero AI', role: 'ai_system', originalLang: 'en', minAgo: 899,
          originalText: 'Torii flagged Notion AI as Shadow IT: 23 users, OAuth scope "Google Drive (read all)" — HIGH risk. Requires security review before SSO onboarding.',
        }),
      ],
    },
    {
      id: 'INC-1044',
      type: 'INCIDENT',
      templateId: '#INC-SAAS-03',
      title: 'Salesforce stuck in SSO redirect loop',
      requesterName: 'Omar Usman',
      requesterEmail: 'omar.usman@adminzero.io',
      detectedLanguage: 'en',
      channel: 'MS Teams',
      priority: 'P2',
      sentiment: 'Frustrated',
      status: 'RESOLVED_KB_LINKED',
      swarmSquad: 'SaaS & Cloud Ops',
      activeSwarmAgents: ['Fatima Khan'],
      slaRemainingSeconds: remaining('P2', 42),
      slaPaused: false,
      linkedSaasId: 'saas-salesforce',
      linkedKbId: 'KB-415',
      messages: [
        msg({
          sender: 'Omar Usman', role: 'end_user', originalLang: 'en', minAgo: 180,
          originalText: 'Salesforce keeps bouncing me between Okta and the login page. I have a forecast call at 3.',
        }),
        msg({
          sender: 'Fatima Khan', role: 'agent', originalLang: 'en', minAgo: 150,
          originalText: 'Cleared your Okta session — please open Salesforce from the Okta dashboard tile. Resolved via KB-415.',
          metadata: { resolution: 'KB-415' },
        }),
      ],
    },
  ];

  const assets: HardwareAsset[] = [
    {
      id: 'MBP-0942', name: 'MacBook Pro 14" M3 Pro', model: 'Mac15,6', category: 'Laptop',
      serialNumber: 'C02FK3ZHMD6T', assignedTo: 'María González', assignedEmail: 'maria.gonzalez@adminzero.io',
      lifecycle: 'Deployed', mdmEnrolled: true, fileVault: 'Encrypted', osVersion: 'macOS 15.4',
      appleCareExpires: '2027-08-02', location: 'Madrid · Remote',
      specs: { CPU: 'M3 Pro 12-core', Memory: '36 GB', Storage: '1 TB SSD' },
      installedSoftware: ['Cisco AnyConnect 5.1.2', 'Okta Verify 9.3', 'Slack 4.41', 'Microsoft Office 16.88', 'CrowdStrike Falcon 7.14'],
      linkedTicketIds: ['INC-1049'],
    },
    {
      id: 'MBP-1004', name: 'MacBook Pro 16" M3 Max', model: 'Mac15,9', category: 'Laptop',
      serialNumber: 'C02GT1ABQ05D', assignedTo: 'Camille Laurent', assignedEmail: 'camille.laurent@adminzero.io',
      lifecycle: 'In Repair', mdmEnrolled: true, fileVault: 'Encrypted', osVersion: 'macOS 15.3',
      appleCareExpires: '2027-03-14', location: 'Paris HQ',
      specs: { CPU: 'M3 Max 16-core', Memory: '48 GB', Storage: '2 TB SSD' },
      installedSoftware: ['Figma 124.4', 'Adobe Creative Cloud 6.4', 'Okta Verify 9.3', 'CrowdStrike Falcon 7.14'],
      linkedTicketIds: ['INC-1046'],
    },
    {
      id: 'MBP-1188', name: 'MacBook Air 13" M3', model: 'Mac15,12', category: 'Laptop',
      serialNumber: 'FVFHK2Q1Q6L4', assignedTo: 'Priya Shah', assignedEmail: 'priya.shah@adminzero.io',
      lifecycle: 'Deployed', mdmEnrolled: true, fileVault: 'Encrypted', osVersion: 'macOS 15.4',
      appleCareExpires: '2026-12-30', location: 'London',
      specs: { CPU: 'M3 8-core', Memory: '16 GB', Storage: '512 GB SSD' },
      installedSoftware: ['Okta Verify 9.3', 'Salesforce Desktop', 'Slack 4.41', 'CrowdStrike Falcon 7.14'],
      linkedTicketIds: ['INC-1047'],
    },
    {
      id: 'MBP-1120', name: 'MacBook Pro 14" M3 (Loaner)', model: 'Mac15,3', category: 'Laptop',
      serialNumber: 'C02HN8LLMD6R', assignedTo: null, assignedEmail: null,
      lifecycle: 'In Stock', mdmEnrolled: true, fileVault: 'Encrypted', osVersion: 'macOS 15.4',
      appleCareExpires: '2028-01-19', location: 'Paris HQ · IT Bar',
      specs: { CPU: 'M3 8-core', Memory: '24 GB', Storage: '1 TB SSD' },
      installedSoftware: ['Standard loaner image 2026.10'],
      linkedTicketIds: [],
    },
    {
      id: 'MERAKI-SW-01', name: 'Meraki MS250-48FP Core Switch', model: 'MS250-48FP', category: 'Network',
      serialNumber: 'Q2QN-7Y4L-9TZK', assignedTo: null, assignedEmail: null,
      lifecycle: 'Deployed', mdmEnrolled: false, fileVault: 'N/A', osVersion: 'MS 16.8',
      appleCareExpires: null, location: 'Lisbon · Floor 3 IDF',
      specs: { Ports: '48× 1GbE PoE+', Uplinks: '4× 10GbE SFP+', 'PoE budget': '740 W' },
      installedSoftware: ['Meraki MS firmware 16.8'],
      linkedTicketIds: ['INC-1045'],
    },
    {
      id: 'IPH-0311', name: 'iPhone 15 Pro', model: 'iPhone16,1', category: 'Mobile',
      serialNumber: 'F4GZK9P2N7', assignedTo: 'Lukas Becker', assignedEmail: 'lukas.becker@adminzero.io',
      lifecycle: 'Procured', mdmEnrolled: false, fileVault: 'N/A', osVersion: 'iOS 18.4',
      appleCareExpires: '2028-05-01', location: 'Berlin · in transit',
      specs: { Storage: '256 GB', Carrier: 'eSIM · Telekom' },
      installedSoftware: [],
      linkedTicketIds: [],
    },
  ];

  const saasApps: SaasApp[] = [
    saas({ id: 'saas-figma', name: 'Figma Enterprise', vendor: 'Figma', category: 'Design', approved: true,
      discoveredVia: 'Okta SSO', provisionedSeats: 48, costPerSeatMonthly: 75, renewalDate: daysFromNow(21),
      oauthRisk: 'Low', owner: 'Design Ops', idle: 7, seed: 1 }),
    saas({ id: 'saas-notion', name: 'Notion AI (Shadow IT)', vendor: 'Notion Labs', category: 'Productivity',
      approved: false, discoveredVia: 'Expense Report', provisionedSeats: 23, costPerSeatMonthly: 20,
      renewalDate: daysFromNow(9), oauthRisk: 'High', owner: 'Unassigned (Marketing)', idle: 5, seed: 2 }),
    saas({ id: 'saas-okta', name: 'Okta Workforce', vendor: 'Okta', category: 'Identity', approved: true,
      discoveredVia: 'Okta SSO', provisionedSeats: 410, costPerSeatMonthly: 6, renewalDate: daysFromNow(200),
      oauthRisk: 'Low', owner: 'IAM', idle: 8, seed: 3 }),
    saas({ id: 'saas-salesforce', name: 'Salesforce Sales Cloud', vendor: 'Salesforce', category: 'CRM', approved: true,
      discoveredVia: 'Okta SSO', provisionedSeats: 85, costPerSeatMonthly: 165, renewalDate: daysFromNow(14),
      oauthRisk: 'Medium', owner: 'RevOps', idle: 12, seed: 4 }),
    saas({ id: 'saas-slack', name: 'Slack Pro', vendor: 'Salesforce', category: 'Collaboration', approved: true,
      discoveredVia: 'Okta SSO', provisionedSeats: 420, costPerSeatMonthly: 8.75, renewalDate: daysFromNow(120),
      oauthRisk: 'Low', owner: 'IT', idle: 18, seed: 5 }),
    saas({ id: 'saas-datadog', name: 'Datadog', vendor: 'Datadog', category: 'Observability', approved: true,
      discoveredVia: 'Google OAuth', provisionedSeats: 30, costPerSeatMonthly: 23, renewalDate: daysFromNow(45),
      oauthRisk: 'Medium', owner: 'Platform Eng', idle: 3, seed: 6 }),
  ];

  const vault: VaultItem[] = [
    { id: 'vault-la-mbp0942', name: 'Local Admin · MBP-0942', kind: 'Local Admin', scope: 'MBP-0942',
      allowedSquads: ['Endpoint & Mac', 'Network & Identity'], rotationDays: 1, lastRotated: ago(300), activeGrant: null },
    { id: 'vault-meraki', name: 'Meraki Dashboard Org Admin', kind: 'Network Device', scope: 'MERAKI-SW-01',
      allowedSquads: ['Network & Identity'], rotationDays: 30, lastRotated: ago(60 * 24 * 12), activeGrant: null },
    { id: 'vault-prod-db', name: 'Production Postgres (billing)', kind: 'Database', scope: 'pg-prod-billing-01',
      allowedSquads: ['SaaS & Cloud Ops'], rotationDays: 7, lastRotated: ago(60 * 24 * 3), activeGrant: null },
    { id: 'vault-okta-api', name: 'Okta Super Admin API Token', kind: 'API Key', scope: 'okta-tenant-prod',
      allowedSquads: ['Network & Identity', 'Security & SIEM'], rotationDays: 14, lastRotated: ago(60 * 24 * 6), activeGrant: null },
    { id: 'vault-sentinel-sp', name: 'Sentinel SOAR Service Principal', kind: 'Infrastructure', scope: 'azure-sentinel-prod',
      allowedSquads: ['Security & SIEM'], rotationDays: 30, lastRotated: ago(60 * 24 * 20), activeGrant: null },
  ];

  const telemetry: TelemetryEvent[] = [
    { id: 'evt-6', source: 'Microsoft Sentinel', severity: 'high', title: 'MFA push-fatigue pattern',
      detail: '23 denied pushes then 1 approval from TOR exit 185.220.101.4', assetId: 'MBP-1188', ticketId: 'INC-1047', timestamp: ago(72) },
    { id: 'evt-5', source: 'Jamf', severity: 'medium', title: 'Device certificate expired',
      detail: 'AnyConnect split-tunnel cert on MBP-0942 expired 09:12 UTC', assetId: 'MBP-0942', ticketId: 'INC-1049', timestamp: ago(36) },
    { id: 'evt-4', source: 'Torii', severity: 'medium', title: 'Shadow IT detected',
      detail: 'Notion AI: 23 users via expense reports, OAuth scope Google Drive (read all)', timestamp: ago(240) },
    { id: 'evt-3', source: 'Datadog', severity: 'info', title: 'Okta SSO latency normal',
      detail: 'p95 auth latency 410 ms (baseline 450 ms)', timestamp: ago(15) },
    { id: 'evt-2', source: 'Okta', severity: 'info', title: 'SAML cert expiry warning',
      detail: 'Signing cert for 14 service providers expires in 6 days — linked CHG-301', ticketId: 'CHG-301', timestamp: ago(300) },
    { id: 'evt-1', source: 'Splunk', severity: 'info', title: 'Meraki roaming events normalised',
      detail: 'Floor 3 roaming failures dropped 82% after 802.11r enablement', assetId: 'MERAKI-SW-01', timestamp: ago(90) },
  ];

  const slaAnchors = Object.fromEntries(tickets.map((t) => [t.id, now]));
  return { tickets, slaAnchors, assets, saasApps, vault, telemetry, kbArticles: KB_ARTICLES };
}
