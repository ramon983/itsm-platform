'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight, ImagePlus, Pause, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Card, Field, Modal, inputClass } from '@/components/ui/primitives';
import { usePlatformStore } from '@/store/usePlatformStore';

const EMOJIS = ['🐶', '🐱', '🐰', '🦜', '🐠', '🐢', '🐴', '🦎', '🏃', '🎸', '🍎', '🧗', '🎨', '📚', '🍳', '🌱', '⚽', '🎮'];

/** Resize an uploaded photo client-side so it fits comfortably in local storage. */
async function resizePhoto(file: File, max = 320): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Not an image'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Spotlight() {
  const entries = usePlatformStore((s) => s.spotlight);
  const giveKudos = usePlatformStore((s) => s.giveKudos);
  const removeSpotlight = usePlatformStore((s) => s.removeSpotlight);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false); // hover/focus pause
  const [stopped, setStopped] = useState(false); // user pressed Pause
  const [adding, setAdding] = useState(false);
  const [burst, setBurst] = useState(0);
  const count = entries.length;
  const i = count ? index % count : 0;
  const e = entries[i];

  useEffect(() => {
    if (paused || stopped || count < 2) return;
    const timer = setInterval(() => setIndex((x) => x + 1), 9000);
    return () => clearInterval(timer);
  }, [paused, stopped, count]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <Sparkles className="size-4 text-amber-300" />
        <h2 className="text-sm font-semibold tracking-tight">Team &amp; Pets Spotlight</h2>
        <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}><Plus className="size-3.5" />Add someone</Button>
      </div>
      {e ? (
        <div className="grid gap-0 md:grid-cols-[280px_1fr]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} aria-roledescription="carousel" aria-label="Team and pets spotlight">
          <div className={clsx('relative grid aspect-[4/3] place-items-center bg-gradient-to-br md:aspect-auto md:min-h-[220px]', e.kind === 'pet' ? 'from-amber-400/25 via-pink-500/15 to-indigo-500/20' : 'from-indigo-500/25 via-sky-500/15 to-emerald-400/20')}>
            {e.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-uploaded data URL, nothing to optimise
              <img src={e.photo} alt={`${e.name}`} className="absolute inset-0 size-full object-cover" />
            ) : (
              <span className="text-7xl drop-shadow-lg" aria-hidden>{e.emoji}</span>
            )}
            <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-[11px] text-onaccent backdrop-blur">{e.kind === 'pet' ? '🐾 Pet of the week' : '⭐ Team spotlight'}</span>
          </div>
          <div className="flex flex-col p-5">
            <p className="text-xl font-semibold tracking-tight">{e.name} {e.photo && <span aria-hidden>{e.emoji}</span>}</p>
            <p className="text-sm text-slate-400">{e.subtitle}</p>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-200">“{e.funFact}”</p>
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
              <button
                type="button"
                onClick={() => { giveKudos(e.id); setBurst((b) => b + 1); }}
                className="relative flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-100 transition hover:bg-amber-400/20 active:scale-95"
                aria-label={`Give kudos to ${e.name}`}
              >
                <span key={burst} className={clsx(burst && 'az-pop-in')} aria-hidden>👏</span>
                <span className="font-mono">{e.kudos}</span>
              </button>
              <span className="text-[11px] text-slate-500">Added by {e.addedBy}</span>
              <span className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setStopped((v) => !v)} aria-label={stopped ? "Resume rotation" : "Pause rotation"} aria-pressed={stopped}>{stopped ? <Play className="size-4" /> : <Pause className="size-4" />}</Button>
                <Button size="sm" variant="ghost" onClick={() => setIndex((x) => (x - 1 + count) % count)} aria-label="Previous"><ChevronLeft className="size-4" /></Button>
                <span className="flex gap-1" aria-hidden>
                  {entries.map((x, n) => <span key={x.id} className={clsx('size-1.5 rounded-full', n === i ? 'bg-amber-300' : 'bg-white/20')} />)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setIndex((x) => (x + 1) % count)} aria-label="Next"><ChevronRight className="size-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => { removeSpotlight(e.id); setIndex(0); }} aria-label={`Remove ${e.name}`}><Trash2 className="size-3.5" /></Button>
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p className="p-8 text-center text-sm text-slate-500">No one in the spotlight yet — add a teammate or a pet! 🐾</p>
      )}
      <AddSpotlightModal open={adding} onClose={() => setAdding(false)} onAdded={() => setIndex(0)} />
    </Card>
  );
}

function AddSpotlightModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add to the spotlight" subtitle="Celebrate a teammate or introduce a pet." width="max-w-lg">
      {open && <AddSpotlightForm onClose={onClose} onAdded={onAdded} />}
    </Modal>
  );
}

function AddSpotlightForm({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const addSpotlight = usePlatformStore((s) => s.addSpotlight);
  const pushToast = usePlatformStore((s) => s.pushToast);
  const [f, setF] = useState({ kind: 'pet' as 'pet' | 'team', name: '', subtitle: '', funFact: '', emoji: '🐶', photo: undefined as string | undefined });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (addSpotlight({ ...f, subtitle: f.subtitle.trim() || (f.kind === 'pet' ? 'Office pet' : 'Teammate') }).ok) { onAdded(); onClose(); } }}>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/[0.08] p-1">
        {(['pet', 'team'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setF({ ...f, kind: k, emoji: k === 'pet' ? '🐶' : '🏃' })} className={clsx('rounded-md py-1.5 text-sm', f.kind === k ? 'bg-indigo-600 text-onaccent' : 'text-slate-400')}>
            {k === 'pet' ? '🐾 A pet' : '⭐ A teammate'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'pet' ? 'Biscuit' : 'Jonas Weber'} /></Field>
        <Field label={f.kind === 'pet' ? 'Whose pet?' : 'Team / role'}><input className={inputClass} value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} placeholder={f.kind === 'pet' ? 'Jonas’s beagle' : 'SaaS & Cloud Ops'} /></Field>
      </div>
      <Field label="Fun fact"><textarea rows={2} className={inputClass} value={f.funFact} onChange={(e) => setF({ ...f, funFact: e.target.value })} placeholder="Something that will make the team smile" /></Field>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-slate-400">Emoji</legend>
        <div className="flex flex-wrap gap-1">
          {EMOJIS.map((em) => (
            <button key={em} type="button" onClick={() => setF({ ...f, emoji: em })} aria-pressed={f.emoji === em} className={clsx('grid size-8 place-items-center rounded-lg text-lg', f.emoji === em ? 'bg-indigo-500/30 ring-1 ring-indigo-400' : 'hover:bg-white/[0.06]')}>{em}</button>
          ))}
        </div>
      </fieldset>
      <Field label="Photo (optional)" hint="Resized in your browser before saving">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/[0.12] p-2.5 text-xs text-slate-400 hover:border-white/[0.2]">
          {f.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of an uploaded data URL
            <img src={f.photo} alt="Preview" className="size-12 rounded-md object-cover" />
          ) : <ImagePlus className="size-5" />}
          {f.photo ? 'Change photo' : 'Upload a photo'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setF({ ...f, photo: await resizePhoto(file) });
              } catch {
                pushToast({ tone: 'error', title: 'That file isn’t an image we can read' });
              }
            }}
          />
        </label>
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary">Add to spotlight</Button>
      </div>
    </form>
  );
}
