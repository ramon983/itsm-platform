/**
 * Tools with public status pages. `api` tells the status poller how to read live status from the browser:
 *  - statuspage: Atlassian Statuspage `/api/v2/summary.json` (CORS-enabled; verified 2026-11)
 *  - slack / salesforce: vendor-specific public JSON APIs (CORS-enabled)
 *  - link: no public browser-readable API — we show a link to the official status page, never a guessed status.
 */
export type ToolCategory = 'Collaboration' | 'Identity & Security' | 'Productivity' | 'Dev & Cloud' | 'Sales & Support' | 'Design' | 'AI';

export interface ToolDef {
  id: string;
  name: string;
  category: ToolCategory;
  statusUrl: string; // human status page
  api: 'statuspage' | 'slack' | 'salesforce' | 'link';
  apiUrl?: string;
}

const sp = (id: string, name: string, category: ToolCategory, host: string): ToolDef => ({
  id, name, category, statusUrl: `https://${host}`, api: 'statuspage', apiUrl: `https://${host}/api/v2/summary.json`,
});
const link = (id: string, name: string, category: ToolCategory, statusUrl: string): ToolDef => ({ id, name, category, statusUrl, api: 'link' });

export const TOOL_CATALOG: ToolDef[] = [
  // Collaboration
  { id: 'slack', name: 'Slack', category: 'Collaboration', statusUrl: 'https://slack-status.com', api: 'slack', apiUrl: 'https://slack-status.com/api/v2.0.0/current' },
  sp('zoom', 'Zoom', 'Collaboration', 'www.zoomstatus.com'),
  link('microsoft-365', 'Microsoft 365 / Teams', 'Collaboration', 'https://status.cloud.microsoft'),
  link('google-workspace', 'Google Workspace', 'Collaboration', 'https://www.google.com/appsstatus/dashboard/'),
  sp('discord', 'Discord', 'Collaboration', 'discordstatus.com'),
  link('webex', 'Webex', 'Collaboration', 'https://status.webex.com'),
  sp('confluence', 'Confluence', 'Collaboration', 'confluence.status.atlassian.com'),
  sp('loom', 'Loom', 'Collaboration', 'loom.status.atlassian.com'),
  sp('calendly', 'Calendly', 'Collaboration', 'calendlystatus.com'),
  // Identity & Security
  link('okta', 'Okta', 'Identity & Security', 'https://status.okta.com'),
  sp('1password', '1Password', 'Identity & Security', 'status.1password.com'),
  link('crowdstrike', 'CrowdStrike', 'Identity & Security', 'https://status.crowdstrike.com'),
  link('microsoft-entra', 'Microsoft Entra ID', 'Identity & Security', 'https://azure.status.microsoft/status'),
  // Productivity
  sp('notion', 'Notion', 'Productivity', 'www.notion-status.com'),
  sp('asana', 'Asana', 'Productivity', 'status.asana.com'),
  sp('monday', 'monday.com', 'Productivity', 'status.monday.com'),
  sp('smartsheet', 'Smartsheet', 'Productivity', 'status.smartsheet.com'),
  sp('airtable', 'Airtable', 'Productivity', 'status.airtable.com'),
  sp('trello', 'Trello', 'Productivity', 'trello.status.atlassian.com'),
  sp('dropbox', 'Dropbox', 'Productivity', 'status.dropbox.com'),
  sp('box', 'Box', 'Productivity', 'status.box.com'),
  sp('grammarly', 'Grammarly', 'Productivity', 'status.grammarly.com'),
  link('docusign', 'DocuSign', 'Productivity', 'https://status.docusign.com'),
  link('workday', 'Workday', 'Productivity', 'https://status.workday.com'),
  // Dev & Cloud
  sp('github', 'GitHub', 'Dev & Cloud', 'www.githubstatus.com'),
  sp('jira', 'Jira', 'Dev & Cloud', 'jira-software.status.atlassian.com'),
  sp('bitbucket', 'Bitbucket', 'Dev & Cloud', 'bitbucket.status.atlassian.com'),
  sp('cloudflare', 'Cloudflare', 'Dev & Cloud', 'www.cloudflarestatus.com'),
  sp('vercel', 'Vercel', 'Dev & Cloud', 'www.vercel-status.com'),
  sp('netlify', 'Netlify', 'Dev & Cloud', 'www.netlifystatus.com'),
  sp('digitalocean', 'DigitalOcean', 'Dev & Cloud', 'status.digitalocean.com'),
  sp('sentry', 'Sentry', 'Dev & Cloud', 'status.sentry.io'),
  sp('postman', 'Postman', 'Dev & Cloud', 'status.postman.com'),
  sp('npm', 'npm', 'Dev & Cloud', 'status.npmjs.org'),
  sp('twilio', 'Twilio', 'Dev & Cloud', 'status.twilio.com'),
  link('aws', 'AWS', 'Dev & Cloud', 'https://health.aws.amazon.com/health/status'),
  link('azure', 'Microsoft Azure', 'Dev & Cloud', 'https://azure.status.microsoft/status'),
  link('google-cloud', 'Google Cloud', 'Dev & Cloud', 'https://status.cloud.google.com'),
  link('datadog', 'Datadog', 'Dev & Cloud', 'https://status.datadoghq.com'),
  link('pagerduty', 'PagerDuty', 'Dev & Cloud', 'https://status.pagerduty.com'),
  link('gitlab', 'GitLab', 'Dev & Cloud', 'https://status.gitlab.com'),
  link('fastly', 'Fastly', 'Dev & Cloud', 'https://www.fastlystatus.com'),
  // Sales & Support
  { id: 'salesforce', name: 'Salesforce', category: 'Sales & Support', statusUrl: 'https://status.salesforce.com', api: 'salesforce', apiUrl: 'https://api.status.salesforce.com/v1/incidents/active' },
  sp('hubspot', 'HubSpot', 'Sales & Support', 'status.hubspot.com'),
  link('zendesk', 'Zendesk', 'Sales & Support', 'https://status.zendesk.com'),
  link('intercom', 'Intercom', 'Sales & Support', 'https://www.intercomstatus.com'),
  link('stripe', 'Stripe', 'Sales & Support', 'https://status.stripe.com'),
  link('mailchimp', 'Mailchimp', 'Sales & Support', 'https://status.mailchimp.com'),
  // Design
  sp('figma', 'Figma', 'Design', 'status.figma.com'),
  sp('miro', 'Miro', 'Design', 'status.miro.com'),
  sp('canva', 'Canva', 'Design', 'www.canvastatus.com'),
  sp('webflow', 'Webflow', 'Design', 'status.webflow.com'),
  link('adobe', 'Adobe Creative Cloud', 'Design', 'https://status.adobe.com'),
  // AI
  sp('claude', 'Claude (Anthropic)', 'AI', 'status.claude.com'),
  sp('openai', 'OpenAI', 'AI', 'status.openai.com'),
];

export const TOOL_BY_ID = Object.fromEntries(TOOL_CATALOG.map((t) => [t.id, t]));
