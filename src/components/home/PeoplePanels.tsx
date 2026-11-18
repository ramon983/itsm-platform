'use client';

import clsx from 'clsx';
import { Baby, CalendarDays, CalendarOff, CalendarPlus, Check, Download, Flag, Gift, PartyPopper, Presentation, RefreshCw, Thermometer, Trash2, TreePalm, Upload, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AvatarStack, Button, Card, Field, Modal, inputClass } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { COUNTRY_NAMES, flag, upcomingHolidays, type Holiday } from '@/lib/holidays';
import { celebrations, exportIcs, importIcs, parseYmd, whosOut, ymd, type OutReason } from '@/lib/people';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { TimeOffType } from '@/types/platform';

// ------------------------------------------------------------------ holidays (shared by availability + holidays panel)

export function useHolidays(countries: string[], days = 60) {
  const now = useNow();
  const today = ymd(new Date(now));
  const key = [...new Set(countries)].sort().join(',');
  const [state, setState] = useState<{ holidays: Holiday[]; failed: string[]; loading: boolean }>({ holidays: [], failed: [], loading: true });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const res = await upcomingHolidays(key.split(',').filter(Boolean), today, days);
    setState({ ...res, loading: false });
  }, [key, today, days]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  return { ...state, retry: load };
}

const weekday = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short' });
const monthDay = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// ------------------------------------------------------------------ celebrations

