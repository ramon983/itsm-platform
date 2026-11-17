/**
 * Agent-Assist Copilot (offline, grounded). Every suggestion cites its source: a closed ticket, a KB
 * article, or CMDB telemetry. Nothing is suggested without a source, and nothing runs without a human.
 */
import { TfIdf, cosine, sharedTerms } from '@/lib/similarity';
import type { AiSettings, ClosedTicket, HardwareAsset, KbArticle, KbStats, Ticket } from '@/types/platform';

export interface CopilotSubject {
  id: string;
  title: string;
  text: string; // description + conversation, English where available
  templateId?: string;
  requesterName?: string;
  requesterLanguage?: string;
  linkedAssetId?: string;
  linkedKbId?: string;
  recommendedMacro?: Ticket['recommendedMacro'];
}

export interface SimilarTicket {
  ticket: ClosedTicket;
  similarity: number;
  matchedTerms: string[];
}

export interface KbMatch {
  article: KbArticle;
  confidence: number;
  reasons: string[];
}

export interface CopilotResult {
  similar: SimilarTicket[];
  kbMatches: KbMatch[];
  bestKb: KbMatch | null;
  grounded: boolean;
  aboveThreshold: boolean;
  summary: string;
  nextBestAction: string;
  draftReply: { native: string; english: string; lang: string };
  sources: string[];
  internetFallback: string | null;
}

// Basic IT questions the AI may answer from public knowledge when nothing internal matches (if enabled in Admin).
const BASIC_IT: [RegExp, string][] = [
  [/\b(clear|empty)\b.*\bcache\b|\bcache\b.*\bbrowser\b/i, 'Public guidance: clear the browser cache (Chrome: Settings → Privacy → Clear browsing data).'],
  [/\bprinter\b/i, 'Public guidance: power-cycle the printer, then remove and re-add it in System Settings → Printers.'],
  [/\b(wi-?fi|wireless)\b/i, 'Public guidance: toggle Wi-Fi off/on and forget-then-rejoin the network.'],
  [/\b(slow|freez|frozen|crash)/i, 'Public guidance: quit unused apps, check Activity Monitor for runaway processes, then restart.'],
];

const REPLY: Record<string, { progress: (first: string, kb?: string) => string; resolved: (first: string, kb: string) => string }> = {
  en: {
    progress: (f, kb) => `Hi ${f}, thanks for your patience — I'm working on this now${kb ? ` and following our verified fix (${kb})` : ''}. I'll update you within the hour.`,
    resolved: (f, kb) => `Hi ${f}, I've applied the fix from ${kb}. Could you check that everything works now? If not, just reply and I'll jump back in.`,
  },
  es: {
    progress: (f, kb) => `Hola ${f}, gracias por tu paciencia: ya estoy trabajando en esto${kb ? ` siguiendo nuestra solución verificada (${kb})` : ''}. Te actualizo antes de una hora.`,
    resolved: (f, kb) => `Hola ${f}, he aplicado la solución de ${kb}. ¿Puedes comprobar si ya funciona todo? Si no, respóndeme y lo retomo enseguida.`,
  },
  fr: {
    progress: (f, kb) => `Bonjour ${f}, merci de votre patience — je m'en occupe maintenant${kb ? ` en suivant notre solution validée (${kb})` : ''}. Je reviens vers vous dans l'heure.`,
    resolved: (f, kb) => `Bonjour ${f}, j'ai appliqué la solution de ${kb}. Pouvez-vous vérifier que tout fonctionne ? Sinon, répondez-moi et je reprends tout de suite.`,
  },
  de: {
    progress: (f, kb) => `Hallo ${f}, danke für Ihre Geduld – ich arbeite gerade daran${kb ? ` und folge unserer geprüften Lösung (${kb})` : ''}. Ich melde mich innerhalb einer Stunde.`,
    resolved: (f, kb) => `Hallo ${f}, ich habe die Lösung aus ${kb} angewendet. Können Sie prüfen, ob jetzt alles funktioniert? Falls nicht, antworten Sie einfach.`,
  },
  ja: {
    progress: (f, kb) => `${f}さん、お待たせしております。現在対応中です${kb ? `（検証済みの手順 ${kb} に沿って作業しています）` : ''}。1時間以内に状況をご連絡します。`,
    resolved: (f, kb) => `${f}さん、${kb}の手順で対応しました。問題が解決したかご確認いただけますか？解決していない場合はご返信ください。`,
  },
  pt: {
    progress: (f, kb) => `Olá ${f}, obrigado pela paciência — já estou cuidando disso${kb ? ` seguindo nossa solução validada (${kb})` : ''}. Volto com uma atualização em até uma hora.`,
    resolved: (f, kb) => `Olá ${f}, apliquei a solução do ${kb}. Pode verificar se está tudo funcionando? Se não, é só responder que eu retomo.`,
  },
  it: {
    progress: (f, kb) => `Ciao ${f}, grazie per la pazienza: ci sto lavorando ora${kb ? ` seguendo la nostra soluzione verificata (${kb})` : ''}. Ti aggiorno entro un'ora.`,
    resolved: (f, kb) => `Ciao ${f}, ho applicato la soluzione di ${kb}. Puoi verificare che ora funzioni tutto? Altrimenti rispondimi e riprendo subito.`,
  },
};

