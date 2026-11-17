'use client';

import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  Cloud,
  Cpu,
  FileJson,
  Gauge,
  Languages,
  Laptop,
  Loader2,
  MessageCircleHeart,
  RotateCcw,
  Send,
  Sparkles,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, Card, PriorityBadge } from '@/components/ui/primitives';
import { END_USERS } from '@/data/seed';
import {
  INTAKE_PRESETS,
  KNOWN_TRANSLATIONS,
  LANGUAGE_NAMES,
  NATIVE_REPLY_LANGUAGES,
  analyzeIntake,
  confirmationMessage,
  detectLanguage,
} from '@/lib/intake';
import { API_MODE, postIntake, type IntakeApiResponse } from '@/lib/api';
import { findDeflectionArticle } from '@/lib/patterns';
import { usePlatformStore } from '@/store/usePlatformStore';
import type { EndUserProfile, IntakeAnalysis, IntakeChatMessage } from '@/types/platform';

const STEPS = ['Detecting Language & Sentiment', 'Querying CMDB & Torii SaaS Graph', 'Mapping to Predefined ITSM Schema'] as const;
const SECTION_COUNT = 6;

type Phase = 'idle' | 'analyzing' | 'ready' | 'submitted' | 'deflected';

const uid = () => crypto.randomUUID().slice(0, 8);
const KNOWN_TEMPLATES = ['#INC-NET-04', '#SR-HW-01', '#SR-SAAS-09', '#CHG-SEC-02', '#INC-SEC-01', '#INC-GEN-01'] as const;

/** Claude's answer (live API) layered over the offline analysis, which still supplies CMDB fields and macros. */
function mergeLive(local: IntakeAnalysis, live: IntakeApiResponse): IntakeAnalysis {
  const a = live.analysis;
  const lang = a.detected_language.split('-')[0]!.toLowerCase();
  return {
    ...local,
    detectedLanguage: lang,
    sentiment: a.sentiment,
    templateId: (KNOWN_TEMPLATES as readonly string[]).includes(a.selected_template_id) ? (a.selected_template_id as IntakeAnalysis['templateId']) : local.templateId,
    templateName: a.template_name,
    ticketType: a.ticket_type,
    swarmSquad: a.recommended_swarm_group,
    priority: a.priority,
    priorityReasons: [`${live.engine === 'claude' ? 'Claude' : 'API offline engine'} urgency ${a.urgency_score}/5 → ${a.priority}`, ...local.priorityReasons.map((r) => `Local check: ${r}`)],
    englishSummary: a.english_summary_for_agent,
    requiredApprovals: a.required_approvals,
    clarifyingQuestion: a.clarifying_question,
    replyNative: live.reply,
    replyLanguage: lang,
    replyEnglish: lang === 'en' ? live.reply : `Agent summary: ${a.english_summary_for_agent}`,
  };
}

