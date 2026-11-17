'use client';

import clsx from 'clsx';
import { CalendarDays, CalendarPlus, Check, Download, Gift, PartyPopper, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AvatarStack, Button, Card, Field, Modal, inputClass } from '@/components/ui/primitives';
import { useNow } from '@/hooks/useNow';
import { COUNTRY_NAMES, flag, upcomingHolidays, type Holiday } from '@/lib/holidays';
import { TIME_OFF_STYLE, celebrations, exportIcs, importIcs, outOn, parseYmd, ymd } from '@/lib/people';
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

// ------------------------------------------------------------------ team availability

export function TeamAvailability({ holidays }: { holidays: Holiday[] }) {
  const users = usePlatformStore((s) => s.users);
  const timeOff = usePlatformStore((s) => s.timeOff);
  const removeTimeOff = usePlatformStore((s) => s.removeTimeOff);
  const importTimeOff = usePlatformStore((s) => s.importTimeOff);
  const pushToast = usePlatformStore((s) => s.pushToast);
  const now = useNow();
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const people = users.filter((u) => u.active);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, i) => new Date(today.getTime() + i * 86_400_000));
  const todayYmd = ymd(today);
  const holidayFor = (country: string, d: string) => holidays.find((h) => h.country === country && h.date === d);
  const outToday = people.filter((p) => outOn(p.name, todayYmd, timeOff) || holidayFor(p.country, todayYmd));
  const upcoming = timeOff.filter((t) => t.end >= todayYmd).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 6);

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
    const { entries, unmatched } = importIcs(await file.text(), people.map((p) => p.name));
    importTimeOff(entries);
    if (unmatched.length) pushToast({ tone: 'info', title: `${unmatched.length} event(s) skipped`, detail: 'No teammate name in the event title or attendees' });
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight"><CalendarDays className="size-4 text-sky-400" />Team availability</h2>
        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs text-emerald-200">{people.length - outToday.length} of {people.length} in today</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => setAdding(true)}><CalendarPlus className="size-3.5" />Add time off</Button>
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title="Import an .ics exported from Google Calendar or Outlook"><Upload className="size-3.5" />Import .ics</Button>
          <Button size="sm" variant="ghost" onClick={download} title="Download the team calendar to add to Google Calendar or Outlook"><Download className="size-3.5" />Export .ics</Button>
          <input ref={fileRef} type="file" accept=".ics,text/calendar" className="hidden" aria-label="Import calendar file" onChange={(e) => void onFile(e.target.files?.[0])} />
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-y-1 text-xs">
          <thead>
            <tr>
              <th className="w-40" />
              {days.map((d) => (
                <th key={d.toISOString()} className={clsx('px-0.5 text-center font-normal', d.getDay() % 6 === 0 ? 'text-slate-600' : 'text-slate-400', ymd(d) === todayYmd && 'text-sky-300')}>
                  <span className="block text-[10px]">{d.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                  <span className="block font-mono text-[10px]">{d.getDate()}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.email}>
                <td className="pr-2">
                  <span className="flex items-center gap-2">
                    <AvatarStack names={[p.name]} max={1} />
                    <span className="truncate text-slate-200">{p.name.split(' ')[0]}</span>
                    <span title={COUNTRY_NAMES[p.country] ?? p.country}>{flag(p.country)}</span>
                  </span>
                </td>
                {days.map((d) => {
                  const key = ymd(d);
                  const off = outOn(p.name, key, timeOff);
                  const hol = holidayFor(p.country, key);
                  const weekend = d.getDay() % 6 === 0;
                  const label = off ? `${p.name}: ${off.type}${off.note ? ` — ${off.note}` : ''}` : hol ? `${p.name}: ${hol.name} (${p.country})` : `${p.name}: ${weekend ? 'weekend' : 'available'}`;
                  return (
                    <td key={key} className="px-0.5">
                      <span title={label} aria-label={label} className={clsx('block h-6 rounded-md', off ? TIME_OFF_STYLE[off.type] : hol ? TIME_OFF_STYLE.Holiday : weekend ? 'bg-white/[0.02]' : 'bg-white/[0.06]', key === todayYmd && 'ring-1 ring-sky-400/60')} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        {(['PTO', 'Sick', 'Conference', 'Parental', 'Holiday'] as const).map((k) => (
          <span key={k} className="flex items-center gap-1"><span className={clsx('size-2.5 rounded-sm', TIME_OFF_STYLE[k])} />{k === 'Holiday' ? 'Public holiday' : k}</span>
        ))}
      </div>

      {upcoming.length > 0 && (
        <ul className="mt-3 divide-y divide-white/[0.05] border-t border-white/[0.06] pt-1 text-xs">
          {upcoming.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-1.5">
              <span className={clsx('size-2 rounded-full', TIME_OFF_STYLE[t.type])} />
              <span className="text-slate-200">{t.person}</span>
              <span className="text-slate-500">{t.type}{t.note ? ` · ${t.note}` : ''}</span>
              <span className="ml-auto font-mono text-slate-400">{monthDay(parseYmd(t.start))}{t.end !== t.start ? ` → ${monthDay(parseYmd(t.end))}` : ''}</span>
              <Button size="sm" variant="ghost" onClick={() => removeTimeOff(t.id)} aria-label={`Remove ${t.person} ${t.type}`}><Trash2 className="size-3" /></Button>
            </li>
          ))}
        </ul>
      )}
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
