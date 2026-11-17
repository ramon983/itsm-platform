'use client';

import { Bot, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/primitives';
import { API_MODE, postAssist, type AssistApiResponse } from '@/lib/api';
import type { CopilotSubject, SimilarTicket } from '@/lib/copilot';
import { usePlatformStore } from '@/store/usePlatformStore';

/** Live-only: asks the backend Agent-Assist Copilot (Claude, Runtime System Prompt 2) for a grounded second opinion. */
export function ClaudeAssistCard({ subject, similar }: { subject: CopilotSubject; similar: SimilarTicket[] }) {
  const kbArticles = usePlatformStore((s) => s.kbArticles);
  const assets = usePlatformStore((s) => s.assets);
  const [state, setState] = useState<{ loading: boolean; result?: AssistApiResponse; error?: string }>({ loading: false });
  if (API_MODE !== 'live') return null;

  const ask = async () => {
    setState({ loading: true });
    const asset = assets.find((a) => a.id === subject.linkedAssetId);
    const res = await postAssist({
      ticket: {
        id: subject.id, title: subject.title, requester_name: subject.requesterName ?? 'there', requester_language: subject.requesterLanguage ?? 'en',
        linked_asset_id: subject.linkedAssetId ?? null, messages: [{ sender: subject.requesterName ?? 'requester', role: 'end_user', text: subject.text.slice(0, 6000), lang: 'en' }],
      },
      kb_articles: kbArticles.map((k) => ({ id: k.id, title: k.title, summary: k.summary, steps: k.steps })),
      closed_tickets: similar.map((s) => ({ id: s.ticket.id, title: s.ticket.title, resolution: s.ticket.resolution, kb_id: s.ticket.kbId ?? null })),
      cmdb_assets: asset ? [{ id: asset.id, name: asset.name, os: asset.osVersion, mdm: asset.mdmEnrolled, filevault: asset.fileVault }] : [],
    });
    setState(res.ok ? { loading: false, result: res.body as AssistApiResponse } : { loading: false, error: (res.body as { detail: string }).detail });
  };

  const r = state.result;
  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.05] p-3 text-xs">
      <div className="flex items-center gap-2">
        <Bot className="size-3.5 text-sky-300" />
        <span className="font-semibold text-sky-200">Claude second opinion</span>
        {r && <span className="ml-auto rounded-full border border-sky-500/30 px-1.5 text-[10px] text-sky-300">{r.engine === 'claude' ? r.model : `offline · ${r.fallback_reason}`}</span>}
      </div>
      {!r && (
        <Button size="sm" className="mt-2" onClick={ask} disabled={state.loading}>{state.loading ? 'Asking Claude…' : 'Ask Claude (grounded)'}</Button>
      )}
      {state.error && <p className="mt-2 text-rose-300">{state.error}</p>}
      {r && (
        <div className="mt-2 space-y-2">
          <p className="text-slate-200">{r.summary}</p>
          <ul className="space-y-1">
            {r.recommendations.map((rec) => (
              <li key={rec.action} className="text-slate-300">• {rec.action} <span className="font-mono text-indigo-300">{rec.kb_citations.join(', ')}</span></li>
            ))}
          </ul>
          {r.macro && <p className="text-indigo-200">Macro for approval: {r.macro.macro_id} — {r.macro.reason}</p>}
          {r.jit_elevation && <p className="text-emerald-200">JIT: {r.jit_elevation.credential} — {r.jit_elevation.reason}</p>}
          <p className="rounded-lg bg-black/20 p-2 text-slate-200">{r.draft_reply}{r.draft_reply_english && <span className="mt-1 block text-sky-200/70">EN: {r.draft_reply_english}</span>}</p>
          {r.rejected_ungrounded.length > 0 && (
            <p className="flex items-center gap-1 text-amber-300"><ShieldCheck className="size-3" />Guardrail removed {r.rejected_ungrounded.length} ungrounded suggestion(s).</p>
          )}
          {r.knowledge_gaps.length > 0 && <p className="text-slate-500">Gaps: {r.knowledge_gaps.join('; ')}</p>}
          <Button size="sm" variant="ghost" onClick={ask}>Ask again</Button>
        </div>
      )}
    </div>
  );
}