export function draftReply(kind: 'progress' | 'resolved', lang: string, requesterName: string, kbId?: string) {
  const first = requesterName.split(' ')[0] ?? requesterName;
  const book = REPLY[lang] ?? REPLY.en!;
  const replyLang = REPLY[lang] ? lang : 'en';
  const make = (b: (typeof REPLY)['en']) => (kind === 'resolved' && kbId ? b.resolved(first, kbId) : b.progress(first, kbId));
  return { native: make(book), english: make(REPLY.en!), lang: replyLang };
}

export function runCopilot(
  subject: CopilotSubject,
  ctx: {
    closed: readonly ClosedTicket[];
    kbArticles: readonly KbArticle[];
    kbStats: Readonly<Record<string, KbStats>>;
    assets: readonly HardwareAsset[];
    settings: AiSettings;
  },
): CopilotResult {
  const { closed, kbArticles, assets, settings } = ctx;
  const query = `${subject.title} ${subject.title} ${subject.text}`;
  const corpus = [...closed.map((t) => `${t.title} ${t.summary}`), ...kbArticles.map((k) => `${k.title} ${k.summary} ${k.steps.join(' ')}`)];
  const engine = new TfIdf(corpus);
  const q = engine.vector(query);

  const similar: SimilarTicket[] = settings.sources.closedTickets
    ? closed
        .map((t) => {
          const v = engine.vector(`${t.title} ${t.title} ${t.summary}`);
          const templateBoost = subject.templateId && subject.templateId === t.templateId ? 0.08 : 0;
          return { ticket: t, similarity: Math.min(0.99, cosine(q, v) + templateBoost), matchedTerms: sharedTerms(q, v) };
        })
        .filter((s) => s.similarity >= 0.2 && s.matchedTerms.length >= 1)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 4)
    : [];

  const kbMatches: KbMatch[] = settings.sources.knowledgeBase
    ? kbArticles
        .map((article) => {
          const sim = cosine(q, engine.vector(`${article.title} ${article.summary} ${article.steps.join(' ')}`));
          const usedBy = similar.filter((s) => s.ticket.kbId === article.id);
          const support = similar.length ? usedBy.length / similar.length : 0;
          const reasons = [`${Math.round(sim * 100)}% text match`];
          if (usedBy.length) reasons.push(`used to resolve ${usedBy.length} of ${similar.length} similar tickets`);
          if (subject.linkedKbId === article.id) reasons.push('already linked to this record');
          // Two independent signals; the stronger one wins. Evidence = how often this article actually fixed similar tickets.
          const textConfidence = Math.min(0.9, sim * 1.6);
          const evidenceConfidence = usedBy.length ? 0.5 + 0.35 * support + (usedBy.length >= 2 ? 0.1 : 0) : 0;
          const confidence = Math.min(0.97, Math.max(textConfidence, evidenceConfidence) + (subject.linkedKbId === article.id ? 0.1 : 0));
          return { article, confidence, reasons };
        })
        .filter((m) => m.confidence >= 0.25)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3)
    : [];

  const bestKb = kbMatches[0] ?? null;
  const grounded = !!bestKb || similar.length > 0;
  const aboveThreshold = !!bestKb && bestKb.confidence >= settings.confidenceThreshold;
  const asset = subject.linkedAssetId ? assets.find((a) => a.id === subject.linkedAssetId) : undefined;

  const sources = [
    ...(bestKb ? [`${bestKb.article.id} ${bestKb.article.title}`] : []),
    ...similar.slice(0, 2).map((s) => `${s.ticket.id} (closed, ${s.ticket.resolvedBy})`),
    ...(asset && settings.sources.cmdb ? [`CMDB ${asset.id}: MDM ${asset.mdmEnrolled ? 'enrolled' : 'not enrolled'}, FileVault ${asset.fileVault}, ${asset.osVersion}`] : []),
  ];

  const commonFix = similar[0]?.ticket.resolution;
  const summary = grounded
    ? `${similar.length ? `${similar.length} similar ticket${similar.length === 1 ? '' : 's'}` : 'No similar tickets'} resolved in the last 30 days${
        similar.length ? ` (median ${Math.round(similar.map((s) => s.ticket.minutesToResolve).sort((a, b) => a - b)[Math.floor(similar.length / 2)]!)} min)` : ''
      }.${commonFix ? ` Most recent fix: “${commonFix}”` : ''}${bestKb ? ` Best article: ${bestKb.article.id} (${Math.round(bestKb.confidence * 100)}% confidence).` : ''}`
    : 'No internal match in the knowledge base or closed tickets. Gather more detail before acting.';

  const nextBestAction = subject.recommendedMacro
    ? `Run “${subject.recommendedMacro.label}” (needs your approval), then confirm with the requester.`
    : aboveThreshold
      ? `Follow ${bestKb!.article.id}: ${bestKb!.article.steps[0]}`
      : bestKb
        ? `Review ${bestKb.article.id} — confidence ${Math.round(bestKb.confidence * 100)}% is below the ${Math.round(settings.confidenceThreshold * 100)}% auto-suggest threshold.`
        : 'Ask the requester for the exact error message and when it started.';

  const internetFallback =
    !grounded && settings.sources.internetFallback ? BASIC_IT.find(([re]) => re.test(query))?.[1] ?? null : null;

  return {
    similar,
    kbMatches,
    bestKb,
    grounded,
    aboveThreshold,
    summary,
    nextBestAction,
    draftReply: draftReply('progress', subject.requesterLanguage ?? 'en', subject.requesterName ?? 'there', bestKb?.article.id),
    sources,
    internetFallback,
  };
}

/** Plain-text context for a ticket, using English translations where they exist. */
export function ticketSubject(t: Ticket): CopilotSubject {
  return {
    id: t.id,
    title: t.title,
    text: t.messages.map((m) => m.translatedText && m.originalLang !== 'en' ? m.translatedText : m.originalText).join(' '),
    templateId: t.templateId,
    requesterName: t.requesterName,
    requesterLanguage: t.detectedLanguage,
    linkedAssetId: t.linkedAssetId,
    linkedKbId: t.linkedKbId,
    recommendedMacro: t.status === 'RESOLVED_KB_LINKED' ? undefined : t.recommendedMacro,
  };
}
