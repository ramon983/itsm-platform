import { describe, expect, it, vi } from 'vitest';

import { TOOL_BY_ID } from '@/data/tools';
import { fetchHolidays, upcomingHolidays } from '@/lib/holidays';
import { celebrations, exportIcs, importIcs, onCallNow, ymd } from '@/lib/people';
import { SWARM_SQUADS } from '@/lib/rules';
import { fetchToolStatus, parseSlack, parseStatuspage } from '@/lib/toolStatus';
import type { PlatformUser, TimeOff } from '@/types/platform';

const NOW = new Date(2026, 10, 18, 10).getTime(); // Wed 18 Nov 2026, 10:00 local
const user = (name: string, extra: Partial<PlatformUser> = {}): PlatformUser => ({
  name, email: `${name.toLowerCase().replace(' ', '.')}@adminzero.io`, role: 'Agent', squad: 'Network & Identity', active: true, country: 'US', timezone: 'UTC', ...extra,
});

describe('tool status', () => {
  const summary = {
    status: { indicator: 'minor', description: 'Minor Service Outage' },
    components: [
      { name: 'API', status: 'operational', group: false },
      { name: 'Replicate', status: 'degraded_performance', group: false },
      { name: 'Platform', status: 'partial_outage', group: true },
    ],
    incidents: [{ name: 'Errors on some models', status: 'identified', impact: 'minor', shortlink: 'https://x/i/1', updated_at: '2026-11-17T16:32:13Z',
      incident_updates: [{ body: 'The issue has been identified.' }], components: [{ name: 'Replicate' }] }],
    scheduled_maintenances: [],
  } as const;

  it('normalises Statuspage summaries and lists what is down (groups excluded)', () => {
    const s = parseStatuspage('cloudflare', JSON.parse(JSON.stringify(summary)), 'now');
    expect(s.level).toBe('degraded');
    expect(s.affectedComponents).toEqual([{ name: 'Replicate', status: 'degraded performance' }]);
    expect(s.incidents[0]).toMatchObject({ name: 'Errors on some models', latestUpdate: 'The issue has been identified.', components: ['Replicate'] });
  });

  it('maps Slack outages to major outage', () => {
    const s = parseSlack('slack', { status: 'active', active_incidents: [{ title: 'Messages failing', type: 'outage', status: 'active', services: ['Messaging'] }] }, 'now');
    expect(s.level).toBe('major_outage');
    expect(s.affectedComponents[0]!.name).toBe('Messaging');
  });

  it('never guesses: link-only tools and unreachable APIs say so', async () => {
    expect((await fetchToolStatus(TOOL_BY_ID['okta']!)).level).toBe('link_only');
    const failing = vi.fn(() => Promise.reject(new Error('boom'))) as unknown as typeof fetch;
    expect(await fetchToolStatus(TOOL_BY_ID['github']!, failing)).toMatchObject({ level: 'unknown', error: 'boom' });
  });
});

describe('celebrations', () => {
  it('shows this week’s birthdays and anniversaries all week, and upcoming ones after', () => {
    const list = celebrations([
      user('Mei Chen', { birthday: '11-18', startDate: '2020-11-20' }), // today + anniversary Friday (6 years)
      user('Diego Torres', { birthday: '11-16' }), // Monday — still this week
      user('Priya Shah', { birthday: '12-02' }), // upcoming
      user('Old Timer', { birthday: '02-01' }), // too far out
      user('New Joiner', { startDate: '2026-11-19' }), // joined this year — no anniversary yet
    ], NOW);
    expect(list.map((c) => `${c.person.name.split(' ')[0]}:${c.occasion}:${c.when}`)).toEqual([
      'Diego:birthday:this_week', 'Mei:birthday:today', 'Mei:anniversary:this_week', 'Priya:birthday:upcoming',
    ]);
    expect(list.find((c) => c.occasion === 'anniversary')!.years).toBe(6);
  });
});

describe('on-call', () => {
  it('rotates weekly and has the secondary cover when the primary is out', () => {
    const team = [user('Alex Rivera'), user('Sam Okafor')];
    const base = onCallNow(team, [], SWARM_SQUADS, NOW)[0]!;
    expect(base.covering).toBeNull();
    const out: TimeOff[] = [{ id: 't', person: base.primary.name, type: 'Sick', start: ymd(new Date(NOW)), end: ymd(new Date(NOW)), source: 'manual' }];
    const covered = onCallNow(team, out, SWARM_SQUADS, NOW)[0]!;
    expect(covered.covering!.name).toBe(base.secondary!.name);
    const nextWeek = onCallNow(team, [], SWARM_SQUADS, NOW + 7 * 86_400_000)[0]!;
    expect(nextWeek.primary.name).toBe(base.secondary!.name);
    expect(base.handoverAt.getDay()).toBe(1); // Monday handover
  });
});

describe('.ics calendar', () => {
  it('round-trips team time off', () => {
    const entries: TimeOff[] = [{ id: 'a', person: 'Diego Torres', type: 'PTO', start: '2026-11-18', end: '2026-11-22', note: 'Sevilla, family', source: 'manual' }];
    const ics = exportIcs(entries, [{ date: '2026-12-25', name: 'Christmas Day', country: 'ES' }]);
    expect(ics).toContain('DTEND;VALUE=DATE:20261123'); // exclusive end
    const back = importIcs(ics, ['Diego Torres']);
    expect(back.entries).toEqual([{ person: 'Diego Torres', type: 'PTO', start: '2026-11-18', end: '2026-11-22', note: 'Diego Torres — PTO (Sevilla, family)', source: 'ics' }]);
    expect(back.unmatched).toEqual(['Christmas Day (ES)']);
  });

  it('reads Google/Outlook exports with folded lines and attendee names', () => {
    const google = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261203',
      'SUMMARY:Out of office - KubeCon conference trip with the platform team and some very long', ' text that wraps',
      'ATTENDEE;CN=Fatima Khan:mailto:fatima.khan@adminzero.io', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const r = importIcs(google, ['Fatima Khan', 'Sam Okafor']);
    expect(r.entries[0]).toMatchObject({ person: 'Fatima Khan', type: 'Conference', start: '2026-12-01', end: '2026-12-02' });
  });
});

describe('holidays', () => {
  it('keeps national holidays only and caches per country/year', async () => {
    localStorage.clear();
    const fake = vi.fn(async () => new Response(JSON.stringify([
      { date: '2026-12-25', name: 'Christmas Day', localName: 'Navidad', global: true },
      { date: '2026-12-26', name: 'St. Stephen', localName: 'Sant Esteve', global: false },
    ]), { status: 200 })) as unknown as typeof fetch;
    const list = await fetchHolidays('ES', 2026, fake);
    expect(list.map((h) => h.name)).toEqual(['Christmas Day']);
    await fetchHolidays('ES', 2026, fake);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('uses the built-in list for India and reports failing countries without breaking others', async () => {
    localStorage.clear();
    const fake = vi.fn(async () => new Response('err', { status: 500 })) as unknown as typeof fetch;
    const r = await upcomingHolidays(['IN', 'FR'], '2026-12-01', 60, fake);
    expect(r.holidays.map((h) => `${h.country}:${h.name}`)).toContain('IN:Christmas Day');
    expect(r.failed).toEqual(['FR']);
  });
});
