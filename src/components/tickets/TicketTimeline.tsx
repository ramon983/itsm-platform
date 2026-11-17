'use client';

import clsx from 'clsx';
import { ArrowRightLeft, Bot, Languages, Lock, Terminal, User } from 'lucide-react';

import { useNow } from '@/hooks/useNow';
import { timeAgo } from '@/lib/metrics';
import type { TicketMessage } from '@/types/platform';

const LANG_NAME: Record<string, string> = {
  es: 'Spanish', fr: 'French', ja: 'Japanese', de: 'German', pt: 'Portuguese', en: 'English', it: 'Italian',
};
export const langName = (code: string) => LANG_NAME[code] ?? code.toUpperCase();

export function TicketTimeline({ messages, showTranslation }: { messages: TicketMessage[]; showTranslation: boolean }) {
  const now = useNow();
  return (
    <ol className="space-y-3">
      {messages.map((m) => (
        <li key={m.id}>
          <MessageCard message={m} showTranslation={showTranslation} when={timeAgo(m.timestamp, now)} />
        </li>
      ))}
    </ol>
  );
}

function MessageCard({ message: m, showTranslation, when }: { message: TicketMessage; showTranslation: boolean; when: string }) {
  if (m.role === 'handoff_audit') {
    const d = m.metadata ?? {};
    return (
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3">
        <div className="mb-2 flex items-center gap-2 text-xs">
          <ArrowRightLeft className="size-3.5 text-amber-400" />
          <span className="font-semibold uppercase tracking-wide text-amber-300">Handoff audit</span>
          <span className="text-slate-400">{d.fromSquad} → {d.toSquad}{d.toAgent ? ` · ${d.toAgent}` : ''}</span>
          <span className="ml-auto text-slate-500">{m.sender} · {when}</span>
        </div>
        <dl className="grid gap-1.5 text-xs">
          {[
            ['Reason', d.handoffReason],
            ['Diagnostics attempted', d.diagnosticsAttempted],
            ['Recommended next step', d.recommendedNextStep],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[140px_1fr] gap-2">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-200">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  if (m.role === 'diagnostic_telemetry') {
    return (
      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3">
        <div className="mb-1.5 flex items-center gap-2 text-xs">
          <Terminal className="size-3.5 text-cyan-400" />
          <span className="font-semibold text-cyan-300">{m.sender}</span>
          <span className="ml-auto text-slate-500">{when}</span>
        </div>
        <p className="font-mono text-xs leading-relaxed text-slate-200">{m.originalText}</p>
        {m.metadata?.command && (
          <pre className="mt-2 overflow-x-auto rounded-md bg-black/40 px-2 py-1.5 font-mono text-[11px] text-emerald-300">$ {m.metadata.command}</pre>
        )}
      </div>
    );
  }

  if (m.role === 'ai_system') {
    return (
      <div className="flex gap-2.5 px-1">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-sky-500/15 text-sky-300">
          <Bot className="size-3.5" />
        </span>
        <div className="min-w-0 text-xs">
          <span className="font-medium text-sky-300">{m.sender}</span>
          <span className="ml-2 text-slate-500">{when}</span>
          <p className="mt-0.5 leading-relaxed text-slate-300">{m.originalText}</p>
          {showTranslation && m.translatedText && (
            <p className="mt-1 flex gap-1.5 text-sky-200/80">
              <Languages className="mt-0.5 size-3 shrink-0 text-sky-400" />
              <span><span className="text-sky-300">English:</span> {m.translatedText}</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  const internal = m.role === 'agent' && m.metadata?.visibility === 'internal';
  const foreign = m.originalLang !== 'en';
  return (
    <div
      className={clsx(
        'rounded-xl border p-3',
        m.role === 'end_user' && 'border-white/[0.08] bg-white/[0.03]',
        m.role === 'agent' && !internal && 'border-indigo-500/20 bg-indigo-500/[0.06]',
        internal && 'border-amber-400/20 bg-amber-400/[0.06] backdrop-blur-md',
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        {internal ? <Lock className="size-3.5 text-amber-300" /> : <User className="size-3.5 text-slate-400" />}
        <span className="font-semibold text-slate-200">{m.sender}</span>
        {internal && <span className="rounded bg-amber-400/15 px-1.5 text-[10px] font-medium text-amber-300">Internal swarm note</span>}
        {foreign && (
          <span className="rounded bg-white/[0.06] px-1.5 font-mono text-[10px] uppercase text-slate-300">{m.originalLang}</span>
        )}
        <span className="ml-auto text-slate-500">{when}</span>
      </div>
      <p className="text-sm leading-relaxed text-slate-100">{m.originalText}</p>
      {showTranslation && m.translatedText && (
        <div className="mt-2 flex gap-2 rounded-lg border border-sky-500/15 bg-sky-500/[0.06] px-2.5 py-2 text-xs text-sky-100">
          <Languages className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
          <span>
            <span className="font-medium text-sky-300">
              AI translation {foreign ? `· ${langName(m.originalLang)} → English` : '· sent to requester'}:
            </span>{' '}
            {m.translatedText}
          </span>
        </div>
      )}
    </div>
  );
}
