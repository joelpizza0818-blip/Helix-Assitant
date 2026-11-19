"""Natural-language confirmation intent parsing (English + Spanish).

The parser is intentionally conservative.  A pending destructive action may
only be approved by an explicit approval phrase, never by silence, a question,
a hedge or an ambiguous acknowledgement.  ``ok``/``vale`` alone are treated as
ambiguous; ``ok, do it``/``vale, adelante`` are explicit.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class ConfirmationDecision(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    MODIFY = "modify"
    AMBIGUOUS = "ambiguous"
    NONE = "none"


@dataclass(frozen=True)
class ConfirmationIntent:
    decision: ConfirmationDecision
    confidence: float
    instructions: str = ""
    message: str = ""
    matched: str = ""

    @property
    def handled(self) -> bool:
        return self.decision is not ConfirmationDecision.NONE


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(character for character in text if unicodedata.category(character) != "Mn")
    text = text.lower().strip()
    # Contractions are common in spoken replies.  Replacing the apostrophe
    # with a space lets fixed-width negation patterns match "don't"/"don’t"
    # without treating the whole phrase as an approval.
    text = re.sub(r"['’ʼ`]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text


def _has(pattern: str, text: str) -> Optional[re.Match]:
    return re.search(pattern, text, re.IGNORECASE)


def _is_spanish(text: str) -> bool:
    if re.search(r"[ñáéíóúü]", text, re.IGNORECASE):
        return True
    return bool(
        re.search(
            r"\b(?:quiero|prefiero|parece|puedes|hazlo|dale|estoy|bien|"
            r"continuar|dejarlo|apruebo|autorizo)\b",
            text,
        )
    )


def _clarification(text: str) -> str:
    if _is_spanish(text):
        return "Dime si te parece bien que continúe o prefieres que lo deje."
    return "Let me know if you’re comfortable with me going ahead or would rather I stop."


_STRONG_APPROVAL = re.compile(
    r"(?:"
    r"\b(?:yes|yeah|yep|yup|definitely|absolutely|certainly|affirmative)\b|"
    r"(?<!make )\bsure\b|"
    r"\b(?:go ahead|go for it|do it|please do|make it so|run it|execute it|"
    r"proceed|continue|confirm|confirmed|approve|approved|permission granted|"
    r"you have my approval|i approve|i confirm|that sounds good|sounds good|"
    r"that sounds fine|sounds fine|that sounds great|sounds great|"
    r"that d be great|that would be great|that s a good idea|that is a good idea|"
    r"i think that s good|i think that is good|that works|works for me|"
    r"that looks good|looks good|that seems fine|looks fine to me|"
    r"that s fine|that is fine|that s okay|that is okay|that s good|that is good|"
    r"i m okay with that|i am okay with that|i m fine with that|i am fine with that|"
    r"i m good with that|i am good with that|i m comfortable with that|"
    r"i am comfortable with that|fine by me|i m happy with that|"
    r"i am happy with that|i d be happy with that|that s fine by me|"
    r"that is fine by me|i agree|that makes sense|you can go ahead)\b|"
    r"\bsi\b(?!\s+(?:quieres|puedes|es|fuera|acaso|alguna|alguno))|"
    r"\b(?:claro|por supuesto|desde luego|adelante|hazlo|ejecutalo|procede|"
    r"continua|confirma|confirmado|aprueba|aprobado|autorizo|dale via libre|"
    r"de acuerdo|me parece bien|me parece perfecto|me parece estupendo|"
    r"me va bien|por mi esta bien|"
    r"por mi adelante|estoy de acuerdo|me gusta|puedes hacerlo|esta bien, hazlo|"
    r"si, por favor|si por favor)\b"
    r")"
)
_WEAK_APPROVAL = re.compile(
    r"^\s*(?:ok|okay|okey|vale|perfecto|perfect|genial|great|dale|listo|hecho|"
    r"esta bien|esta bueno)\s*[.!]*\s*$"
)
_REJECTION = re.compile(
    r"(?:"
    r"\b(?:no|nope|nah|negative|denied|cancel|cancelled|canceled|stop|abort|"
    r"reject|rejected|never mind|nevermind|do not|don t|dont|i reject|"
    r"i do not approve|i don t approve)\b|"
    r"\b(?:rechaza|rechazo|cancela|cancelalo|cancelar|para|detente|"
    r"no lo hagas|no gracias|mejor no|olvidalo|ni lo intentes|negativo|"
    r"no apruebo|no autorizo|i don t think so|i do not think so|i think not|"
    r"prefiero que no|preferiria que no|no me parece|no estoy de acuerdo|"
    r"no quiero eso|no quiero que lo hagas|no me convence|mejor dejalo|"
    r"dejalo asi|por ahora no|creo que no)\b"
    r")"
)
_CLEAR_REJECTION = re.compile(
    r"(?:"
    r"\b(?:i d rather not|i would rather not|i d prefer not|"
    r"i prefer not to|"
    r"i do not want that|i don t want that|i am not comfortable with that|"
    r"not comfortable with that|not this time|let s not|better not|"
    r"(?:that )?doesn t work for me|(?:that )?does not work for me|"
    r"that won t work|that will not work|that doesn t sound good|"
    r"that does not sound good|doesn t sound good|does not sound good|"
    r"i disagree|i do not agree)\b|"
    r"\b(?:no me parece|prefiero que no|preferiria que no|"
    r"no estoy de acuerdo|no quiero eso|no quiero que lo hagas|"
    r"no me convence|mejor dejalo|dejalo asi|por ahora no|creo que no)\b"
    r")"
)
_STRONG_MODIFICATION = re.compile(
    r"(?:"
    r"\b(?:instead|rather than|change|modify|adjust|replace|switch|"
    r"make it|"
    r"en lugar de|en vez de|cambia|cambiar|modifica|modificar|ajusta|"
    r"reemplaza)\b"
    r")"
)
_WEAK_MODIFICATION = re.compile(
    r"(?:"
    r"\b(?:wait|hold on|before you do|but|however|one moment|"
    r"espera|esperate|un momento|antes de que|pero|mejor)\b"
    r")"
)
_QUESTION = re.compile(
    r"(?:^\s*[¿¡]?\s*(?:what|why|how|when|where|who|which|can you|could you|"
    r"would you|will you|do you|did you|is it|are you|should i)\b|"
    r"^\s*[¿¡]?\s*(?:que|por que|como|cuando|donde|quien|cual|puedes|podrias|"
    r"vas a|debo|tengo que)\b|\?\s*$)",
    re.IGNORECASE,
)
_HEDGE = re.compile(
    r"(?:"
    r"\b(?:maybe|perhaps|probably|possibly|i guess|i think so|not sure|"
    r"i don t know|i am not sure|unsure|hmm+|let me think|not now)\b|"
    r"\b(?:quizas|tal vez|probablemente|no se|no estoy seguro|no estoy segura|"
    r"creo que si|creo que no|tal vez si|tal vez no|ahora no|dejame pensar)\b"
    r")"
)
_DEFER = re.compile(
    r"^\s*(?:wait|hold on|one moment|a moment|not now|espera|esperate|"
    r"un momento|ahora no|dejame pensar|let me think)\s*[.!]*\s*$"
)
_NEGATED_APPROVAL = re.compile(
    r"(?:"
    r"\b(?:yes|yeah|sure|ok|okay|si|claro|vale)\b[^.?!]{0,40}\b(?:but|however|pero|aunque)\b|"
    r"\bno\b\s*[,;:]\s*(?:yes|si|do it|hazlo)\b"
    r")"
)
_NEGATED_ACTION = re.compile(
    r"(?:"
    r"\b(?:do not|don t|dont|never)\s+(?:do|run|execute|proceed|continue|make|"
    r"touch|delete|remove|approve)\b|"
    r"\b(?:no|ni)\s+(?:lo\s+)?(?:hagas|ejecutes|corras|procedas|continues|"
    r"apruebes)\b"
    r")"
)
# Questions about the pending action should be answered, not treated as a new
# task.  Unrelated questions ("what is the weather?") stay ordinary chat.
_ACTION_QUESTION = re.compile(
    r"(?:"
    r"\bwhat (?:will|would|is going to) change\b|"
    r"\bwhat (?:does|will) (?:it|this|that) do\b|"
    r"\bwhat (?:are you|will you be) (?:going to )?(?:doing|changing|running)\b|"
    r"\bwhy (?:do|would|did) you (?:need|want)\b|"
    r"\bexplain (?:what|why|how)\b|"
    r"\b(?:tell me|more) (?:more )?(?:about|details)\b|"
    r"\bque (?:va a|vas a) cambiar\b|"
    r"\bque (?:hace|haras|vas a hacer)\b|"
    r"\bpor que (?:necesitas|quieres)\b|"
    r"\bexplica\b"
    r")",
    re.IGNORECASE,
)
_DECISION_TOPIC = re.compile(
    r"\b(?:approve|approval|confirm|confirmation|proceed|execute|delete|remove|"
    r"permission|risk|safe|action|aprueba|aprobacion|confirma|confirmacion|"
    r"permiso|riesgo|seguro|accion)\b",
    re.IGNORECASE,
)


def _strip_leading_modifier(text: str) -> str:
    cleaned = re.sub(
        r"^(?:instead|rather|but|however|wait|hold on|one moment|"
        r"en lugar de|en vez de|pero|espera|esperate|un momento)\b[\s,:-]*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    return cleaned or text


def parse_confirmation_intent(text: str) -> ConfirmationIntent:
    """Classify a spoken/written reply to a pending confirmation.

    The result never resolves anything by itself; the caller binds it to one
    specific pending request and expires it after first use.
    """
    normalized = _normalize(text)
    if not normalized:
        return ConfirmationIntent(ConfirmationDecision.NONE, 0.0)

    # A negation that directly governs the action is a rejection, even though
    # the phrase contains "do it".  This is checked before approval matching.
    if _NEGATED_ACTION.search(normalized):
        return ConfirmationIntent(
            ConfirmationDecision.REJECT,
            0.95,
            matched="negated_action",
        )
    if _CLEAR_REJECTION.search(normalized):
        return ConfirmationIntent(
            ConfirmationDecision.REJECT,
            0.95,
            matched="clear_rejection",
        )

    # A bare deferral is not an approval and not a rejection.  Keep the request
    # pending so the user can still decide explicitly.
    if _DEFER.fullmatch(normalized):
        return ConfirmationIntent(
            ConfirmationDecision.AMBIGUOUS,
            0.9,
            message="No problem, I’ll wait. Let me know how you’d like to proceed.",
            matched="defer",
        )

    # Conflict is ambiguity, never approval.
    has_approval = bool(_STRONG_APPROVAL.search(normalized))
    has_rejection = bool(_REJECTION.search(normalized))
    if _NEGATED_APPROVAL.search(normalized):
        return ConfirmationIntent(
            ConfirmationDecision.AMBIGUOUS,
            0.9,
            message=_clarification(text),
            matched="negated_approval",
        )
    if has_approval and has_rejection:
        return ConfirmationIntent(
            ConfirmationDecision.AMBIGUOUS,
            0.85,
            message=_clarification(text),
            matched="conflict",
        )

    # "What will change?" asks about the pending action and should be answered.
    # Unrelated questions are handled later as ordinary conversation.
    if _ACTION_QUESTION.search(normalized):
        return ConfirmationIntent(
            ConfirmationDecision.AMBIGUOUS,
            0.8,
            message="I can explain that before you decide. Then tell me how you’d like to proceed.",
            matched="action_question",
        )

    # An explicit change verb is a modification even when phrased as a
    # question ("could you change the folder to Documents?").  "Yes, but what
    # does it do?" is a question, not a modification, so weak connectors are
    # checked after question detection.
    if _STRONG_MODIFICATION.search(normalized):
        instructions = _strip_leading_modifier(text.strip())
        if len(instructions) < 3:
            return ConfirmationIntent(
                ConfirmationDecision.AMBIGUOUS,
                0.75,
                message="Please state what should change before I continue.",
                matched="modification_without_details",
            )
        return ConfirmationIntent(
            ConfirmationDecision.MODIFY,
            0.82 if not has_rejection else 0.7,
            instructions=instructions[:2000],
            matched="modification",
        )

    if _QUESTION.search(normalized):
        if has_approval or has_rejection or _DECISION_TOPIC.search(normalized):
            return ConfirmationIntent(
                ConfirmationDecision.AMBIGUOUS,
                0.8,
                message=_clarification(text),
                matched="question",
            )
        # An unrelated question is ordinary conversation.  It never resolves
        # the pending action because this decision is NONE.
        return ConfirmationIntent(ConfirmationDecision.NONE, 0.0)

    # A short rejection such as "mejor no" also contains the weak modifier
    # "mejor"; the rejection wins because it names no change to make.
    if has_rejection and not has_approval:
        return ConfirmationIntent(
            ConfirmationDecision.REJECT,
            0.95,
            matched="rejection",
        )

    if _WEAK_MODIFICATION.search(normalized):
        instructions = _strip_leading_modifier(text.strip())
        if len(instructions) < 3:
            return ConfirmationIntent(
                ConfirmationDecision.AMBIGUOUS,
                0.75,
                message="Please state what should change before I continue.",
                matched="modification_without_details",
            )
        return ConfirmationIntent(
            ConfirmationDecision.MODIFY,
            0.7 if not has_rejection else 0.65,
            instructions=instructions[:2000],
            matched="weak_modification",
        )

    if _HEDGE.search(normalized):
        return ConfirmationIntent(
            ConfirmationDecision.AMBIGUOUS,
            0.8,
            message=_clarification(text),
            matched="hedge",
        )

    if has_rejection:
        return ConfirmationIntent(
            ConfirmationDecision.REJECT,
            0.95,
            matched="rejection",
        )

    if has_approval:
        return ConfirmationIntent(
            ConfirmationDecision.APPROVE,
            0.95,
            matched="approval",
        )

    if _WEAK_APPROVAL.fullmatch(normalized):
        return ConfirmationIntent(
            ConfirmationDecision.AMBIGUOUS,
            0.7,
            message=_clarification(text),
            matched="weak_approval",
        )

    return ConfirmationIntent(ConfirmationDecision.NONE, 0.0)
