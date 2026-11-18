'use client';

import { Keyboard } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button, Kbd, Modal } from '@/components/ui/primitives';
import { usePlatformStore, type ViewKey } from '@/store/usePlatformStore';

/** Go-to shortcuts: press g, then a letter (vim/GitHub/Linear style). */
export const GO_TO: Record<string, { view: ViewKey; label: string }> = {
  h: { view: 'dashboard', label: 'Home' },
  t: { view: 'tickets', label: 'Tickets' },
  p: { view: 'problems', label: 'Problems' },
  c: { view: 'changes', label: 'Changes' },
  k: { view: 'knowledge', label: 'Knowledge' },
  r: { view: 'reports', label: 'Reports' },
  e: { view: 'portal', label: 'Employee portal' },
  a: { view: 'admin', label: 'Admin console' },
};

const SECTIONS: { title: string; items: [string[], string][] }[] = [
  { title: 'Everywhere', items: [[['⌘', 'K'], 'Command palette — search anything, run a macro'], [['?'], 'This cheat sheet'], [['g', '…'], 'Go to a page (see list)'], [['Esc'], 'Close dialog or drawer']] },
  { title: 'Go to', items: Object.entries(GO_TO).map(([k, v]) => [['g', k], v.label]) },
  {
    title: 'Tickets',
    items: [[['j'], 'Next ticket in queue'], [['k'], 'Previous ticket'], [['r'], 'Reply (focus the composer)'], [['/'], 'Saved replies, KB steps & macros (in composer)'],
      [['⌘', '↵'], 'Send'], [['E'], 'Approve & run the suggested macro'], [['P'], 'Pause / resume SLA'], [['T'], 'Toggle translations']],
  },
];

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const setView = usePlatformStore((s) => s.setView);
  const flags = usePlatformStore((s) => s.flags);
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('[aria-modal="true"]')) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const go = GO_TO[e.key.toLowerCase()];
        if (go && (go.view !== 'portal' || flags.ai_agents)) {
          e.preventDefault();
          setView(go.view);
        }
        return;
      }
      if (e.key === 'g') pendingG.current = window.setTimeout(() => { pendingG.current = null; }, 1200);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView, flags.ai_agents]);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Keyboard shortcuts and help" title="Keyboard shortcuts (?)">
        <Keyboard className="size-4" />
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" subtitle="Built for people who live in the keyboard." width="max-w-2xl">
        <div className="grid gap-5 sm:grid-cols-2">
          {SECTIONS.map((sec) => (
            <section key={sec.title} className={sec.title === 'Tickets' ? 'sm:col-span-2' : undefined}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{sec.title}</h3>
              <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
                {sec.items.map(([keys, label]) => (
                  <div key={label} className="flex items-center gap-3">
                    <dt className="flex w-16 shrink-0 gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dt>
                    <dd className="text-slate-300">{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="mt-5 border-t border-white/[0.08] pt-3 text-xs text-slate-400">Accessibility statement: Admin console → Accessibility.</p>
      </Modal>
    </>
  );
}
