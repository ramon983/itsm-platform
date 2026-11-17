/**
 * Offline intake mapper — the deterministic structured fallback for the Conversational Intake Agent.
 * Detects language, sentiment and urgency, maps the conversation onto a predefined ITSM template,
 * attaches the requester's CMDB + SaaS context and drafts an empathetic reply in their language.
 * It never invents fixes: the only self-service step it offers comes from a published KB article.
 */
import type {
  EndUserProfile,
  HardwareAsset,
  IntakeAnalysis,
  IntakeField,
  IntakeTemplateId,
  SaasApp,
  SwarmSquad,
  Ticket,
  TicketPriority,
} from '@/types/platform';

// ------------------------------------------------------------------ presets

export interface IntakePreset {
  id: string;
  flag: string;
  label: string;
  personaEmail: string;
  text: string;
  translation: string;
}

export const INTAKE_PRESETS: IntakePreset[] = [
  {
    id: 'es-vpn', flag: 'ES', label: 'Spanish · VPN drop before client pitch', personaEmail: 'maria.gonzalez@adminzero.io',
    text: 'Hola, no puedo conectarme a la VPN desde esta mañana y tengo una presentación con un cliente en 45 minutos.',
    translation: "Hi, I haven't been able to connect to the VPN since this morning and I have a client presentation in 45 minutes.",
  },
  {
    id: 'fr-screen', flag: 'FR', label: 'French · Cracked MacBook screen', personaEmail: 'camille.laurent@adminzero.io',
    text: "Bonjour, mon écran MacBook Pro est fissuré, j'ai besoin d'un ordinateur de prêt avant mon déplacement jeudi.",
    translation: 'Hello, my MacBook Pro screen is cracked, I need a loaner computer before my trip on Thursday.',
  },
  {
    id: 'ja-figma', flag: 'JA', label: 'Japanese · Figma licence request', personaEmail: 'haruto.tanaka@adminzero.io',
    text: '来週のデザインスプリントのためにFigmaの編集ライセンスを付与してください。',
    translation: "Please grant me a Figma editor licence for next week's design sprint.",
  },
  {
    id: 'de-saml', flag: 'DE', label: 'German · Emergency Okta SAML change', personaEmail: 'lukas.becker@adminzero.io',
    text: 'Wir benötigen heute Abend um 22:00 Uhr ein Notfall-Wartungsfenster für das Okta SAML-Zertifikat.',
    translation: 'We need an emergency maintenance window tonight at 22:00 for the Okta SAML certificate.',
  },
  {
    id: 'en-outlook', flag: 'EN', label: 'English · Outlook calendar not syncing', personaEmail: 'priya.shah@adminzero.io',
    text: 'My Outlook calendar is not syncing with Exchange again — meetings are missing.',
    translation: 'My Outlook calendar is not syncing with Exchange again — meetings are missing.',
  },
];

export const KNOWN_TRANSLATIONS: Record<string, string> = Object.fromEntries(INTAKE_PRESETS.map((p) => [p.text, p.translation]));

// ------------------------------------------------------------------ language detection

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese', pt: 'Portuguese', it: 'Italian',
  nl: 'Dutch', zh: 'Chinese', ko: 'Korean', ru: 'Russian', ar: 'Arabic',
};

const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'a', 'an', 'and', 'is', 'i', 'my', 'to', 'for', 'with', 'not', "can't", 'cannot', 'please', 'hi', 'hello', 'on', 'in', 'of', 'it', 'we', 'need', 'since', 'this', 'have', 'our', 'me', 'you', 'keeps'],
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'no', 'puedo', 'con', 'desde', 'esta', 'tengo', 'por', 'para', 'mi', 'es', 'se', 'del', 'al', 'hola', 'gracias', 'necesito', 'mañana', 'me'],
  fr: ['le', 'la', 'les', 'de', 'des', 'un', 'une', 'et', 'est', 'je', 'mon', 'ma', 'mes', 'pour', 'avec', 'pas', 'ne', 'avant', 'bonjour', 'merci', 'besoin', 'du', 'sur', 'dans', 'ai', 'j', 'nous', 'vous'],
  de: ['der', 'die', 'das', 'und', 'ist', 'ich', 'wir', 'nicht', 'ein', 'eine', 'für', 'mit', 'um', 'uhr', 'heute', 'abend', 'benötigen', 'brauche', 'mein', 'meine', 'auf', 'zu', 'den', 'dem', 'hallo', 'danke', 'bitte', 'kann'],
  pt: ['o', 'os', 'as', 'de', 'que', 'e', 'em', 'um', 'uma', 'não', 'consigo', 'com', 'para', 'meu', 'minha', 'toda', 'vez', 'quando', 'olá', 'obrigado', 'está', 'são', 'preciso', 'caem'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'di', 'che', 'e', 'non', 'riesco', 'un', 'una', 'per', 'con', 'mio', 'mia', 'ciao', 'grazie', 'sono', 'ho', 'del', 'della', 'è', 'mi', 'bisogno'],
  nl: ['de', 'het', 'een', 'en', 'ik', 'niet', 'van', 'met', 'voor', 'mijn', 'is', 'kan', 'hallo', 'bedankt', 'werkt', 'graag'],
};

const CHAR_HINTS: [RegExp, string, number][] = [
  [/[ñ¿¡]/g, 'es', 3],
  [/[ãõ]/g, 'pt', 3],
  [/[ßäöü]/g, 'de', 3],
  [/[œêëîû]/g, 'fr', 2],
  [/[èàù]/g, 'fr', 1],
  [/[ìò]/g, 'it', 2],
];

