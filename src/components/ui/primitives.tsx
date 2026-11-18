'use client';

import clsx from 'clsx';
import { CheckCircle2, CircleDot, Info, OctagonAlert, PauseCircle, Sparkles, TriangleAlert, Users, X, XCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useNow } from '@/hooks/useNow';
import { STATUS_LABEL } from '@/lib/rules';
import { formatSla, liveSlaSeconds, slaTone } from '@/lib/sla';
import { agentByName, usePlatformStore } from '@/store/usePlatformStore';
import type { Ticket, TicketPriority, TicketStatus } from '@/types/platform';

export const STATUS_STYLE: Record<TicketStatus, string> = {
  AI_TRIAGED: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  ACTIVE_SWARM: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  WAITING_ON_CUSTOMER: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  WAITING_ON_VENDOR: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  RESOLVED_KB_LINKED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
};

// Every status has its own icon shape, so meaning never depends on colour alone (colour-blind safe).
const STATUS_ICON: Record<TicketStatus, LucideIcon> = {
  AI_TRIAGED: Sparkles,
  ACTIVE_SWARM: Users,
  WAITING_ON_CUSTOMER: PauseCircle,
  WAITING_ON_VENDOR: PauseCircle,
  RESOLVED_KB_LINKED: CheckCircle2,
};

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium', STATUS_STYLE[status], className)}>
      <Icon className="size-3" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_STYLE: Record<TicketPriority, string> = {
  P1: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  P2: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  P3: 'text-slate-300 bg-white/[0.04] border-white/[0.08]',
  P4: 'text-slate-400 bg-white/[0.02] border-white/[0.06]',
};

const PRIORITY_ICON: Record<TicketPriority, LucideIcon> = { P1: OctagonAlert, P2: TriangleAlert, P3: CircleDot, P4: CircleDot };

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold', PRIORITY_STYLE[priority])}>
      {/* Only the P1 icon pulses (not the whole badge); disabled under prefers-reduced-motion. */}
      <Icon className={clsx('size-3', priority === 'P1' && 'animate-pulse')} aria-hidden />
      {priority === 'P1' ? 'P1 CRITICAL' : priority}
    </span>
  );
}

const SLA_TONE_STYLE = {
  breached: 'text-rose-400',
  critical: 'text-rose-300',
  warning: 'text-amber-300',
  healthy: 'text-slate-300',
  paused: 'text-purple-300',
  done: 'text-emerald-400',
} as const;

export function SlaTimer({ ticket, size = 'sm' }: { ticket: Ticket; size?: 'sm' | 'lg' }) {
  const now = useNow();
  const anchor = usePlatformStore((s) => s.slaAnchors[ticket.id]);
  const seconds = liveSlaSeconds(ticket, anchor, now);
  const tone = slaTone(ticket, seconds);
  return (
    <span
      className={clsx('font-mono tabular-nums', SLA_TONE_STYLE[tone], size === 'lg' ? 'text-2xl font-semibold' : 'text-xs')}
      title={tone === 'paused' ? 'SLA paused while waiting' : tone === 'breached' ? 'SLA breached' : 'Time to SLA breach'}
    >
      {tone === 'done' ? 'MET' : `${tone === 'paused' ? '⏸ ' : ''}${formatSla(seconds)}`}
    </span>
  );
}

export function AvatarStack({ names, max = 3 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  return (
    <div className="flex -space-x-1.5" aria-label={`Swarm: ${names.join(', ')}`}>
      {shown.map((name) => {
        const agent = agentByName(name);
        return (
          <span
            key={name}
            title={name}
            className={clsx(
              'grid size-6 place-items-center rounded-full text-[10px] font-semibold text-onaccent ring-2 ring-surface',
              agent?.color ?? 'bg-slate-700',
            )}
          >
            {agent?.initials ?? name.slice(0, 2).toUpperCase()}
          </span>
        );
      })}
      {names.length > max && (
        <span className="grid size-6 place-items-center rounded-full bg-slate-700 text-[10px] text-slate-200 ring-2 ring-surface">
          +{names.length - max}
        </span>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-current/30 bg-current/10 px-1 font-mono text-[10px]">{children}</kbd>
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-indigo-600 text-onaccent hover:bg-indigo-500',
        variant === 'secondary' && 'border border-white/[0.08] bg-white/[0.03] text-slate-200 hover:border-white/[0.16] hover:bg-white/[0.06]',
        variant === 'ghost' && 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100',
        variant === 'danger' && 'border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
        className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={clsx('rounded-xl border border-white/[0.08] bg-surface shadow-card', className)}>{children}</div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside an open dialog and returns focus to the opener on close (WCAG 2.1.2, 2.4.3). */
function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () => [...(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (node && !node.contains(document.activeElement)) (node.querySelector<HTMLElement>('input, textarea, select, [data-autofocus]') ?? focusables()[0] ?? node).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !node) return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [ref, active]);
}

// Modals listen in the capture phase and stop propagation, so Escape closes only the top-most layer.
function useEscape(onClose: () => void, active: boolean, topLayer = false) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (topLayer) e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, { capture: topLayer });
    return () => window.removeEventListener('keydown', onKey, { capture: topLayer });
  }, [onClose, active, topLayer]);
}

export function Drawer({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose, open);
  useFocusTrap(ref, open);
  if (!open) return null;
  // Portalled to <body>: an ancestor with backdrop-filter would otherwise trap `position: fixed` inside it.
  return createPortal(
    <div ref={ref} tabIndex={-1} className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label="Close drawer" className="absolute inset-0 bg-scrim" onClick={onClose} />
      <aside className="az-slide-in absolute inset-y-0 right-0 flex w-full max-w-[540px] flex-col border-l border-white/[0.08] bg-raised shadow-2xl">
        {children}
      </aside>
    </div>,
    document.body,
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose, open, true);
  useFocusTrap(ref, open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close dialog" className="absolute inset-0 bg-scrim" onClick={onClose} />
      <div ref={ref} tabIndex={-1} className={clsx('az-pop-in relative w-full rounded-2xl border border-white/[0.1] bg-raised p-5 shadow-2xl', width)}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-100">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Toaster() {
  const toasts = usePlatformStore((s) => s.toasts);
  const dismiss = usePlatformStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? XCircle : Info;
        return (
          <div
            key={t.id}
            className={clsx(
              'az-pop-in pointer-events-auto flex gap-3 rounded-xl border bg-raised p-3 shadow-xl backdrop-blur-md',
              t.tone === 'success' && 'border-emerald-500/30',
              t.tone === 'error' && 'border-rose-500/30',
              t.tone === 'info' && 'border-indigo-500/30',
            )}
          >
            <Icon
              className={clsx(
                'mt-0.5 size-4 shrink-0',
                t.tone === 'success' && 'text-emerald-400',
                t.tone === 'error' && 'text-rose-400',
                t.tone === 'info' && 'text-indigo-400',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-100">{t.title}</p>
              {t.detail && <p className="mt-0.5 text-xs text-slate-400">{t.detail}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} className="text-slate-500 hover:text-slate-200" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-400">{error}</span> : hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

// Field boundaries use slate-500 so they reach 3:1 against every surface (WCAG 1.4.11); focus uses the global outline.
export const inputClass =
  'w-full rounded-lg border border-slate-500 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition focus:border-indigo-500';
