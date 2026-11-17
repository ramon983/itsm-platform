/** Team helpers for Home: celebrations, availability, on-call rotation and .ics calendar import/export. */
import type { PlatformUser, SwarmSquad, TimeOff, TimeOffType } from '@/types/platform';

const DAY = 86_400_000;

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseYmd = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d; };

/** Monday 00:00 → Sunday of the current week (local time). */
export function weekBounds(nowMs: number) {
  const today = startOfDay(nowMs);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { today, monday, sunday };
}

// ------------------------------------------------------------------ celebrations

export interface Celebration {
  person: PlatformUser;
  occasion: 'birthday' | 'anniversary';
  date: Date;
  years?: number; // anniversaries only — we never show ages
  when: 'today' | 'this_week' | 'upcoming';
  daysAway: number;
}

export function celebrations(users: PlatformUser[], nowMs: number, upcomingDays = 30): Celebration[] {
  const { today, monday, sunday } = weekBounds(nowMs);
  const horizon = new Date(today.getTime() + upcomingDays * DAY);
  const out: Celebration[] = [];
  const occurrence = (month: number, dayOfMonth: number) => {
    // This year's date, unless it already passed before this week started → next year's.
    const d = new Date(today.getFullYear(), month - 1, dayOfMonth);
    if (d < monday) d.setFullYear(d.getFullYear() + 1);
    return d;
  };
  for (const u of users.filter((x) => x.active)) {
    const push = (occasion: Celebration['occasion'], date: Date, years?: number) => {
      if (date > horizon) return;
      const daysAway = Math.round((date.getTime() - today.getTime()) / DAY);
      const when = daysAway === 0 ? 'today' : date >= monday && date <= sunday ? 'this_week' : 'upcoming';
      out.push({ person: u, occasion, date, years, when, daysAway });
    };
    if (u.birthday) push('birthday', occurrence(Number(u.birthday.slice(0, 2)), Number(u.birthday.slice(3, 5))));
    if (u.startDate) {
      const start = parseYmd(u.startDate);
      const d = occurrence(start.getMonth() + 1, start.getDate());
      const years = d.getFullYear() - start.getFullYear();
      if (years >= 1) push('anniversary', d, years);
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ------------------------------------------------------------------ availability

export const TIME_OFF_STYLE: Record<TimeOffType | 'Holiday', string> = {
  PTO: 'bg-sky-500/70',
  Sick: 'bg-rose-500/70',
  Conference: 'bg-violet-500/70',
  Parental: 'bg-amber-400/70',
  Other: 'bg-slate-500/70',
  Holiday: 'bg-emerald-500/60',
};

export const outOn = (person: string, dateYmd: string, timeOff: TimeOff[]) =>
  timeOff.find((t) => t.person === person && t.start <= dateYmd && t.end >= dateYmd);

// ------------------------------------------------------------------ on-call (weekly rotation per squad, handover Monday 09:00)

export interface OnCall {
  squad: SwarmSquad;
  primary: PlatformUser;
  secondary: PlatformUser | null;
  covering: PlatformUser | null; // set when the scheduled primary is out today
  handoverAt: Date;
}

const ROTATION_EPOCH = new Date(2026, 0, 5, 9).getTime(); // a Monday 09:00

export function onCallNow(users: PlatformUser[], timeOff: TimeOff[], squads: readonly SwarmSquad[], nowMs: number): OnCall[] {
  const weeks = Math.floor((nowMs - ROTATION_EPOCH) / (7 * DAY));
  const handoverAt = new Date(ROTATION_EPOCH + (weeks + 1) * 7 * DAY);
  const today = ymd(new Date(nowMs));
  return squads.flatMap((squad) => {
    const members = users.filter((u) => u.active && u.squad === squad);
    if (!members.length) return [];
    const idx = ((weeks % members.length) + members.length) % members.length;
    const primary = members[idx]!;
    const secondary = members.length > 1 ? members[(idx + 1) % members.length]! : null;
    const covering = outOn(primary.name, today, timeOff) && secondary && !outOn(secondary.name, today, timeOff) ? secondary : null;
    return [{ squad, primary, secondary, covering, handoverAt }];
  });
}

// ------------------------------------------------------------------ .ics (RFC 5545) — subscribe in Google/Outlook, import from them

const icsDate = (s: string) => s.replaceAll('-', '');
const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

export function exportIcs(timeOff: TimeOff[], holidays: { date: string; name: string; country: string }[] = []): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const next = (s: string) => ymd(new Date(parseYmd(s).getTime() + DAY));
  const events = [
    ...timeOff.map((t) => ['BEGIN:VEVENT', `UID:${t.id}@adminzero.io`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(t.start)}`, `DTEND;VALUE=DATE:${icsDate(next(t.end))}`,
      `SUMMARY:${escapeText(`${t.person} — ${t.type}${t.note ? ` (${t.note})` : ''}`)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT']),
    ...holidays.map((h) => ['BEGIN:VEVENT', `UID:holiday-${h.country}-${h.date}@adminzero.io`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(h.date)}`,
      `DTEND;VALUE=DATE:${icsDate(next(h.date))}`, `SUMMARY:${escapeText(`${h.name} (${h.country})`)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT']),
  ];
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AdminZero//Team Availability//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:AdminZero team time off', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
}

const typeFrom = (text: string): TimeOffType =>
  // Whole words only — "ill" must not match "Sevilla".
  /\b(pto|vacation|holiday|ooo)\b/i.test(text) ? 'PTO'
    : /\b(sick|ill|doctor|medical)\b/i.test(text) ? 'Sick'
      : /\b(conference|summit|offsite|training|kubecon)\b/i.test(text) ? 'Conference'
        : /\b(parental|maternity|paternity)\b/i.test(text) ? 'Parental'
          : /\b(leave|out of office)\b/i.test(text) ? 'PTO' : 'Other';

/** Parses VEVENTs from an exported Google/Outlook calendar. Events are matched to people by name (SUMMARY or ATTENDEE CN). */
export function importIcs(text: string, people: string[]): { entries: Omit<TimeOff, 'id'>[]; unmatched: string[] } {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/); // unfold continuation lines
  const entries: Omit<TimeOff, 'id'>[] = [];
  const unmatched: string[] = [];
  let ev: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT' && ev) {
      const start = ev.DTSTART?.match(/(\d{4})(\d{2})(\d{2})/);
      const endRaw = ev.DTEND?.match(/(\d{4})(\d{2})(\d{2})/);
      const summary = (ev.SUMMARY ?? '').replace(/\\([,;\\])/g, '$1').replace(/\\n/g, ' ');
      const who = people.find((p) => summary.toLowerCase().includes(p.toLowerCase()) || (ev!.ATTENDEE ?? '').toLowerCase().includes(p.toLowerCase()));
      if (start && who) {
        const startYmd = `${start[1]}-${start[2]}-${start[3]}`;
        let endYmd = endRaw ? `${endRaw[1]}-${endRaw[2]}-${endRaw[3]}` : startYmd;
        // All-day DTEND is exclusive in iCalendar.
        if (ev.DTEND_ALLDAY && endYmd > startYmd) endYmd = ymd(new Date(parseYmd(endYmd).getTime() - DAY));
        entries.push({ person: who, type: typeFrom(summary), start: startYmd, end: endYmd, note: summary.slice(0, 80), source: 'ics' });
      } else if (summary) unmatched.push(summary);
      ev = null;
    } else if (ev) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const [prop, ...params] = line.slice(0, idx).split(';');
        ev[prop!] = line.slice(idx + 1);
        if (prop === 'DTEND' && params.includes('VALUE=DATE')) ev.DTEND_ALLDAY = '1';
        if (prop === 'ATTENDEE') ev.ATTENDEE = `${ev.ATTENDEE ?? ''} ${params.join(';')} ${line.slice(idx + 1)}`;
      }
    }
  }
  return { entries, unmatched };
}