export function detectLanguage(text: string): { lang: string; confidence: number } {
  if (/[぀-ヿ]/.test(text)) return { lang: 'ja', confidence: 0.99 };
  if (/[가-힯]/.test(text)) return { lang: 'ko', confidence: 0.99 };
  if (/[一-鿿]/.test(text)) return { lang: 'zh', confidence: 0.95 };
  if (/[Ѐ-ӿ]/.test(text)) return { lang: 'ru', confidence: 0.95 };
  if (/[؀-ۿ]/.test(text)) return { lang: 'ar', confidence: 0.95 };

  const lower = text.toLowerCase();
  const words = lower.match(/[\p{L}]+/gu) ?? [];
  const scores: Record<string, number> = {};
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    scores[lang] = words.filter((w) => set.has(w)).length;
  }
  for (const [re, lang, weight] of CHAR_HINTS) scores[lang] = (scores[lang] ?? 0) + (lower.match(re)?.length ?? 0) * weight;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0]!;
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  if (!bestScore) return { lang: 'en', confidence: 0.5 };
  return { lang: best, confidence: Math.min(0.99, Math.max(0.55, bestScore / total + 0.2)) };
}

// ------------------------------------------------------------------ term matching

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Latin terms match at a word start (so "conect" matches "conectarme"); 1-3 letter terms must be whole words. CJK terms match anywhere. */
export function hasTerm(text: string, term: string): boolean {
  const lower = text.toLowerCase();
  if (!/^[\p{Script=Latin}\s'’-]+$/u.test(term)) return lower.includes(term.toLowerCase());
  const t = escape(term.toLowerCase());
  // Boundaries only consider Latin letters, so "Figma" is found inside Japanese text (…ためにFigmaの…).
  const tail = term.length <= 3 ? '(?![\\p{Script=Latin}])' : '';
  return new RegExp(`(^|[^\\p{Script=Latin}])${t}${tail}`, 'u').test(lower);
}

const firstMatch = (text: string, terms: string[]) => terms.find((t) => hasTerm(text, t)) ?? null;

// ------------------------------------------------------------------ templates

type Family = 'NET' | 'HW' | 'SAAS' | 'CHG' | 'SEC' | 'GEN';

interface TemplateDef {
  id: IntakeTemplateId;
  family: Family;
  name: string;
  ticketType: Ticket['type'];
  squad: SwarmSquad;
  basePriority: TicketPriority;
  approvals: string[];
  keywords: string[];
}

export const TEMPLATE_CATALOG: TemplateDef[] = [
  {
    id: '#INC-SEC-01', family: 'SEC', name: 'Security incident (phishing / account compromise)', ticketType: 'INCIDENT',
    squad: 'Security & SIEM', basePriority: 'P1', approvals: ['Security on-call'],
    keywords: ['phishing', 'hacked', 'hackead', 'piraté', 'gehackt', 'ハッキング', 'suspicious', 'sospechos', 'suspect', 'verdächtig', '不審',
      'malware', 'virus', 'compromised', 'comprometid', 'mfa push', 'push spam', 'unknown login', 'sospett', 'suspeit'],
  },
  {
    id: '#CHG-SEC-02', family: 'CHG', name: 'Emergency security change', ticketType: 'CHANGE', squad: 'Network & Identity',
    basePriority: 'P2', approvals: ['CAB (emergency)', 'Service owner'],
    keywords: ['maintenance', 'mantenimiento', 'wartung', 'fenêtre', 'ventana', 'change request', 'änderung', 'changement', 'cambio',
      'certificat', 'certific', 'zertifikat', '証明書', 'saml', 'rotation', 'rotate', 'deploy', 'notfall-wartung', 'メンテナンス', 'manutenção', 'manutenzione'],
  },
  {
    id: '#INC-NET-04', family: 'NET', name: 'VPN / network connectivity', ticketType: 'INCIDENT', squad: 'Network & Identity',
    basePriority: 'P2', approvals: [],
    keywords: ['vpn', 'anyconnect', 'globalprotect', 'wi-fi', 'wifi', 'network', 'internet', 'connect', 'conect', 'connexion', 'connecter',
      'réseau', 'red', 'netz', 'verbind', 'rede', 'conex', 'rete', 'collegar', '接続', 'ネットワーク'],
  },
  {
    id: '#SR-HW-01', family: 'HW', name: 'Hardware damage / loaner device', ticketType: 'SERVICE_REQUEST', squad: 'Endpoint & Mac',
    basePriority: 'P3', approvals: ['Manager'],
    keywords: ['screen', 'display', 'pantalla', 'écran', 'bildschirm', '画面', 'cracked', 'broken', 'fissur', 'cassé', 'roto', 'rota',
      'kaputt', 'gebroch', 'gesprungen', '割れ', 'laptop', 'macbook', 'ordinateur', 'ordenador', 'portátil', 'computer', 'keyboard',
      'teclado', 'clavier', 'tastatur', 'battery', 'batería', 'batterie', 'loaner', 'prêt', 'préstamo', 'leihgerät', '貸出', '代替機',
      'tela', 'quebrad', 'schermo', 'rotto', 'empréstimo', 'prestito'],
  },
  {
    id: '#SR-SAAS-09', family: 'SAAS', name: 'SaaS licence / access request', ticketType: 'SERVICE_REQUEST', squad: 'SaaS & Cloud Ops',
    basePriority: 'P3', approvals: ['Manager (auto-approved: standard catalogue)'],
    keywords: ['licen', 'lizenz', 'ライセンス', 'seat', 'access', 'acceso', 'accès', 'zugang', 'zugriff', 'acesso', 'accesso', 'figma',
      'slack', 'salesforce', 'notion', 'datadog', 'zoom', 'adobe', '付与', '権限', 'permission', 'permiso', 'berechtigung'],
  },
];

const GENERIC: TemplateDef = {
  id: '#INC-GEN-01', family: 'GEN', name: 'General IT request', ticketType: 'INCIDENT', squad: 'Endpoint & Mac',
  basePriority: 'P3', approvals: [], keywords: [],
};

export function matchTemplate(text: string): { template: TemplateDef; hits: string[]; confidence: number } {
  let best: { template: TemplateDef; hits: string[] } = { template: GENERIC, hits: [] };
  for (const template of TEMPLATE_CATALOG) {
    const hits = template.keywords.filter((k) => hasTerm(text, k));
    if (hits.length > best.hits.length) best = { template, hits };
  }
  const confidence = best.template === GENERIC ? 0.35 : Math.min(0.99, 0.62 + best.hits.length * 0.09);
  return { ...best, confidence };
}

// ------------------------------------------------------------------ signal extraction

const SAAS_ALIASES: [string, string][] = [
  ['figma', 'saas-figma'], ['notion', 'saas-notion'], ['okta', 'saas-okta'], ['salesforce', 'saas-salesforce'],
  ['slack', 'saas-slack'], ['datadog', 'saas-datadog'],
];
const TONIGHT = ['tonight', 'esta noche', 'ce soir', 'heute abend', 'stasera', 'hoje à noite', '今夜', '今晩', '本日'];
const URGENT_WORDS = ['urgent', 'urgente', 'urgence', 'dringend', 'notfall', '緊急', 'emergency', 'emergencia', 'asap', 'sofort', '至急', 'immédiatement', 'emergência', 'emergenza'];
const CLIENT_WORDS = ['client', 'cliente', 'kunde', 'kunden', 'customer', 'クライアント', '顧客', 'お客様'];
const PRESENTATION_WORDS = ['presentation', 'presentación', 'présentation', 'präsentation', 'apresentação', 'presentazione', 'pitch', 'demo', 'プレゼン'];
const FRUSTRATION = ['no puedo', 'je ne peux pas', 'ich kann nicht', 'できません', "can't", 'cannot', 'não consigo', 'non riesco', 'again',
  'otra vez', 'de nuevo', 'encore', 'schon wieder', 'still not', 'todavía', 'toujours pas', 'immer noch', 'ainda', 'ancora', 'frustrat',
  'caem', 'se cae', 'keeps dropping', 'tombe', 'fällt'];
const SINCE: [string[], string][] = [
  [['since this morning', 'desde esta mañana', 'depuis ce matin', 'seit heute morgen', '今朝', 'desde hoje de manhã', 'da stamattina'], 'This morning'],
  [['since yesterday', 'desde ayer', 'depuis hier', 'seit gestern', '昨日から', 'desde ontem', 'da ieri'], 'Yesterday'],
];
const DAYS: [string[], string][] = [
  [['monday', 'lunes', 'lundi', 'montag', '月曜', 'segunda', 'lunedì'], 'Monday'],
  [['tuesday', 'martes', 'mardi', 'dienstag', '火曜', 'terça', 'martedì'], 'Tuesday'],
  [['wednesday', 'miércoles', 'mercredi', 'mittwoch', '水曜', 'quarta', 'mercoledì'], 'Wednesday'],
  [['thursday', 'jueves', 'jeudi', 'donnerstag', '木曜', 'quinta', 'giovedì'], 'Thursday'],
  [['friday', 'viernes', 'vendredi', 'freitag', '金曜', 'sexta', 'venerdì'], 'Friday'],
  [['next week', 'semana que viene', 'próxima semana', 'semaine prochaine', 'nächste woche', '来週', 'prossima settimana', 'semana que vem'], 'Next week'],
];
const LOANER = ['loaner', 'prêt', 'préstamo', 'leihgerät', '代替機', '貸出', 'empréstimo', 'prestito', 'replacement laptop'];
const EDITOR = ['edit', 'editor', '編集', 'édition', 'bearbeit', 'edición', 'edição', 'modifica'];
const SPRINT = ['design sprint', 'デザインスプリント', 'sprint', 'スプリント'];
const PROJECT = ['project', 'proyecto', 'projet', 'projekt', 'progetto', 'projeto', 'プロジェクト'];

interface Signals {
  deadlineMinutes: number | null;
  clockTime: string | null;
  tonight: boolean;
  urgentWord: string | null;
  client: boolean;
  presentation: boolean;
  frustration: string | null;
  since: string | null;
  neededBy: { en: string; native: string } | null;
  loaner: boolean;
  editor: boolean;
  businessReason: string | null;
  saasId: string | null;
  saml: boolean;
  vpn: boolean;
  screenDamage: boolean;
}

function extractSignals(text: string): Signals {
  const lower = text.toLowerCase();
  const minutes = lower.match(/(\d{1,3})\s*(?:min(?:ute)?s?|minutos?|minuten|minuti|分)/);
  const hours = lower.match(/(\d{1,2})\s*(?:hours?|horas?|heures?|stunden?|ore|時間)/);
  const clock = lower.match(/\b(\d{1,2})[:h](\d{2})\b/) ?? lower.match(/\b(\d{1,2})\s*uhr\b/);
  const day = DAYS.map(([terms, en]) => {
    const native = firstMatch(text, terms);
    return native ? { en, native: text.slice(lower.indexOf(native), lower.indexOf(native) + native.length) } : null;
  }).find(Boolean) ?? null;
  const saas = SAAS_ALIASES.find(([alias]) => hasTerm(text, alias));
  return {
    deadlineMinutes: minutes ? Number(minutes[1]) : hours ? Number(hours[1]) * 60 : null,
    clockTime: clock ? `${clock[1]!.padStart(2, '0')}:${clock[2] ?? '00'}` : null,
    tonight: !!firstMatch(text, TONIGHT),
    urgentWord: firstMatch(text, URGENT_WORDS),
    client: !!firstMatch(text, CLIENT_WORDS),
    presentation: !!firstMatch(text, PRESENTATION_WORDS),
    frustration: firstMatch(text, FRUSTRATION) ?? (/[!！]{2,}/.test(text) ? '!!' : null),
    since: SINCE.find(([terms]) => firstMatch(text, terms))?.[1] ?? null,
    neededBy: day,
    loaner: !!firstMatch(text, LOANER),
    editor: !!firstMatch(text, EDITOR),
    businessReason: firstMatch(text, SPRINT) ? 'Design sprint' : firstMatch(text, PRESENTATION_WORDS) ? 'Client presentation' : firstMatch(text, PROJECT) ? 'Project work' : null,
    saasId: saas?.[1] ?? null,
    saml: hasTerm(text, 'saml'),
    vpn: hasTerm(text, 'vpn') || hasTerm(text, 'anyconnect'),
    screenDamage: !!firstMatch(text, ['screen', 'pantalla', 'écran', 'bildschirm', '画面', 'display', 'tela', 'schermo']),
  };
}

// ------------------------------------------------------------------ priority

const LEVELS: TicketPriority[] = ['P1', 'P2', 'P3', 'P4'];
const raise = (p: TicketPriority, by = 1): TicketPriority => LEVELS[Math.max(0, LEVELS.indexOf(p) - by)]!;

function calculatePriority(t: TemplateDef, s: Signals, sentiment: Ticket['sentiment']): { priority: TicketPriority; reasons: string[] } {
  let p = t.basePriority;
  const reasons = [`Base ${p} for ${t.id}`];
  if (s.deadlineMinutes !== null && s.deadlineMinutes <= 60) {
    p = 'P1';
    reasons.push(`Deadline in ${s.deadlineMinutes} min → P1`);
  } else if (s.deadlineMinutes !== null && s.deadlineMinutes <= 240) {
    p = raise(p);
    reasons.push(`Deadline within ${Math.round(s.deadlineMinutes / 60)}h → ${p}`);
  }
  if (sentiment === 'Urgent Client Impact' && p !== 'P1') {
    p = raise(p);
    reasons.push(`Client-facing / emergency impact → ${p}`);
  }
  if (t.family === 'HW' && s.neededBy && s.neededBy.en !== 'Next week' && LEVELS.indexOf(p) > 1) {
    p = raise(p);
    reasons.push(`Needed before ${s.neededBy.en} → ${p}`);
  }
  if (t.ticketType === 'CHANGE' && p === 'P1') {
    p = 'P2';
    reasons.push('Changes cap at P2 — urgency handled by the emergency CAB path');
  }
  if (t.family === 'CHG' && s.clockTime) reasons.push(`Scheduled window ${s.clockTime}${s.tonight ? ' tonight' : ''}`);
  return { priority: p, reasons };
}

// ------------------------------------------------------------------ replies

interface ReplyCtx {
  first: string;
  priority: TicketPriority;
  deadline: boolean;
  device: string | null;
  app: string | null;
  editor: boolean;
  window: string | null;
  system: string;
  day: string | null;
}

type ReplyBook = Record<Family, (c: ReplyCtx) => string> & {
  clarifyPrefix: string;
  questions: Record<string, string>;
  deviceWord: string;
};

const REPLIES: Record<string, ReplyBook> = {
  en: {
    NET: (c) => `Hi ${c.first}, I'm sorry — losing the VPN right before ${c.deadline ? 'a client presentation' : 'your work'} is really stressful. I've logged this as ${c.priority} and the Network & Identity team is on it now. While you wait, try quitting and reopening Cisco AnyConnect (KB-402).`,
    HW: (c) => `Hi ${c.first}, I'm sorry about your ${c.device ?? 'device'}. I've asked the Endpoint & Mac team to prepare a loaner${c.day ? ` before ${c.day}` : ''} and check your AppleCare+ coverage.`,
    SAAS: (c) => `Hi ${c.first}, happy to help. I've requested ${c.editor ? 'an editor' : 'a'} ${c.app ?? 'software'} licence for you. The SaaS team will confirm as soon as it's assigned.`,
    CHG: (c) => `Hi ${c.first}, thanks for the heads-up. I've opened an emergency change for ${c.system}${c.window ? ` tonight at ${c.window}` : ''} and sent it to the CAB for approval. You'll hear from us as soon as it's approved.`,
    SEC: (c) => `Hi ${c.first}, thank you for reporting this — you did exactly the right thing. The security team has been alerted. Please don't approve any sign-in prompts you didn't start.`,
    GEN: (c) => `Hi ${c.first}, thanks for reaching out. I've passed this to the service desk and someone will follow up shortly.`,
    clarifyPrefix: 'Quick question so we can help faster: ',
    questions: { device: 'which device is affected?', application: 'which application do you need access to?', window: 'what time should the change window start?', system: 'which system does the change affect?', description: "could you describe what isn't working?", symptom: 'what exactly happens when you try to connect?', damage: "what's wrong with the device?" },
    deviceWord: 'device',
  },
  es: {
    NET: (c) => `Hola ${c.first}, siento mucho lo que estás pasando: quedarte sin VPN justo antes de ${c.deadline ? 'una presentación con un cliente' : 'trabajar'} es muy estresante. Ya registré tu caso como ${c.priority} y el equipo de Red e Identidad lo está revisando ahora. Mientras tanto, prueba a cerrar y volver a abrir Cisco AnyConnect (KB-402).`,
    HW: (c) => `Hola ${c.first}, siento mucho lo de tu ${c.device ?? 'equipo'}. He pedido al equipo de Endpoint y Mac que te prepare un equipo de préstamo${c.day ? ` antes del ${c.day}` : ''} y que revise tu cobertura de AppleCare+.`,
    SAAS: (c) => `Hola ${c.first}, con gusto te ayudo. He solicitado una licencia de ${c.app ?? 'software'}${c.editor ? ' con permisos de edición' : ''}. El equipo de SaaS te avisará en cuanto esté asignada.`,
    CHG: (c) => `Hola ${c.first}, gracias por avisar. He abierto un cambio de emergencia para ${c.system}${c.window ? ` hoy a las ${c.window}` : ''} y lo he enviado al CAB para su aprobación. Te avisaremos en cuanto esté aprobado.`,
    SEC: (c) => `Hola ${c.first}, gracias por reportarlo; hiciste lo correcto. El equipo de seguridad ya está alertado. No apruebes ninguna solicitud de inicio de sesión que no hayas iniciado tú.`,
    GEN: (c) => `Hola ${c.first}, gracias por escribirnos. He pasado tu solicitud al equipo de soporte y te contactarán en breve.`,
    clarifyPrefix: 'Una pregunta rápida para ayudarte antes: ',
    questions: { device: '¿qué equipo está afectado?', application: '¿a qué aplicación necesitas acceso?', window: '¿a qué hora debe empezar la ventana de cambio?', system: '¿qué sistema se ve afectado por el cambio?', description: '¿podrías describir qué es lo que no funciona?', symptom: '¿qué ocurre exactamente al intentar conectarte?', damage: '¿qué le pasa al equipo?' },
    deviceWord: 'equipo',
  },
  fr: {
    NET: (c) => `Bonjour ${c.first}, je suis désolé : perdre le VPN juste avant ${c.deadline ? 'une présentation client' : 'de travailler'}, c'est vraiment stressant. J'ai enregistré votre demande en ${c.priority} et l'équipe Réseau & Identité s'en occupe maintenant. En attendant, essayez de quitter puis de rouvrir Cisco AnyConnect (KB-402).`,
    HW: (c) => `Bonjour ${c.first}, je suis désolé pour votre ${c.device ?? 'appareil'}. J'ai demandé à l'équipe Endpoint & Mac de vous préparer un ordinateur de prêt${c.day ? ` avant ${c.day}` : ''} et de vérifier votre couverture AppleCare+.`,
    SAAS: (c) => `Bonjour ${c.first}, avec plaisir. J'ai demandé une licence ${c.app ?? 'logicielle'}${c.editor ? ' avec droits d’édition' : ''}. L'équipe SaaS vous confirmera dès qu'elle sera attribuée.`,
    CHG: (c) => `Bonjour ${c.first}, merci de nous prévenir. J'ai ouvert un changement d'urgence pour ${c.system}${c.window ? ` ce soir à ${c.window}` : ''} et l'ai soumis au CAB pour approbation. Vous serez informé dès son approbation.`,
    SEC: (c) => `Bonjour ${c.first}, merci de nous l'avoir signalé, vous avez bien fait. L'équipe sécurité est alertée. N'approuvez aucune demande de connexion que vous n'avez pas initiée.`,
    GEN: (c) => `Bonjour ${c.first}, merci de nous avoir contactés. J'ai transmis votre demande au support ; quelqu'un vous répondra rapidement.`,
    clarifyPrefix: 'Une petite question pour aller plus vite : ',
    questions: { device: 'quel appareil est concerné ?', application: 'à quelle application avez-vous besoin d’accéder ?', window: 'à quelle heure doit commencer la fenêtre de maintenance ?', system: 'quel système est concerné par le changement ?', description: 'pouvez-vous décrire ce qui ne fonctionne pas ?', symptom: 'que se passe-t-il exactement quand vous essayez de vous connecter ?', damage: 'quel est le problème avec l’appareil ?' },
    deviceWord: 'appareil',
  },
  de: {
    NET: (c) => `Hallo ${c.first}, das tut mir leid – ohne VPN kurz vor ${c.deadline ? 'einer Kundenpräsentation' : 'der Arbeit'} ist das wirklich stressig. Ich habe Ihr Anliegen als ${c.priority} erfasst, das Network-&-Identity-Team kümmert sich jetzt darum. Versuchen Sie bis dahin, Cisco AnyConnect zu beenden und neu zu öffnen (KB-402).`,
    HW: (c) => `Hallo ${c.first}, das mit Ihrem ${c.device ?? 'Gerät'} tut mir leid. Ich habe das Endpoint-&-Mac-Team gebeten, ein Leihgerät${c.day ? ` bis ${c.day}` : ''} vorzubereiten und Ihre AppleCare+-Abdeckung zu prüfen.`,
    SAAS: (c) => `Hallo ${c.first}, gerne. Ich habe eine ${c.app ?? 'Software'}-Lizenz${c.editor ? ' mit Bearbeitungsrechten' : ''} angefordert. Das SaaS-Team meldet sich, sobald sie zugewiesen ist.`,
    CHG: (c) => `Hallo ${c.first}, danke für den Hinweis. Ich habe einen Notfall-Change für ${c.system}${c.window ? ` heute um ${c.window} Uhr` : ''} angelegt und dem CAB zur Genehmigung vorgelegt. Sie werden benachrichtigt, sobald er genehmigt ist.`,
    SEC: (c) => `Hallo ${c.first}, danke für Ihre Meldung – genau richtig. Das Security-Team ist alarmiert. Bitte bestätigen Sie keine Anmeldeanfragen, die Sie nicht selbst ausgelöst haben.`,
    GEN: (c) => `Hallo ${c.first}, danke für Ihre Nachricht. Ich habe Ihr Anliegen an den Service Desk weitergeleitet; jemand meldet sich in Kürze.`,
    clarifyPrefix: 'Kurze Rückfrage, damit wir schneller helfen können: ',
    questions: { device: 'welches Gerät ist betroffen?', application: 'auf welche Anwendung benötigen Sie Zugriff?', window: 'wann soll das Wartungsfenster beginnen?', system: 'welches System ist von der Änderung betroffen?', description: 'können Sie beschreiben, was nicht funktioniert?', symptom: 'was passiert genau, wenn Sie sich verbinden möchten?', damage: 'was ist mit dem Gerät los?' },
    deviceWord: 'Gerät',
  },
  ja: {
    NET: (c) => `${c.first}さん、ご不便をおかけして申し訳ありません。${c.deadline ? 'お客様とのプレゼン直前に' : ''}VPNにつながらないのは大変ですよね。優先度${c.priority}として登録し、Network & Identityチームがすぐに対応しています。その間、Cisco AnyConnectを一度終了して再起動してみてください（KB-402）。`,
    HW: (c) => `${c.first}さん、${c.device ?? '端末'}の件、大変でしたね。Endpoint & Macチームに${c.day ? `${c.day}までに` : ''}貸出用PCの準備とAppleCare+の保証確認を依頼しました。`,
    SAAS: (c) => `${c.first}さん、承知しました。${c.app ?? 'ソフトウェア'}の${c.editor ? '編集' : ''}ライセンスを申請しました。割り当てが完了しましたらSaaSチームからご連絡します。`,
    CHG: (c) => `${c.first}さん、ご連絡ありがとうございます。${c.system}の緊急変更${c.window ? `（本日${c.window}）` : ''}を起票し、CABに承認を依頼しました。承認され次第お知らせします。`,
    SEC: (c) => `${c.first}さん、ご報告ありがとうございます。適切なご対応です。セキュリティチームに通知しました。ご自身で行っていないサインイン要求は承認しないでください。`,
    GEN: (c) => `${c.first}さん、お問い合わせありがとうございます。サービスデスクに引き継ぎましたので、まもなく担当者からご連絡します。`,
    clarifyPrefix: '迅速に対応するため、ひとつ確認させてください：',
    questions: { device: 'どの端末で問題が起きていますか？', application: 'どのアプリケーションへのアクセスが必要ですか？', window: '変更作業は何時から開始すればよいですか？', system: '変更の対象となるシステムはどれですか？', description: 'どのような問題が起きているか教えていただけますか？', symptom: '接続しようとすると具体的に何が起こりますか？', damage: '端末にどのような問題がありますか？' },
    deviceWord: '端末',
  },
  pt: {
    NET: (c) => `Olá ${c.first}, sinto muito: ficar sem VPN logo antes de ${c.deadline ? 'uma apresentação com cliente' : 'trabalhar'} é muito estressante. Registrei seu chamado como ${c.priority} e a equipe de Rede e Identidade já está cuidando disso. Enquanto isso, tente fechar e reabrir o Cisco AnyConnect (KB-402).`,
    HW: (c) => `Olá ${c.first}, sinto muito pelo seu ${c.device ?? 'equipamento'}. Pedi à equipe de Endpoint e Mac que prepare um equipamento de empréstimo${c.day ? ` antes de ${c.day}` : ''} e verifique sua cobertura AppleCare+.`,
    SAAS: (c) => `Olá ${c.first}, com prazer. Solicitei uma licença do ${c.app ?? 'software'}${c.editor ? ' com permissão de edição' : ''}. A equipe de SaaS avisará assim que for atribuída.`,
    CHG: (c) => `Olá ${c.first}, obrigado pelo aviso. Abri uma mudança emergencial para ${c.system}${c.window ? ` hoje às ${c.window}` : ''} e enviei ao CAB para aprovação. Você será avisado assim que for aprovada.`,
    SEC: (c) => `Olá ${c.first}, obrigado por reportar; você fez a coisa certa. A equipe de segurança já foi alertada. Não aprove nenhuma solicitação de login que você não tenha iniciado.`,
    GEN: (c) => `Olá ${c.first}, obrigado pelo contato. Encaminhei sua solicitação ao suporte e alguém retornará em breve.`,
    clarifyPrefix: 'Uma pergunta rápida para agilizar: ',
    questions: { device: 'qual equipamento está com problema?', application: 'a qual aplicativo você precisa de acesso?', window: 'que horas deve começar a janela de mudança?', system: 'qual sistema é afetado pela mudança?', description: 'pode descrever o que não está funcionando?', symptom: 'o que acontece exatamente quando você tenta se conectar?', damage: 'qual é o problema com o equipamento?' },
    deviceWord: 'equipamento',
  },
  it: {
    NET: (c) => `Ciao ${c.first}, mi dispiace: restare senza VPN proprio prima di ${c.deadline ? 'una presentazione con un cliente' : 'lavorare'} è davvero stressante. Ho registrato la richiesta come ${c.priority} e il team Network & Identity se ne sta occupando ora. Nel frattempo prova a chiudere e riaprire Cisco AnyConnect (KB-402).`,
    HW: (c) => `Ciao ${c.first}, mi dispiace per il tuo ${c.device ?? 'dispositivo'}. Ho chiesto al team Endpoint & Mac di preparare un computer sostitutivo${c.day ? ` prima di ${c.day}` : ''} e di verificare la copertura AppleCare+.`,
    SAAS: (c) => `Ciao ${c.first}, volentieri. Ho richiesto una licenza ${c.app ?? 'software'}${c.editor ? ' con permessi di modifica' : ''}. Il team SaaS ti avviserà appena sarà assegnata.`,
    CHG: (c) => `Ciao ${c.first}, grazie per la segnalazione. Ho aperto una modifica d'emergenza per ${c.system}${c.window ? ` stasera alle ${c.window}` : ''} e l'ho inviata al CAB per l'approvazione. Ti avviseremo appena sarà approvata.`,
    SEC: (c) => `Ciao ${c.first}, grazie per la segnalazione: hai fatto bene. Il team sicurezza è stato avvisato. Non approvare richieste di accesso che non hai avviato tu.`,
    GEN: (c) => `Ciao ${c.first}, grazie per averci scritto. Ho inoltrato la richiesta al supporto: qualcuno ti risponderà a breve.`,
    clarifyPrefix: 'Una domanda veloce per aiutarti prima: ',
    questions: { device: 'quale dispositivo ha il problema?', application: 'a quale applicazione ti serve accedere?', window: "a che ora deve iniziare la finestra di modifica?", system: 'quale sistema è interessato dalla modifica?', description: 'puoi descrivere cosa non funziona?', symptom: 'cosa succede esattamente quando provi a connetterti?', damage: 'qual è il problema del dispositivo?' },
    deviceWord: 'dispositivo',
  },
};

export const NATIVE_REPLY_LANGUAGES = Object.keys(REPLIES);

// ------------------------------------------------------------------ main entry point

export interface IntakeContext {
  requester: EndUserProfile;
  assets: HardwareAsset[];
  saasApps: SaasApp[];
  /** All user turns so far, oldest first. The mapper re-reads the whole conversation each turn. */
  userMessages: string[];
}

const field = (key: string, label: string, value: string | null, critical = false): IntakeField => ({ key, label, value, critical });

export function analyzeIntake({ requester, assets, saasApps, userMessages }: IntakeContext): IntakeAnalysis {
  const text = userMessages.join('\n');
  const latest = userMessages[userMessages.length - 1] ?? '';
  const { lang, confidence: languageConfidence } = detectLanguage(latest.trim().length >= 12 ? latest : text);
  const { template, confidence: templateConfidence } = matchTemplate(text);
  const s = extractSignals(text);

  // Sentiment (judged on impact, not tone)
  const sentimentSignals: string[] = [];
  if (s.client) sentimentSignals.push('Client mentioned');
  if (s.presentation) sentimentSignals.push('Presentation / demo');
  if (s.deadlineMinutes !== null) sentimentSignals.push(`Deadline in ${s.deadlineMinutes} min`);
  if (s.urgentWord) sentimentSignals.push(`Emergency language (“${s.urgentWord}”)`);
  if (s.frustration) sentimentSignals.push(`Frustration (“${s.frustration}”)`);
  const sentiment: Ticket['sentiment'] =
    ((s.client || s.presentation) && (s.deadlineMinutes !== null || s.urgentWord)) || s.urgentWord
      ? 'Urgent Client Impact'
      : s.frustration
        ? 'Frustrated'
        : 'Calm';

  const { priority, reasons: priorityReasons } = calculatePriority(template, s, sentiment);

  // CMDB + SaaS context for this requester
  const userAssets = requester.assetIds.map((id) => assets.find((a) => a.id === id)).filter((a): a is HardwareAsset => !!a);
  const laptop = userAssets.find((a) => a.category === 'Laptop') ?? null;
  const attachHardware = ['NET', 'HW', 'SEC', 'GEN'].includes(template.family);
  const linkedAsset = attachHardware ? laptop : null;
  const mentionedApp = s.saasId ? saasApps.find((a) => a.id === s.saasId) ?? null : null;
  const deviceLabel = linkedAsset ? `${linkedAsset.name} (${linkedAsset.id})` : null;
  const system = s.saml ? 'Okta SAML signing certificate' : mentionedApp?.name ?? (template.family === 'CHG' ? '' : 'Unknown system');

  // Template fields
  let fields: IntakeField[];
  switch (template.family) {
    case 'NET':
      fields = [
        field('symptom', 'Symptom', s.vpn ? 'Cannot connect to VPN' : 'Network connectivity failure', true),
        field('since', 'Since', s.since),
        field('deadline', 'Business deadline', s.deadlineMinutes !== null ? `${s.presentation ? 'Client presentation' : 'Deadline'} in ${s.deadlineMinutes} min` : null),
        field('device', 'Affected device', deviceLabel, true),
      ];
      break;
    case 'HW':
      fields = [
        field('device', 'Affected device', deviceLabel, true),
        field('damage', 'Damage', s.screenDamage ? 'Cracked / damaged screen' : hasTerm(text, 'battery') || hasTerm(text, 'batterie') ? 'Battery fault' : 'Hardware fault', true),
        field('loaner', 'Loaner needed', s.loaner ? 'Yes' : null),
        field('needed_by', 'Needed by', s.neededBy?.en ?? null),
      ];
      break;
    case 'SAAS':
      fields = [
        field('application', 'Application', mentionedApp?.name ?? null, true),
        field('access_level', 'Access level', s.editor ? 'Editor' : null),
        field('business_reason', 'Business reason', s.businessReason),
        field('needed_by', 'Needed by', s.neededBy?.en ?? null),
      ];
      break;
    case 'CHG':
      fields = [
        field('system', 'System', system || null, true),
        field('window', 'Change window', s.clockTime ? `${s.clockTime}${s.tonight ? ' tonight' : ''}` : null, true),
        field('change', 'Change', s.saml ? 'Rotate SAML signing certificate' : 'Emergency configuration change'),
        field('rollback', 'Rollback plan', null),
      ];
      break;
    case 'SEC':
      fields = [
        field('what_happened', 'What happened', 'Suspicious activity reported by user', true),
        field('account', 'Account', requester.email, true),
        field('device', 'Device', deviceLabel),
      ];
      break;
    default:
      fields = [field('description', 'Description', text.trim().length >= 25 ? 'Provided in conversation' : null, true), field('device', 'Device', deviceLabel)];
  }

  // Reply in the requester's language; at most ONE clarifying question if a critical field is missing.
  const replyLanguage = REPLIES[lang] ? lang : 'en';
  const book = REPLIES[replyLanguage]!;
  const first = requester.name.split(' ')[0]!;
  const ctx: ReplyCtx = {
    first, priority, deadline: s.deadlineMinutes !== null || s.presentation, device: linkedAsset ? `${linkedAsset.name.split(' ').slice(0, 2).join(' ')} (${linkedAsset.id})` : null,
    app: mentionedApp?.name.replace(/ \(.*\)$/, '').replace(/ (Enterprise|Workforce|Pro|Sales Cloud)$/, '') ?? null,
    editor: s.editor, window: s.clockTime, system: system || 'system', day: s.neededBy?.native ?? null,
  };
  const missing = fields.find((f) => f.critical && !f.value);
  const questionKey = missing ? (missing.key in book.questions ? missing.key : 'description') : null;
  const clarify = (b: ReplyBook) => (questionKey ? ` ${b.clarifyPrefix}${b.questions[questionKey]}` : '');
  const replyNative = book[template.family](ctx) + clarify(book);
  const replyEnglish = REPLIES.en![template.family]({ ...ctx, day: s.neededBy?.en ?? null }) + clarify(REPLIES.en!);

  // Agent-facing English title + summary
  const appShort = ctx.app ?? 'SaaS';
  const title = {
    NET: `VPN connection failing${s.deadlineMinutes !== null ? ` — ${s.presentation ? 'client presentation' : 'deadline'} in ${s.deadlineMinutes} min` : ''}`,
    HW: `${s.screenDamage ? 'Cracked screen' : 'Hardware fault'} on ${linkedAsset?.id ?? 'device'}${s.loaner ? ', needs loaner' : ''}${s.neededBy ? ` before ${s.neededBy.en}` : ''}`,
    SAAS: `${appShort}${s.editor ? ' editor' : ''} licence request${s.businessReason ? ` for ${s.businessReason.toLowerCase()}` : ''}`,
    CHG: `Emergency change: ${system || 'unspecified system'}${s.clockTime ? ` at ${s.clockTime}${s.tonight ? ' tonight' : ''}` : ''}`,
    SEC: `Suspicious account activity reported by ${requester.name}`,
    GEN: `IT request from ${requester.name}`,
  }[template.family];

  const englishSummary = [
    `${requester.name} (${requester.department}, ${requester.location}) wrote in ${LANGUAGE_NAMES[lang] ?? lang.toUpperCase()}.`,
    `Mapped to ${template.id} ${template.name}.`,
    fields.filter((f) => f.value).map((f) => `${f.label}: ${f.value}.`).join(' '),
    `Sentiment ${sentiment}; priority ${priority}.`,
    linkedAsset ? `CMDB: ${linkedAsset.id} — MDM ${linkedAsset.mdmEnrolled ? 'enrolled' : 'not enrolled'}, FileVault ${linkedAsset.fileVault}.` : '',
    missing ? `Awaiting: ${missing.label.toLowerCase()}.` : '',
  ].filter(Boolean).join(' ');

  // Grounded follow-ups (only from published KB / known macros)
  const suggestedKbId = { NET: 'KB-402', HW: 'KB-388', SAAS: s.saasId === 'saas-figma' ? 'KB-405' : undefined, CHG: s.saml ? 'KB-421' : undefined, SEC: 'KB-430', GEN: undefined }[template.family];
  const loanerAsset = assets.find((a) => a.lifecycle === 'In Stock' && a.category === 'Laptop');
  const recommendedMacro: Ticket['recommendedMacro'] =
    template.family === 'NET' && linkedAsset && s.vpn
      ? { id: 'macro-push-split-tunnel', label: `Push Split-Tunnel Certificate to ${linkedAsset.id}`, command: `jamf policy -event push-anyconnect-cert -serial ${linkedAsset.serialNumber}` }
      : template.family === 'HW' && linkedAsset && loanerAsset
        ? { id: 'macro-assign-loaner', label: `Assign loaner ${loanerAsset.id} & open AppleCare+ claim`, command: `jamf setup-manager assign --loaner ${loanerAsset.id} --migrate-from ${linkedAsset.id} && applecare claim --serial ${linkedAsset.serialNumber}` }
        : template.family === 'SAAS' && mentionedApp
          ? { id: `macro-grant-${mentionedApp.id}`, label: `Assign ${ctx.app} seat via Okta group${mentionedApp.inactiveUsers.length ? ' (reuse idle seat)' : ''}`, command: `okta groups add "${ctx.app} ${s.editor ? 'Editors' : 'Users'}" ${requester.email}${mentionedApp.inactiveUsers.length ? ' --reuse-idle-seat' : ''}` }
          : template.family === 'SEC'
            ? { id: 'macro-revoke-okta-sessions', label: 'Revoke Okta sessions & force MFA re-enrolment', command: `okta users sessions revoke ${requester.email} && okta factors reset ${requester.email}` }
            : undefined;

  return {
    detectedLanguage: lang,
    languageConfidence,
    sentiment,
    sentimentSignals,
    priority,
    priorityReasons,
    templateId: template.id,
    templateName: template.name,
    ticketType: template.ticketType,
    swarmSquad: template.squad,
    templateConfidence,
    fields,
    requiredApprovals: template.approvals,
    title,
    englishSummary,
    linkedAssetId: linkedAsset?.id,
    linkedSaasId: mentionedApp?.id,
    suggestedKbId,
    recommendedMacro,
    replyNative,
    replyEnglish,
    replyLanguage,
    clarifyingQuestion: questionKey ? book.questions[questionKey]! : null,
  };
}

export const INTAKE_AGENT_NAME = 'AdminZero Intake Agent';

const CONFIRMATIONS: Record<string, (id: string, squad: string) => string> = {
  en: (id, squad) => `Your ticket ${id} is now with the ${squad} team. You'll get updates right here.`,
  es: (id, squad) => `Tu ticket ${id} ya está con el equipo ${squad}. Recibirás las novedades aquí mismo.`,
  fr: (id, squad) => `Votre ticket ${id} est entre les mains de l'équipe ${squad}. Vous recevrez les mises à jour ici.`,
  de: (id, squad) => `Ihr Ticket ${id} liegt jetzt beim Team ${squad}. Updates erhalten Sie direkt hier.`,
  ja: (id, squad) => `チケット${id}を${squad}チームに引き継ぎました。進捗はこちらでお知らせします。`,
  pt: (id, squad) => `Seu chamado ${id} já está com a equipe ${squad}. Você receberá as atualizações aqui.`,
  it: (id, squad) => `Il tuo ticket ${id} è ora in carico al team ${squad}. Riceverai gli aggiornamenti qui.`,
};

export function confirmationMessage(lang: string, id: string, squad: string): { native: string; english: string; lang: string } {
  const replyLang = CONFIRMATIONS[lang] ? lang : 'en';
  return { native: CONFIRMATIONS[replyLang]!(id, squad), english: CONFIRMATIONS.en!(id, squad), lang: replyLang };
}
