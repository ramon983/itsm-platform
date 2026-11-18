'use client';

import clsx from 'clsx';
import { BookOpen, Plus } from 'lucide-react';
import { useState } from 'react';

import { Button, Field, Modal, inputClass } from '@/components/ui/primitives';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { Ticket } from '@/types/platform';

/** §3.1 — Resolving requires linking an existing Knowledge Base article or publishing a new one. */
export function ResolveKbModal({ ticket, open, onClose }: { ticket: Ticket; open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Resolve ${ticket.id}`}
      subtitle="Every resolution links a Knowledge Base article so the next person (or the AI) can solve it faster."
      width="max-w-xl"
    >
      {open && <ResolveForm ticket={ticket} onClose={onClose} />}
    </Modal>
  );
}

function ResolveForm({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const kbArticles = usePlatformStore((s) => s.kbArticles);
  const createKbArticle = usePlatformStore((s) => s.createKbArticle);
  const transitionTicket = usePlatformStore((s) => s.transitionTicket);
  const ranked = [...kbArticles].sort(
    (a, b) => Number(b.squad === ticket.swarmSquad) - Number(a.squad === ticket.swarmSquad),
  );
  const [mode, setMode] = useState<'link' | 'create'>('link');
  const [kbId, setKbId] = useState(ticket.linkedKbId ?? ranked[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState({ title: ticket.title, summary: '', steps: '' });
  const [error, setError] = useState<string>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let id = kbId;
    if (mode === 'create') {
      const steps = draft.steps.split('\n').map((s) => s.trim()).filter(Boolean);
      if (draft.title.trim().length < 8 || draft.summary.trim().length < 15 || steps.length === 0) {
        setError('New articles need a title (8+ chars), a summary (15+ chars) and at least one step.');
        return;
      }
      id = createKbArticle({ title: draft.title.trim(), summary: draft.summary.trim(), squad: ticket.swarmSquad, steps }).id;
    }
    if (!id) {
      setError('Choose an article to link.');
      return;
    }
    if (transitionTicket(ticket.id, 'RESOLVED_KB_LINKED', { kbId: id, note: note.trim() || undefined }).ok) onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] p-1">
        {(['link', 'create'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={clsx(
              'flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition',
              mode === m ? 'bg-indigo-600 text-onaccent' : 'text-slate-400 hover:text-slate-200',
            )}
          >
            {m === 'link' ? <BookOpen className="size-3.5" /> : <Plus className="size-3.5" />}
            {m === 'link' ? 'Link existing article' : 'Publish new article'}
          </button>
        ))}
      </div>

      {mode === 'link' ? (
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {ranked.map((kb) => (
            <label
              key={kb.id}
              className={clsx(
                'flex cursor-pointer gap-3 rounded-lg border p-2.5 transition',
                kbId === kb.id ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-white/[0.06] hover:border-white/[0.16]',
              )}
            >
              <input type="radio" name="kb" className="mt-1 accent-indigo-500" checked={kbId === kb.id} onChange={() => setKbId(kb.id)} />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-indigo-300">{kb.id}</span>
                  <span className="truncate text-sm text-slate-100">{kb.title}</span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{kb.squad} · {kb.summary}</span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Article title">
            <input className={inputClass} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Summary (symptom → cause)">
            <textarea rows={2} className={inputClass} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          </Field>
          <Field label="Resolution steps" hint="One step per line">
            <textarea rows={4} className={clsx(inputClass, 'font-mono text-xs')} value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} />
          </Field>
        </div>
      )}

      <Field label="Resolution note (optional)">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What fixed it for this user?" />
      </Field>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary">Resolve & link KB</Button>
      </div>
    </form>
  );
}