export function Celebrations() {
  const users = usePlatformStore((s) => s.users);
  const wishes = usePlatformStore((s) => s.wishes);
  const sendWish = usePlatformStore((s) => s.sendWish);
  const now = useNow();
  const list = celebrations(users, now, 30);
  const week = list.filter((c) => c.when !== 'upcoming');
  const upcoming = list.filter((c) => c.when === 'upcoming');
  const sent = (person: string, occasion: 'birthday' | 'anniversary', year: number) => wishes.some((w) => w.person === person && w.occasion === occasion && w.year === year);

  return (
    <Card className="flex h-full flex-col p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight"><PartyPopper className="size-4 text-pink-400" />Celebrations</h2>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">This week</p>
      <ul className="space-y-2">
        {week.map((c) => {
          const done = sent(c.person.name, c.occasion, c.date.getFullYear());
          return (
            <li key={`${c.person.email}-${c.occasion}`} className={clsx('flex items-center gap-2.5 rounded-xl border p-2.5', c.when === 'today' ? 'border-pink-400/30 bg-gradient-to-r from-pink-500/[0.12] to-amber-400/[0.06]' : 'border-white/[0.06]')}>
              <span className="text-xl" aria-hidden>{c.occasion === 'birthday' ? '🎂' : '🎉'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">{c.person.name}</span>
                <span className="block text-[11px] text-slate-400">
                  {c.occasion === 'birthday' ? 'Birthday' : `${c.years} year${c.years === 1 ? '' : 's'} at AdminZero`} · {c.when === 'today' ? <span className="font-semibold text-pink-300">Today!</span> : `${weekday(c.date)} ${monthDay(c.date)}`}
                </span>
              </span>
              <Button size="sm" variant={done ? 'ghost' : 'secondary'} disabled={done} onClick={() => sendWish(c.person.name, c.occasion, c.date.getFullYear())}>
                {done ? <><Check className="size-3.5 text-emerald-400" />Sent</> : <><Gift className="size-3.5" />{c.occasion === 'birthday' ? 'Wish' : 'Congrats'}</>}
              </Button>
            </li>
          );
        })}
        {!week.length && <li className="text-xs text-slate-500">No celebrations this week.</li>}
      </ul>
      <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Coming up · 30 days</p>
      <ul className="space-y-1.5 text-xs">
        {upcoming.slice(0, 5).map((c) => (
          <li key={`${c.person.email}-${c.occasion}-u`} className="flex items-center gap-2">
            <span aria-hidden>{c.occasion === 'birthday' ? '🎂' : '🎉'}</span>
            <span className="flex-1 truncate text-slate-300">{c.person.name}{c.occasion === 'anniversary' ? ` · ${c.years}y` : ''}</span>
            <span className="text-slate-500">{monthDay(c.date)} · in {c.daysAway}d</span>
          </li>
        ))}
        {!upcoming.length && <li className="text-slate-500">Nothing in the next 30 days.</li>}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ who's out (today + next 30 days)

/** Icon + text for every reason, so nothing depends on colour alone. */
const REASON: Record<OutReason, { icon: typeof Flag; label: string; tone: string }> = {
  PTO: { icon: TreePalm, label: 'PTO', tone: 'text-sky-300' },
  Sick: { icon: Thermometer, label: 'Sick', tone: 'text-rose-300' },
  Conference: { icon: Presentation, label: 'Conference', tone: 'text-violet-300' },
  Parental: { icon: Baby, label: 'Parental leave', tone: 'text-amber-300' },
  Other: { icon: CalendarOff, label: 'Out', tone: 'text-slate-300' },
  Holiday: { icon: Flag, label: 'Public holiday', tone: 'text-emerald-300' },
};

function ReasonTag({ reason }: { reason: OutReason }) {
  const r = REASON[reason];
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full border border-white/[0.1] px-2 py-0.5 text-[11px]', r.tone)}>
      <r.icon className="size-3" aria-hidden />
      {r.label}
    </span>
  );
}

const DAY = 86_400_000;
const relDay = (ymdStr: string, todayMs: number) => {
  const diff = Math.round((parseYmd(ymdStr).getTime() - todayMs) / DAY);
  return diff === 1 ? 'tomorrow' : diff < 7 ? weekday(parseYmd(ymdStr)) : `in ${diff} days`;
};
const backLabel = (back: Date, todayMs: number) => {
  const diff = Math.round((back.getTime() - todayMs) / DAY);
  return diff === 1 ? 'Back tomorrow' : diff < 7 ? `Back ${back.toLocaleDateString(undefined, { weekday: 'long' })}` : `Back ${monthDay(back)}`;
};

const COLLAPSED = 8;

export function WhosOut({ holidays }: { holidays: Holiday[] }) {
  const users = usePlatformStore((s) => s.users);
  const timeOff = usePlatformStore((s) => s.timeOff);
  const squads = usePlatformStore((s) => s.squads);
  const removeTimeOff = usePlatformStore((s) => s.removeTimeOff);
  const importTimeOff = usePlatformStore((s) => s.importTimeOff);
  const pushToast = usePlatformStore((s) => s.pushToast);
  const now = useNow();
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [squad, setSquad] = useState('all');
  const [showAll, setShowAll] = useState(false);

  const scoped = users.filter((u) => u.active && (squad === 'all' || u.squad === squad));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const { today: outToday, upcoming } = whosOut(scoped, timeOff, holidays, today.getTime(), 30);
  const shown = showAll ? upcoming : upcoming.slice(0, COLLAPSED);

  const download = () => {
    const blob = new Blob([exportIcs(timeOff, holidays)], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'adminzero-team-time-off.ics';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const { entries, unmatched } = importIcs(await file.text(), users.filter((u) => u.active).map((p) => p.name));
    importTimeOff(entries);
    if (unmatched.length) pushToast({ tone: 'info', title: `${unmatched.length} event(s) skipped`, detail: 'No teammate name in the event title or attendees' });
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight"><CalendarDays className="size-4 text-sky-400" aria-hidden />Who’s out</h2>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.1] px-2 py-0.5 text-xs text-emerald-200">
          <UserCheck className="size-3" aria-hidden />{scoped.length - outToday.length} of {scoped.length} in today
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {squads.length > 1 && (
            <select aria-label="Filter by squad" className="h-8 max-w-[12rem] rounded-lg border border-slate-500 bg-white/[0.03] px-2 text-xs text-slate-100" value={squad} onChange={(e) => setSquad(e.target.value)}>
              <option value="all" className="bg-slate-900">All squads</option>
              {squads.map((q) => <option key={q} value={q} className="bg-slate-900">{q}</option>)}
            </select>
          )}
          <Button size="sm" onClick={() => setAdding(true)}><CalendarPlus className="size-3.5" />Add time off</Button>
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title="Import an .ics exported from Google Calendar or Outlook"><Upload className="size-3.5" />Import .ics</Button>
          <Button size="sm" variant="ghost" onClick={download} title="Download the team calendar to add to Google Calendar or Outlook"><Download className="size-3.5" />Export .ics</Button>
          <input ref={fileRef} type="file" accept=".ics,text/calendar" className="hidden" aria-label="Import calendar file" onChange={(e) => void onFile(e.target.files?.[0])} />
        </span>
      </div>

      <section aria-labelledby="out-today">
        <h3 id="out-today" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Out today <span className="font-mono font-normal">{outToday.length}</span></h3>
        {outToday.length === 0 ? (
          <p className="rounded-lg border border-white/[0.06] px-3 py-3 text-sm text-slate-300">Everyone’s in today. 🎉</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {outToday.map((o) => (
              <li key={o.person.email} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <AvatarStack names={[o.person.name]} max={1} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm text-slate-100">
                    <span className="truncate">{o.person.name}</span>
                    <span title={COUNTRY_NAMES[o.person.country] ?? o.person.country} aria-label={COUNTRY_NAMES[o.person.country] ?? o.person.country}>{flag(o.person.country)}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <ReasonTag reason={o.reason} />
                    {o.label && <span className="truncate">{o.label}</span>}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-slate-300">{backLabel(o.back, today.getTime())}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="coming-up" className="mt-4">
        <h3 id="coming-up" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Coming up · next 30 days <span className="font-mono font-normal">{upcoming.length}</span></h3>
        {upcoming.length === 0 ? (
          <p className="rounded-lg border border-white/[0.06] px-3 py-3 text-sm text-slate-300">Nobody has time off booked in the next 30 days.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.06]">
            {shown.map((u) => {
              const start = parseYmd(u.start);
              return (
                <li key={u.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-16 shrink-0 leading-tight">
                    <span className="block font-mono text-xs text-slate-100">{monthDay(start)}</span>
                    <span className="block text-[11px] text-slate-400">{relDay(u.start, today.getTime())}</span>
                  </span>
                  <AvatarStack names={u.people.map((p) => p.name)} max={3} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-100">
                      {u.reason === 'Holiday'
                        ? `${flag(u.people[0]!.country)} ${u.label}`
                        : u.people[0]!.name}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                      <ReasonTag reason={u.reason} />
                      {u.reason === 'Holiday' ? <span className="truncate">{u.people.map((p) => p.name.split(' ')[0]).join(', ')} off</span> : u.label && <span className="truncate">{u.label}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-slate-300">
                    {u.end !== u.start ? <>to {monthDay(parseYmd(u.end))}<br /></> : null}
                    <span className="text-slate-400">{u.workdays === 0 ? 'Weekend' : `${u.workdays} workday${u.workdays === 1 ? '' : 's'}`}</span>
                  </span>
                  {u.timeOffId ? (
                    <Button size="sm" variant="ghost" onClick={() => removeTimeOff(u.timeOffId!)} aria-label={`Remove ${u.people[0]!.name} ${REASON[u.reason].label} starting ${monthDay(start)}`}><Trash2 className="size-3.5" /></Button>
                  ) : <span className="w-8 shrink-0" aria-hidden />}
                </li>
              );
            })}
          </ul>
        )}
        {upcoming.length > COLLAPSED && (
          <Button size="sm" variant="ghost" className="mt-2" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${upcoming.length}`}
          </Button>
        )}
      </section>
      <AddTimeOffModal open={adding} onClose={() => setAdding(false)} />
    </Card>
  );
}

function AddTimeOffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add time off" subtitle="Shows on the team calendar and in on-call cover." width="max-w-md">
      {open && <AddTimeOffForm onClose={onClose} />}
    </Modal>
  );
}

function AddTimeOffForm({ onClose }: { onClose: () => void }) {
  const users = usePlatformStore((s) => s.users);
  const addTimeOff = usePlatformStore((s) => s.addTimeOff);
  const now = useNow();
  const today = ymd(new Date(now));
  const [f, setF] = useState({ person: users[0]?.name ?? '', type: 'PTO' as TimeOffType, start: today, end: today, note: '' });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (addTimeOff({ ...f, note: f.note.trim() || undefined }).ok) onClose(); }}>
      <Field label="Who">
        <select className={inputClass} value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}>
          {users.filter((u) => u.active).map((u) => <option key={u.email} className="bg-slate-900">{u.name}</option>)}
        </select>
      </Field>
      <Field label="Type">
        <select className={inputClass} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as TimeOffType })}>
          {(['PTO', 'Sick', 'Conference', 'Parental', 'Other'] as const).map((t) => <option key={t} className="bg-slate-900">{t}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From"><input type="date" className={inputClass} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: e.target.value > f.end ? e.target.value : f.end })} /></Field>
        <Field label="To"><input type="date" className={inputClass} value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
      </div>
      <Field label="Note (optional)"><input className={inputClass} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Family trip" /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary">Add</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ holidays

export function HolidaysPanel({ holidays, failed, loading, retry }: { holidays: Holiday[]; failed: string[]; loading: boolean; retry: () => void }) {
  const users = usePlatformStore((s) => s.users);
  const people = users.filter((u) => u.active);
  const countries = [...new Set(people.map((p) => p.country))];
  const byDate = holidays.reduce<Record<string, Holiday[]>>((acc, h) => ((acc[h.date] ??= []).push(h), acc), {});

  return (
    <Card className="flex h-full flex-col p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold tracking-tight">🗓️ Holidays</h2>
      <p className="mb-3 text-[11px] text-slate-500">Next 60 days · {countries.map((c) => flag(c)).join(' ')} from where our agents are</p>
      {loading && !holidays.length ? (
        <p className="text-xs text-slate-500">Loading holidays…</p>
      ) : (
        <ul className="space-y-2">
          {Object.entries(byDate).slice(0, 5).map(([date, list]) => {
            const d = parseYmd(date);
            // One line per holiday name, with every country that observes it — no repeated rows.
            const byName = list.reduce<Record<string, Holiday[]>>((acc, h) => ((acc[h.name] ??= []).push(h), acc), {});
            return (
              <li key={date} className="flex gap-3">
                <span className="w-11 shrink-0 rounded-lg border border-white/[0.06] py-1 text-center">
                  <span className="block text-[10px] uppercase text-slate-500">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
                  <span className="block font-mono text-base leading-none text-slate-100">{d.getDate()}</span>
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  {Object.entries(byName).map(([name, hs]) => {
                    const ccs = hs.map((h) => h.country);
                    const off = people.filter((p) => ccs.includes(p.country)).map((p) => p.name.split(' ')[0]);
                    const local = hs.find((h) => h.localName !== h.name)?.localName;
                    return (
                      <span key={name} className="block text-xs" title={hs.map((h) => `${COUNTRY_NAMES[h.country] ?? h.country}: ${h.localName}`).join('\n')}>
                        <span className="text-slate-100">{name}</span> <span aria-label={ccs.map((c) => COUNTRY_NAMES[c] ?? c).join(', ')}>{ccs.map(flag).join(' ')}</span>
                        <span className="block truncate text-[11px] text-slate-500">{off.length === people.length ? 'Whole team off' : `${off.join(', ')} off`}{local && hs.length === 1 ? ` · ${local}` : ''}</span>
                      </span>
                    );
                  })}
                </span>
              </li>
            );
          })}
          {!holidays.length && <li className="text-xs text-slate-500">No public holidays in the next 60 days.</li>}
        </ul>
      )}
      {failed.length > 0 && (
        <p className="mt-3 flex items-center gap-2 text-[11px] text-amber-300">
          Couldn’t load {failed.map((c) => flag(c)).join(' ')} holidays.
          <Button size="sm" variant="ghost" onClick={retry}><RefreshCw className="size-3" />Retry</Button>
        </p>
      )}
      <p className="mt-auto pt-3 text-[10px] text-slate-600">National holidays via Nager.Date{countries.includes('IN') ? ' · India: fixed national holidays (built-in)' : ''}. Countries come from Admin → People.</p>
    </Card>
  );
}
