"""Deterministic structured responses, used when Claude is unavailable (no key, outage, refusal, rate limit).

Same response shapes as the Claude path, and the same grounding rules: no step without a KB citation.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from adminzero_api.catalog import DEFAULT_KB, GENERIC, TEMPLATE_BY_ID, TEMPLATES, Template
from adminzero_api.schemas import (
    AssistOutput,
    AssistRequest,
    IntakeOutput,
    IntakeRequest,
    JitSuggestion,
    KbArticleIn,
    MacroSuggestion,
    Recommendation,
    Sentiment,
)

# ------------------------------------------------------------------ language

STOPWORDS: dict[str, set[str]] = {
    "en": {
        "the",
        "a",
        "and",
        "is",
        "i",
        "my",
        "to",
        "for",
        "with",
        "not",
        "please",
        "hi",
        "hello",
        "can't",
        "cannot",
        "need",
        "since",
        "it",
    },
    "es": {
        "el",
        "la",
        "los",
        "de",
        "que",
        "y",
        "en",
        "un",
        "una",
        "no",
        "puedo",
        "con",
        "desde",
        "esta",
        "tengo",
        "por",
        "para",
        "hola",
        "mi",
    },
    "fr": {
        "le",
        "la",
        "les",
        "de",
        "des",
        "un",
        "une",
        "et",
        "est",
        "je",
        "mon",
        "ma",
        "pour",
        "avec",
        "pas",
        "avant",
        "bonjour",
        "besoin",
        "j",
    },
    "de": {
        "der",
        "die",
        "das",
        "und",
        "ist",
        "ich",
        "wir",
        "nicht",
        "ein",
        "eine",
        "für",
        "mit",
        "um",
        "uhr",
        "heute",
        "abend",
        "benötigen",
    },
    "pt": {"o", "os", "de", "que", "e", "em", "um", "uma", "não", "consigo", "com", "para", "meu", "minha", "olá", "preciso"},
    "it": {"il", "lo", "la", "di", "che", "e", "non", "riesco", "un", "una", "per", "con", "mio", "ciao", "ho", "bisogno"},
}
CHAR_HINTS = ((r"[ñ¿¡]", "es", 3), (r"[ãõ]", "pt", 3), (r"[ßäöü]", "de", 3), (r"[œêëîû]", "fr", 2), (r"[èàù]", "fr", 1), (r"[ìò]", "it", 2))


def detect_language(text: str) -> str:
    if re.search(r"[぀-ヿ]", text):
        return "ja"
    if re.search(r"[가-힯]", text):
        return "ko"
    if re.search(r"[一-鿿]", text):
        return "zh"
    lower = text.lower()
    words = re.findall(r"[^\W\d_]+", lower)
    scores = {lang: sum(w in sw for w in words) for lang, sw in STOPWORDS.items()}
    for pattern, lang, weight in CHAR_HINTS:
        scores[lang] += len(re.findall(pattern, lower)) * weight
    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] else "en"


def has_term(text: str, term: str) -> bool:
    """Latin terms match at a word start; boundaries ignore non-Latin letters so 'Figma' is found inside Japanese."""
    lower = text.lower()
    if not re.fullmatch(r"[a-zà-ÿ\s'’-]+", term):
        return term.lower() in lower
    tail = r"(?![a-zà-ÿ])" if len(term) <= 3 else ""
    return re.search(rf"(^|[^a-zà-ÿ]){re.escape(term.lower())}{tail}", lower) is not None


def match_template(text: str) -> Template:
    best, hits = GENERIC, 0
    for template in TEMPLATES:
        n = sum(has_term(text, k) for k in template.keywords)
        if n > hits:
            best, hits = template, n
    return best


# ------------------------------------------------------------------ urgency & sentiment

CLIENT = (
    "client",
    "cliente",
    "kunde",
    "customer",
    "クライアント",
    "顧客",
    "presentation",
    "presentación",
    "présentation",
    "präsentation",
    "pitch",
    "demo",
)
EMERGENCY = ("urgent", "urgente", "urgence", "dringend", "notfall", "緊急", "emergency", "emergencia", "asap", "sofort")
FRUSTRATION = (
    "no puedo",
    "je ne peux pas",
    "ich kann nicht",
    "できません",
    "can't",
    "cannot",
    "again",
    "otra vez",
    "encore",
    "schon wieder",
    "não consigo",
    "non riesco",
)


def assess(text: str, template: Template) -> tuple[int, Sentiment]:
    lower = text.lower()
    urgency = template.base_urgency
    minutes = re.search(r"(\d{1,3})\s*(?:min(?:ute)?s?|minutos?|minuten|minuti|分)", lower)
    client = any(has_term(lower, w) for w in CLIENT)
    emergency = any(has_term(lower, w) for w in EMERGENCY)
    if minutes and int(minutes.group(1)) <= 60:
        urgency = 5
    elif client or emergency:
        urgency = min(5, urgency + 1)
    if template.ticket_type == "CHANGE":
        urgency = min(urgency, 4)  # changes are scheduled; urgency goes through the emergency CAB path
    sentiment: Sentiment = (
        "Urgent Client Impact"
        if (client and (minutes or emergency)) or emergency
        else "Frustrated"
        if any(has_term(lower, w) for w in FRUSTRATION)
        else "Calm"
    )
    return max(1, min(5, urgency)), sentiment


def priority_for(urgency: int) -> str:
    return {5: "P1", 4: "P2", 3: "P3"}.get(urgency, "P4")


# ------------------------------------------------------------------ localized replies

REPLY = {
    "en": (
        "Hi {first}, thanks for letting us know — I'm sorry for the trouble. I've logged this as {priority} with the {squad} team, and they're on it.",
        " While you wait: {step} ({kb}).",
        " Quick question so we can help faster: could you describe exactly what isn't working?",
    ),
    "es": (
        "Hola {first}, gracias por avisarnos y siento mucho las molestias. Ya registré tu caso como {priority} con el equipo {squad} y lo están revisando.",
        " Mientras tanto: {step} ({kb}).",
        " Una pregunta rápida: ¿podrías describir exactamente qué no funciona?",
    ),
    "fr": (
        "Bonjour {first}, merci de nous avoir prévenus, et désolé pour la gêne. J'ai enregistré votre demande en {priority} auprès de l'équipe {squad}, qui s'en occupe.",
        " En attendant : {step} ({kb}).",
        " Une petite question : pouvez-vous décrire exactement ce qui ne fonctionne pas ?",
    ),
    "de": (
        "Hallo {first}, danke für Ihre Nachricht – das tut mir leid. Ich habe Ihr Anliegen als {priority} beim Team {squad} erfasst; es wird bereits bearbeitet.",
        " Bis dahin: {step} ({kb}).",
        " Kurze Rückfrage: Können Sie genau beschreiben, was nicht funktioniert?",
    ),
    "ja": (
        "{first}さん、ご連絡ありがとうございます。ご不便をおかけして申し訳ありません。優先度{priority}として{squad}チームに登録し、対応を開始しました。",
        " その間に：{step}（{kb}）",
        " ひとつ確認させてください：具体的にどのような問題が起きていますか？",
    ),
    "pt": (
        "Olá {first}, obrigado por avisar e desculpe o transtorno. Registrei seu chamado como {priority} com a equipe {squad}, que já está cuidando disso.",
        " Enquanto isso: {step} ({kb}).",
        " Uma pergunta rápida: pode descrever exatamente o que não está funcionando?",
    ),
    "it": (
        "Ciao {first}, grazie per la segnalazione e scusa per il disagio. Ho registrato la richiesta come {priority} con il team {squad}, che se ne sta occupando.",
        " Nel frattempo: {step} ({kb}).",
        " Una domanda veloce: puoi descrivere esattamente cosa non funziona?",
    ),
}
TEMPLATE_KB = {"#INC-NET-04": "KB-402", "#SR-HW-01": "KB-388", "#SR-SAAS-09": "KB-405", "#CHG-SEC-02": "KB-421", "#INC-SEC-01": "KB-430"}
# Only steps an employee can safely do themselves are offered in the intake reply.
SELF_SERVICE_STEP = {"KB-402": "Quit and reopen Cisco AnyConnect."}


def offline_intake(req: IntakeRequest) -> IntakeOutput:
    text = "\n".join([*(t.content for t in req.history if t.role == "user"), req.message])
    lang = detect_language(req.message if len(req.message) >= 12 else text)
    template = match_template(text)
    urgency, sentiment = assess(text, template)
    priority = priority_for(urgency)
    kb_ids = {k.id for k in req.context.kb_articles} or {str(k["id"]) for k in DEFAULT_KB}
    kb = TEMPLATE_KB.get(template.id)
    step = SELF_SERVICE_STEP.get(kb or "") if kb in kb_ids else None
    clarify = template is GENERIC and len(text.strip()) < 25

    base, step_fmt, question = REPLY.get(lang, REPLY["en"])
    first = req.requester_name.split(" ")[0]
    reply = base.format(first=first, priority=priority, squad=template.squad)
    if step:
        reply += step_fmt.format(step=step, kb=kb)
    if clarify:
        reply += question
    return IntakeOutput(
        reply=reply,
        detected_language=lang,
        urgency_score=urgency,
        sentiment=sentiment,
        selected_template_id=template.id,  # type: ignore[arg-type]
        english_summary_for_agent=f"{req.requester_name} wrote in {lang.upper()}: mapped to {template.id} ({template.name}), urgency {urgency}/5, sentiment {sentiment}. Message: {req.message[:280]}",
        required_approvals=list(template.approvals),
        recommended_swarm_group=template.squad,
        clarifying_question=REPLY.get(lang, REPLY["en"])[2].strip() if clarify else None,
        self_service_kb_ids=[kb] if step and kb else [],
    )


# ------------------------------------------------------------------ agent assist

STOP = {"the", "and", "for", "with", "not", "after", "from", "this", "that", "into", "since", "user", "need", "needs", "please"}


def tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9][a-z0-9-]{2,}", text.lower()) if w not in STOP}


def overlap(a: set[str], b: set[str]) -> float:
    return len(a & b) / (len(a | b) or 1)


MACRO_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("vpn", "anyconnect", "split-tunnel", "certificate"), "macro-push-split-tunnel"),
    (("screen", "cracked", "loaner", "applecare"), "macro-assign-loaner"),
    (("mfa", "push", "brute-force", "fatigue", "sentinel", "compromise"), "macro-revoke-okta-sessions"),
    (("figma", "seat", "licence", "license"), "macro-reuse-saas-seat"),
)

PROGRESS = {
    "en": "Hi {first}, thanks for your patience — I'm on this now{kb}. I'll update you within the hour.",
    "es": "Hola {first}, gracias por tu paciencia: ya estoy trabajando en esto{kb}. Te actualizo antes de una hora.",
    "fr": "Bonjour {first}, merci de votre patience — je m'en occupe maintenant{kb}. Je reviens vers vous dans l'heure.",
    "de": "Hallo {first}, danke für Ihre Geduld – ich kümmere mich gerade darum{kb}. Ich melde mich innerhalb einer Stunde.",
    "ja": "{first}さん、お待たせしております。現在対応中です{kb}。1時間以内に状況をご連絡します。",
    "pt": "Olá {first}, obrigado pela paciência — já estou cuidando disso{kb}. Volto com uma atualização em até uma hora.",
    "it": "Ciao {first}, grazie per la pazienza: ci sto lavorando ora{kb}. Ti aggiorno entro un'ora.",
}
KB_CLAUSE = {
    "en": " following {kb}",
    "es": " siguiendo {kb}",
    "fr": " en suivant {kb}",
    "de": " gemäß {kb}",
    "ja": "（{kb}に沿って作業中）",
    "pt": " seguindo {kb}",
    "it": " seguendo {kb}",
}


def kb_corpus(req: AssistRequest) -> list[KbArticleIn]:
    return req.kb_articles or [KbArticleIn.model_validate(k) for k in DEFAULT_KB]


def offline_assist(req: AssistRequest) -> AssistOutput:
    t = req.ticket
    text = " ".join([t.title, *(m.translation or m.text for m in t.messages), *(str(a) for a in req.siem_alerts)])
    q = tokens(text)
    kbs = kb_corpus(req)
    ranked = sorted(((overlap(q, tokens(f"{k.title} {k.summary} {' '.join(k.steps)}")), k) for k in kbs), key=lambda x: x[0], reverse=True)
    similar = sorted(((overlap(q, tokens(f"{c.title} {c.resolution}")), c) for c in req.closed_tickets), key=lambda x: x[0], reverse=True)
    similar = [c for score, c in similar if score > 0.05][:3]
    best = ranked[0][1] if ranked and ranked[0][0] > 0.02 else None

    recommendations: list[Recommendation] = []
    if best:
        used = sum(1 for c in similar if c.kb_id == best.id)
        for step in best.steps[:2]:
            recommendations.append(
                Recommendation(
                    action=step,
                    rationale=f"From {best.id} ({best.title})" + (f"; resolved {used} similar closed ticket(s)" if used else ""),
                    kb_citations=[best.id],
                )
            )
    macro = next((m for words, m in MACRO_RULES if any(w in q for w in words)), None)
    asset = t.linked_asset_id
    lang = t.requester_language if t.requester_language in PROGRESS else "en"
    first = t.requester_name.split(" ")[0]
    kb_clause = KB_CLAUSE[lang].format(kb=best.id) if best else ""
    return AssistOutput(
        summary=(
            f"{len(similar)} similar closed ticket(s); best article {best.id} — {best.title}."
            if best
            else "No knowledge base article covers this yet. Gather the exact error and timeline before acting."
        ),
        recommendations=recommendations,
        macro=MacroSuggestion(
            macro_id=macro, reason=f"Matches the ticket symptoms{f' on {asset}' if asset else ''}", kb_citations=[best.id]
        )
        if macro and best
        else None,  # type: ignore[arg-type]
        jit_elevation=JitSuggestion(credential=f"Local Admin · {asset}", reason="The certificate push needs local admin on the device")
        if macro == "macro-push-split-tunnel" and asset
        else None,
        draft_reply=PROGRESS[lang].format(first=first, kb=kb_clause),
        draft_reply_english=PROGRESS["en"].format(first=first, kb=KB_CLAUSE["en"].format(kb=best.id) if best else "")
        if lang != "en"
        else None,
        knowledge_gaps=[] if best else [f"No article for: {t.title}"],
    )


# ------------------------------------------------------------------ grounding guardrail (Claude and offline alike)


def enforce_grounding(output: AssistOutput, kb_ids: Iterable[str]) -> tuple[AssistOutput, list[str]]:
    """Drop anything that doesn't cite a KB article we actually supplied — zero tolerance for hallucination."""
    allowed = set(kb_ids)
    rejected: list[str] = []
    recs = []
    for r in output.recommendations:
        cites = [c for c in r.kb_citations if c in allowed]
        if cites:
            recs.append(r.model_copy(update={"kb_citations": cites}))
        else:
            rejected.append(r.action)
    macro = output.macro
    if macro and not any(c in allowed for c in macro.kb_citations):
        rejected.append(f"macro:{macro.macro_id}")
        macro = None
    return output.model_copy(update={"recommendations": recs, "macro": macro}), rejected


def template_meta(template_id: str) -> Template:
    return TEMPLATE_BY_ID.get(template_id, GENERIC)