export function EndUserPortalView({ stepMs = 650 }: { stepMs?: number }) {
  const assets = usePlatformStore((s) => s.assets);
  const saasApps = usePlatformStore((s) => s.saasApps);
  const createTicketFromIntake = usePlatformStore((s) => s.createTicketFromIntake);
  const openInspector = usePlatformStore((s) => s.openInspector);
  const setView = usePlatformStore((s) => s.setView);
  const kbArticles = usePlatformStore((s) => s.kbArticles);
  const kbStats = usePlatformStore((s) => s.kbStats);
  const aiSettings = usePlatformStore((s) => s.aiSettings);
  const recordDeflection = usePlatformStore((s) => s.recordDeflection);
  const [engine, setEngine] = useState<string>(API_MODE === 'live' ? 'Live API' : 'Offline intake mapper');
  const [deflection, setDeflection] = useState<{ kbId: string; title: string; steps: string[]; confidence: number } | null>(null);

  const [personaEmail, setPersonaEmail] = useState(END_USERS[0]!.email);
  const [chat, setChat] = useState<IntakeChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState(0); // 1..3 running, 4 done
  const [analysis, setAnalysis] = useState<IntakeAnalysis | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const persona = END_USERS.find((u) => u.email === personaEmail)!;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, phase]);

  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  const resetConversation = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setChat([]);
    setInput('');
    setPhase('idle');
    setStep(0);
    setAnalysis(null);
    setRevealed(0);
    setSubmittedId(null);
    setDeflection(null);
  };

  const send = (text: string, who: EndUserProfile = persona, history: IntakeChatMessage[] = chat) => {
    const trimmed = text.trim();
    if (!trimmed || phase === 'analyzing') return;
    const userMsg: IntakeChatMessage = {
      id: uid(), from: 'user', text: trimmed, lang: detectLanguage(trimmed).lang,
      translation: KNOWN_TRANSLATIONS[trimmed], timestamp: new Date().toISOString(),
    };
    const conversation = [...history, userMsg];
    const result = analyzeIntake({
      requester: who, assets, saasApps,
      userMessages: conversation.filter((m) => m.from === 'user').map((m) => m.text),
    });

    // Self-service first: if a published self-service article answers this, offer it before any human gets involved.
    const match = aiSettings.autonomy !== 'suggest_only'
      ? findDeflectionArticle(conversation.filter((m) => m.from === 'user').map((m) => m.translation ?? m.text).join(' '), kbArticles, kbStats, aiSettings.confidenceThreshold)
      : null;

    // Live mode: Claude (via the FastAPI backend) answers; the local mapper is the fallback if the call fails.
    const livePromise = API_MODE === 'live'
      ? postIntake({
          message: trimmed, requester_name: who.name, requester_email: who.email,
          history: history.map((m) => ({ role: m.from === 'user' ? ('user' as const) : ('assistant' as const), content: m.text })),
          context: {
            assets: who.assetIds.map((id) => assets.find((x) => x.id === id)).filter(Boolean).map((x) => ({ id: x!.id, name: x!.name, os: x!.osVersion, filevault: x!.fileVault })),
            saas_apps: who.saasIds.map((id) => saasApps.find((x) => x.id === id)?.name).filter((x): x is string => !!x),
            kb_articles: kbArticles.map((k) => ({ id: k.id, title: k.title, summary: k.summary, steps: k.steps })),
          },
        }, { assets, saasApps })
      : null;

    setChat(conversation);
    setDeflection(null);
    setInput('');
    setPhase('analyzing');
    setAnalysis(null);
    setRevealed(0);
    setSubmittedId(null);
    setStep(1);
    later(stepMs, () => setStep(2));
    later(stepMs * 2, () => setStep(3));
    later(stepMs * 3, async () => {
      let final = result;
      if (livePromise) {
        const res = await livePromise;
        if (res.ok) {
          const body = res.body as IntakeApiResponse;
          final = mergeLive(result, body);
          setEngine(body.engine === 'claude' ? `Claude · ${body.model ?? ''}` : `API offline engine (${body.fallback_reason ?? 'fallback'})`);
        } else {
          setEngine('Offline intake mapper (API unreachable)');
        }
      }
      setStep(4);
      setAnalysis(final);
      setPhase('ready');
      setChat((c) => [
        ...c,
        {
          id: uid(), from: 'agent', text: final.replyNative, lang: final.replyLanguage,
          translation: final.replyLanguage !== 'en' ? final.replyEnglish : undefined, timestamp: new Date().toISOString(),
        },
      ]);
      if (match) setDeflection({ kbId: match.article.id, title: match.article.title, steps: match.article.steps, confidence: match.confidence });
      for (let i = 1; i <= SECTION_COUNT; i += 1) later(i * Math.max(1, stepMs / 3), () => setRevealed(i));
    });
  };

  const runPreset = (presetId: string) => {
    const preset = INTAKE_PRESETS.find((p) => p.id === presetId)!;
    const who = END_USERS.find((u) => u.email === preset.personaEmail)!;
    resetConversation();
    setPersonaEmail(who.email);
    send(preset.text, who, []);
  };

  const submit = () => {
    if (!analysis || phase !== 'ready') return;
    const id = createTicketFromIntake({ requester: persona, analysis, conversation: chat });
    const confirm = confirmationMessage(analysis.detectedLanguage, id, analysis.swarmSquad);
    setSubmittedId(id);
    setPhase('submitted');
    setChat((c) => [
      ...c,
      { id: uid(), from: 'agent', text: confirm.native, lang: confirm.lang, translation: confirm.lang !== 'en' ? confirm.english : undefined, timestamp: new Date().toISOString() },
    ]);
  };

  return (
    <div className="grid h-full min-h-[640px] lg:grid-cols-[3fr_2fr]">
      {/* ------------------------------------------------------------ left: chat */}
      <section className="flex min-h-0 flex-col border-white/[0.08] lg:border-r" aria-label="Conversational intake chat">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.08] px-5 py-3">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 shadow-[0_0_20px_rgba(99,102,241,0.35)]">
            <MessageCircleHeart className="size-4.5 text-white" />
          </span>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight">AdminZero Help</h1>
            <p className="text-xs text-slate-500">Write in any language — no forms.</p>
          </div>
          <span
            className={clsx('rounded-full border px-2 py-0.5 text-[10px] font-medium', engine.startsWith('Claude') ? 'border-sky-500/30 text-sky-300' : 'border-amber-500/30 text-amber-300')}
            title={API_MODE === 'live' ? 'Intake runs on the AdminZero API (Claude, with a deterministic fallback).' : 'No AI backend is configured for this build. A deterministic intake mapper runs in your browser; it switches to Claude when the FastAPI backend URL is set.'}
          >
            {engine}
          </span>
          <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
            Signed in as
            <select
              aria-label="Signed-in employee"
              value={personaEmail}
              onChange={(e) => {
                resetConversation();
                setPersonaEmail(e.target.value);
              }}
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500/60"
            >
              {END_USERS.map((u) => (
                <option key={u.email} value={u.email} className="bg-slate-900">
                  {u.name} · {u.department}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto scroll-smooth px-5 py-6">
          <AgentBubble text={`Hi ${persona.name.split(' ')[0]} 👋 I'm the AdminZero IT assistant. Tell me what's going on, in whatever language you like.`} lang="en" />
          {chat.map((m) => (m.from === 'user' ? <UserBubble key={m.id} message={m} /> : <AgentBubble key={m.id} text={m.text} lang={m.lang} />))}
          {deflection && phase === 'ready' && (
            <div className="az-pop-in ml-10 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 text-sm" aria-label="Suggested self-service fix">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300"><Sparkles className="size-3.5" />This usually fixes it ({deflection.kbId} · {Math.round(deflection.confidence * 100)}% match)</p>
              <p className="mt-1 font-medium text-slate-100">{deflection.title}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-200">{deflection.steps.map((st) => <li key={st}>{st}</li>)}</ol>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    recordDeflection(deflection.kbId, persona.name);
                    setPhase('deflected');
                    setChat((c) => [...c, { id: uid(), from: 'agent', text: `Great — glad that worked, ${persona.name.split(' ')[0]}! No ticket needed. If it comes back, just message me here.`, lang: 'en', timestamp: new Date().toISOString() }]);
                    setDeflection(null);
                  }}
                >
                  <Check className="size-3.5" />That fixed it
                </Button>
                <Button size="sm" onClick={() => setDeflection(null)}>I still need help</Button>
              </div>
            </div>
          )}
          {phase === 'deflected' && (
            <div className="az-pop-in ml-10 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 text-sm">
              <Check className="size-4 text-emerald-400" />
              <span className="text-emerald-200">Solved by self-service — no human needed.</span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={resetConversation}><RotateCcw className="size-3.5" />New conversation</Button>
            </div>
          )}
          {phase === 'analyzing' && (
            <div className="flex items-center gap-2 pl-10 text-xs text-slate-500" aria-live="polite">
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 animate-bounce rounded-full bg-indigo-400" style={{ animationDelay: `${i * 120}ms` }} />
                ))}
              </span>
              Assistant is typing…
            </div>
          )}
          {submittedId && (
            <div className="az-pop-in ml-10 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 text-sm">
              <Check className="size-4 text-emerald-400" />
              <span className="text-emerald-200">Routed as <span className="font-mono">{submittedId}</span></span>
              <Button size="sm" className="ml-auto" onClick={() => { setView('dashboard'); openInspector({ kind: 'ticket', id: submittedId }); }}>
                View on Swarm Board <ArrowRight className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={resetConversation}><RotateCcw className="size-3.5" />New conversation</Button>
            </div>
          )}
        </div>

        <div className="border-t border-white/[0.08] p-4">
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {INTAKE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => runPreset(p.id)}
                disabled={phase === 'analyzing'}
                className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-indigo-500/40 hover:text-slate-100 disabled:opacity-40"
              >
                <span className="rounded bg-white/[0.08] px-1 font-mono text-[10px]">{p.flag}</span>
                {p.label}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 focus-within:border-indigo-500/50"
          >
            <textarea
              aria-label="Message"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={phase === 'submitted' ? 'Start a new request…' : 'Describe your issue in any language…'}
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
            {input.trim().length >= 8 && (
              <span className="mb-2 rounded bg-white/[0.06] px-1.5 font-mono text-[10px] uppercase text-slate-400" title="Detected while you type">
                {detectLanguage(input).lang}
              </span>
            )}
            <Button type="submit" variant="primary" disabled={!input.trim() || phase === 'analyzing'} aria-label="Send">
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      </section>

      {/* ------------------------------------------------------------ right: live inspector */}
      <aside className="min-h-0 overflow-y-auto bg-[#0b101b]/60 p-5" aria-label="Live structured template inspector">
        <div className="mb-4 flex items-center gap-2">
          <FileJson className="size-4 text-indigo-400" />
          <h2 className="text-sm font-semibold tracking-tight">Live ITSM Template & CMDB Context</h2>
        </div>
        {phase === 'idle' ? (
          <IdleInspector />
        ) : (
          <div className="space-y-3">
            <ProgressSteps step={step} />
            {analysis && (
              <InspectorSections
                analysis={analysis}
                persona={persona}
                revealed={revealed}
                phase={phase}
                submittedId={submittedId}
                onSubmit={submit}
              />
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ chat bubbles

function UserBubble({ message: m }: { message: IntakeChatMessage }) {
  return (
    <div className="az-pop-in flex justify-end">
      <div className="max-w-[78%]">
        <div className="rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-[0_0_20px_rgba(99,102,241,0.2)]">
          {m.text}
        </div>
        <p className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-slate-500">
          <Languages className="size-3" />
          Detected <span className="rounded bg-white/[0.06] px-1 font-mono uppercase text-slate-300">{m.lang}</span>
          {LANGUAGE_NAMES[m.lang] ?? m.lang}
        </p>
      </div>
    </div>
  );
}

function AgentBubble({ text, lang }: { text: string; lang: string }) {
  return (
    <div className="az-pop-in flex gap-2.5">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sky-500/15 text-sky-300">
        <Bot className="size-4" />
      </span>
      <div className="max-w-[78%] rounded-2xl rounded-tl-md border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm leading-relaxed text-slate-100" lang={lang}>
        {text}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ inspector pieces

function IdleInspector() {
  return (
    <Card className="p-4 text-sm text-slate-400">
      <p>Send a message or pick a language preset. The intake agent will:</p>
      <ol className="mt-3 space-y-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2 text-xs">
            <span className="grid size-5 place-items-center rounded-full border border-white/[0.1] font-mono text-[10px] text-slate-400">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-slate-500">Predefined templates: <span className="font-mono text-slate-400">#INC-NET-04 · #SR-HW-01 · #SR-SAAS-09 · #CHG-SEC-02 · #INC-SEC-01</span></p>
    </Card>
  );
}

function ProgressSteps({ step }: { step: number }) {
  return (
    <Card className="p-3.5">
      <ol className="space-y-2" aria-label="AI progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = step > n;
          const active = step === n;
          return (
            <li key={label} className={clsx('flex items-center gap-2.5 text-xs transition', done ? 'text-slate-300' : active ? 'text-slate-100' : 'text-slate-600')}>
              <span className={clsx('grid size-5 place-items-center rounded-full border', done ? 'border-emerald-500/40 bg-emerald-500/15' : active ? 'border-indigo-500/50 bg-indigo-500/15' : 'border-white/[0.08]')}>
                {done ? <Check className="size-3 text-emerald-400" /> : active ? <Loader2 className="size-3 animate-spin text-indigo-300" /> : <span className="font-mono text-[10px]">{n}</span>}
              </span>
              {n}. {label}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <div className="az-pop-in">{children}</div>;
}

function SectionCard({ icon: Icon, title, children, right }: { icon: typeof Gauge; title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Card className="p-3.5">
      <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-slate-300">
        <Icon className="size-3.5 text-indigo-400" />
        {title}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </Card>
  );
}

function InspectorSections({ analysis: a, persona, revealed, phase, submittedId, onSubmit }: {
  analysis: IntakeAnalysis; persona: EndUserProfile; revealed: number; phase: Phase; submittedId: string | null; onSubmit: () => void;
}) {
  const flags = usePlatformStore((s) => s.flags);
  const assets = usePlatformStore((s) => s.assets);
  const saasApps = usePlatformStore((s) => s.saasApps);
  const openInspector = usePlatformStore((s) => s.openInspector);
  const asset = assets.find((x) => x.id === a.linkedAssetId);
  const licences = persona.saasIds.map((id) => saasApps.find((s) => s.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  const mentioned = a.linkedSaasId ? saasApps.find((s) => s.id === a.linkedSaasId) : undefined;
  const missing = a.fields.filter((f) => f.critical && !f.value);
  const native = a.replyLanguage === a.detectedLanguage;

  return (
    <>
      <Reveal show={revealed >= 1}>
        <SectionCard icon={Gauge} title="Language, sentiment & auto-priority">
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-slate-500">Language</dt>
              <dd className="mt-0.5 font-medium text-slate-100">
                <span className="mr-1 rounded bg-white/[0.06] px-1 font-mono text-[10px] uppercase">{a.detectedLanguage}</span>
                {LANGUAGE_NAMES[a.detectedLanguage] ?? a.detectedLanguage}
                <span className="ml-1 font-mono text-[10px] text-slate-500">{Math.round(a.languageConfidence * 100)}%</span>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Sentiment</dt>
              <dd className={clsx('mt-0.5 font-medium', a.sentiment === 'Urgent Client Impact' ? 'text-rose-300' : a.sentiment === 'Frustrated' ? 'text-amber-300' : 'text-slate-100')}>{a.sentiment}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Priority</dt>
              <dd className="mt-0.5"><PriorityBadge priority={a.priority} /></dd>
            </div>
          </dl>
          <ul className="mt-2.5 space-y-0.5 border-t border-white/[0.06] pt-2 font-mono text-[11px] text-slate-400">
            {a.priorityReasons.map((r) => <li key={r}>› {r}</li>)}
          </ul>
          {a.sentimentSignals.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {a.sentimentSignals.map((s) => <span key={s} className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-slate-400">{s}</span>)}
            </div>
          )}
        </SectionCard>
      </Reveal>

      <Reveal show={revealed >= 2}>
        <SectionCard icon={MessageCircleHeart} title="Empathetic reply" right={<span className="font-mono text-[10px] uppercase text-slate-500">{a.replyLanguage} → en</span>}>
          <p className="text-sm leading-relaxed text-slate-100" lang={a.replyLanguage}>{a.replyNative}</p>
          {a.replyLanguage !== 'en' && (
            <p className="mt-2 flex gap-1.5 rounded-lg border border-sky-500/15 bg-sky-500/[0.06] px-2.5 py-2 text-xs text-sky-100">
              <Languages className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
              <span><span className="font-medium text-sky-300">English for the agent:</span> {a.replyEnglish}</span>
            </p>
          )}
          {!native && (
            <p className="mt-2 text-[11px] text-amber-300/90">
              Native replies are available offline in {NATIVE_REPLY_LANGUAGES.map((l) => l.toUpperCase()).join(', ')}; replied in English. Connect the AI backend for {LANGUAGE_NAMES[a.detectedLanguage] ?? a.detectedLanguage}.
            </p>
          )}
        </SectionCard>
      </Reveal>

      <Reveal show={revealed >= 3}>
        <SectionCard
          icon={FileJson}
          title="Matched predefined template"
          right={<span className="font-mono text-[11px] text-indigo-300">{Math.round(a.templateConfidence * 100)}% match</span>}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-xs text-indigo-200">{a.templateId}</span>
            <span className="text-sm text-slate-100">{a.templateName}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{a.ticketType.replace('_', ' ')} → {a.swarmSquad} swarm</p>
          <dl className="mt-2.5 divide-y divide-white/[0.05] rounded-lg border border-white/[0.06] font-mono text-[11px]">
            {a.fields.map((f, i) => (
              <div key={f.key} className="az-pop-in grid grid-cols-[130px_1fr] gap-2 px-2.5 py-1.5" style={{ animationDelay: `${i * 90}ms`, animationFillMode: 'both' }}>
                <dt className="text-slate-500">{f.label}{f.critical && <span className="text-rose-400">*</span>}</dt>
                <dd className={f.value ? 'text-slate-200' : 'text-amber-300'}>{f.value ?? (f.critical ? 'Missing — asked user' : '—')}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-slate-500">Approvals: <span className="text-slate-300">{a.requiredApprovals.length ? a.requiredApprovals.join(', ') : 'None required'}</span></p>
          {a.recommendedMacro && flags.ai_agents && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-indigo-300"><Sparkles className="size-3" />Pre-staged macro: {a.recommendedMacro.label}</p>
          )}
        </SectionCard>
      </Reveal>

      {flags.itam_cmdb && (
        <Reveal show={revealed >= 4}>
          <SectionCard icon={Laptop} title="Auto-attached CMDB asset">
            {asset ? (
              <button type="button" onClick={() => openInspector({ kind: 'asset', id: asset.id })} className="flex w-full items-center gap-3 rounded-lg border border-white/[0.06] p-2.5 text-left transition hover:border-white/[0.16]">
                <Cpu className="size-4 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs text-slate-200">{asset.id} · {asset.serialNumber}</span>
                  <span className="block truncate text-xs text-slate-400">{asset.name} · {asset.osVersion}</span>
                </span>
                <span className="text-right text-[10px]">
                  <span className={asset.mdmEnrolled ? 'text-emerald-300' : 'text-rose-300'}>{asset.mdmEnrolled ? 'MDM ✓' : 'No MDM'}</span>
                  <span className="block text-slate-500">FileVault {asset.fileVault}</span>
                </span>
              </button>
            ) : (
              <p className="text-xs text-slate-500">
                {persona.assetIds.length ? 'Not relevant to this request type.' : `${persona.name} has no hardware assigned in the CMDB.`}
              </p>
            )}
          </SectionCard>
        </Reveal>
      )}

      {flags.torii_saas && (
        <Reveal show={revealed >= 5}>
          <SectionCard icon={Cloud} title={`Active SaaS licences for ${persona.name.split(' ')[0]}`}>
            <div className="flex flex-wrap gap-1.5">
              {licences.map((app) => (
                <button key={app.id} type="button" onClick={() => openInspector({ kind: 'saas', id: app.id })} className="az-chip">{app.name}</button>
              ))}
              {mentioned && !persona.saasIds.includes(mentioned.id) && (
                <button type="button" onClick={() => openInspector({ kind: 'saas', id: mentioned.id })} className="az-chip border-indigo-500/40 text-indigo-200">
                  + {mentioned.name} (requested · {mentioned.inactiveUsers.length} idle seats)
                </button>
              )}
            </div>
          </SectionCard>
        </Reveal>
      )}

      <Reveal show={revealed >= SECTION_COUNT}>
        <div className="sticky bottom-0 -mx-5 -mb-5 space-y-2 border-t border-white/[0.06] bg-[#0b101b]/95 px-5 pb-5 pt-3 backdrop-blur-md">
          {missing.length > 0 && phase !== 'submitted' && (
            <p className="flex items-center gap-1.5 text-xs text-amber-300">
              <AlertTriangle className="size-3.5" />Waiting on the user for: {missing.map((f) => f.label.toLowerCase()).join(', ')}. You can still submit now.
            </p>
          )}
          <Button variant="primary" className="w-full" onClick={onSubmit} disabled={phase !== 'ready'} title={phase === 'deflected' ? 'Resolved by self-service — no ticket needed' : undefined}>
            {submittedId ? <><Check className="size-4" />Routed as {submittedId}</> : <>Submit & Route to Swarm Queue <ArrowRight className="size-4" /></>}
          </Button>
        </div>
      </Reveal>
    </>
  );
}
