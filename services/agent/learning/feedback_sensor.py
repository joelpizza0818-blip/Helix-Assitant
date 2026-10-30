"""Feedback Sensor for HELIX Adaptive Learning Harness.

Detects user corrections, alignment errors, negative feedback, and preference
declarations from incoming user turns. Automatically extracts corrected rules
and classifies their intent (one-off fix vs permanent preference vs constraint)
so only genuine, actionable knowledge is persisted into procedural memory.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class CorrectionIntent(str, Enum):
    ONE_OFF_FIX = "one_off_fix"
    PERMANENT_PREFERENCE = "preference"
    CONTEXTUAL_PREFERENCE = "contextual_preference"
    SAFETY_CONSTRAINT = "constraint"
    SUBSTITUTION = "substitution"
    NEGATIVE_FEEDBACK = "negative_feedback"
    NONE = "none"


# Patterns indicating permanent rules or explicit behavioral changes
_PERMANENT_PATTERNS = [
    re.compile(r"\b(?:a partir de ahora|de ahora en adelante|from now on)\b", re.IGNORECASE),
    re.compile(r"\b(?:recuerda siempre|siempre debes|siempre usa|always use|always do)\b", re.IGNORECASE),
    re.compile(r"\b(?:mi preferencia es|prefiero que siempre|i prefer that you always)\b", re.IGNORECASE),
]

# Patterns indicating safety constraints or prohibitions
_CONSTRAINT_PATTERNS = [
    re.compile(r"\b(?:nunca uses?|no vuelvas a|evita usar|never use|don't ever use|avoid using)\s+([^,\.]+)", re.IGNORECASE),
    re.compile(r"\b(?:nunca borres|nunca modifiques|no ejecutes sin confirmación)\b", re.IGNORECASE),
]

# Substitution patterns (X instead of Y)
_SUBSTITUTION_PATTERNS = [
    re.compile(r"\b(?:en vez de|en lugar de)\s+([^,]+?)\s+(?:usa|haz|pon|prefiere)\s+([^,\.]+)", re.IGNORECASE),
    re.compile(r"\b(?:instead of)\s+([^,]+?)\s+(?:use|do|prefer)\s+([^,\.]+)", re.IGNORECASE),
    re.compile(r"\b(?:mejor usa|mejor hazlo con|hazlo de esta otra forma con)\s+([^,\.]+)", re.IGNORECASE),
]

# Contextual patterns (scoped to a language, project or framework)
_CONTEXTUAL_PATTERNS = [
    re.compile(r"\b(?:en este proyecto|para este proyecto|en react|en python|en rust|para las pruebas|para los tests)\b", re.IGNORECASE),
    re.compile(r"\b(?:in this project|for this project|in react|in python|when writing tests)\b", re.IGNORECASE),
]

# One-off task corrections (fixing current turn, not a global life preference)
_ONE_OFF_PATTERNS = [
    re.compile(r"^\s*no\b[,\.\s]+(?:aquí no|en esta línea|corrige el error|arregla eso|cambia la línea)", re.IGNORECASE),
    re.compile(r"^\s*(?:te equivocaste en|hay un error en|el test falló|no compila|da error de sintaxis)", re.IGNORECASE),
    re.compile(r"\b(?:corrige eso|arregla este fallo|reintenta con el parámetro)\b", re.IGNORECASE),
]

# Broad negative feedback / general correction triggers
_GENERAL_CORRECTION_PATTERNS = [
    re.compile(r"^\s*no\b[,\.\s]+(?:hazlo|usa|ejecuta|pon|escribe|quiero|así no)", re.IGNORECASE),
    re.compile(r"^\s*(?:te equivocaste|está mal|eso no funciona|así no era|no quiero eso)", re.IGNORECASE),
    re.compile(r"^\s*no\b[,\.\s]+(?:do it|use|run|not like that|don't|instead)", re.IGNORECASE),
    re.compile(r"^\s*(?:you are wrong|that is wrong|that didn't work|that failed|not what I wanted)", re.IGNORECASE),
]


@dataclass
class AlignmentCorrection:
    is_correction: bool
    confidence: float
    correction_type: str  # maps to CorrectionIntent value or legacy name
    extracted_rule: Optional[str] = None
    trigger_text: str = ""
    should_persist_rule: bool = False
    context_scope: Optional[str] = None
    target_rejected: Optional[str] = None
    preference_target: Optional[str] = None


class FeedbackSensor:
    """Monitors user interactions and detects alignment corrections in real-time."""

    def __init__(self):
        pass

    def inspect_message(
        self,
        text: str,
        previous_actions: Optional[List[Dict[str, Any]]] = None,
    ) -> AlignmentCorrection:
        """Evaluates whether the user's turn contains a correction of previous behavior."""
        clean_text = text.strip()
        if not clean_text:
            return AlignmentCorrection(
                is_correction=False,
                confidence=0.0,
                correction_type=CorrectionIntent.NONE.value,
                should_persist_rule=False,
            )

        lower_text = clean_text.lower()

        # 1. Check for Safety Constraints
        for pat in _CONSTRAINT_PATTERNS:
            match = pat.search(clean_text)
            if match:
                rejected = match.group(1).strip() if match.groups() else ""
                rule = f"Restricción estricta: evitar {rejected or clean_text}"
                logger.info("FeedbackSensor: detected SAFETY_CONSTRAINT -> %s", clean_text[:60])
                return AlignmentCorrection(
                    is_correction=True,
                    confidence=1.0,
                    correction_type=CorrectionIntent.SAFETY_CONSTRAINT.value,
                    extracted_rule=rule,
                    trigger_text=clean_text,
                    should_persist_rule=True,
                    target_rejected=rejected,
                )

        # 2. Check for Substitutions (X instead of Y)
        for pat in _SUBSTITUTION_PATTERNS:
            match = pat.search(clean_text)
            if match:
                groups = match.groups()
                rejected = groups[0].strip() if len(groups) > 0 else None
                preferred = groups[1].strip() if len(groups) > 1 else None
                rule = f"Preferencia de sustitución: usar {preferred} en lugar de {rejected}" if (rejected and preferred) else clean_text
                logger.info("FeedbackSensor: detected SUBSTITUTION -> %s", clean_text[:60])
                return AlignmentCorrection(
                    is_correction=True,
                    confidence=0.85,
                    correction_type=CorrectionIntent.SUBSTITUTION.value,
                    extracted_rule=rule,
                    trigger_text=clean_text,
                    should_persist_rule=True,
                    target_rejected=rejected,
                    preference_target=preferred,
                )

        # 3. Check for Permanent Preferences
        for pat in _PERMANENT_PATTERNS:
            if pat.search(clean_text):
                rule = f"Preferencia permanente: {clean_text}"
                logger.info("FeedbackSensor: detected PERMANENT_PREFERENCE -> %s", clean_text[:60])
                return AlignmentCorrection(
                    is_correction=True,
                    confidence=0.9,
                    correction_type=CorrectionIntent.PERMANENT_PREFERENCE.value,
                    extracted_rule=rule,
                    trigger_text=clean_text,
                    should_persist_rule=True,
                )

        # 4. Check for Contextual Preferences
        for pat in _CONTEXTUAL_PATTERNS:
            match = pat.search(clean_text)
            if match:
                scope = match.group(0).strip()
                rule = f"Preferencia contextual [{scope}]: {clean_text}"
                logger.info("FeedbackSensor: detected CONTEXTUAL_PREFERENCE (%s) -> %s", scope, clean_text[:60])
                return AlignmentCorrection(
                    is_correction=True,
                    confidence=0.65,
                    correction_type=CorrectionIntent.CONTEXTUAL_PREFERENCE.value,
                    extracted_rule=rule,
                    trigger_text=clean_text,
                    should_persist_rule=True,
                    context_scope=scope,
                )

        # 5. Check for One-Off Fixes (e.g. typos, line-specific fixes in this turn)
        for pat in _ONE_OFF_PATTERNS:
            if pat.search(clean_text):
                logger.info("FeedbackSensor: detected ONE_OFF_FIX (do not persist globally) -> %s", clean_text[:60])
                return AlignmentCorrection(
                    is_correction=True,
                    confidence=0.75,
                    correction_type=CorrectionIntent.ONE_OFF_FIX.value,
                    extracted_rule=None,
                    trigger_text=clean_text,
                    should_persist_rule=False,  # DO NOT convert one-off corrections into permanent rules!
                )

        # 6. Check for General Corrections / Negative Feedback
        for pat in _GENERAL_CORRECTION_PATTERNS:
            if pat.search(clean_text):
                # Distinguish if it contains concrete preference instruction vs raw frustration
                has_concrete_directive = any(kw in lower_text for kw in ["usa ", "hazlo ", "use ", "pon ", "escribe "])
                if has_concrete_directive:
                    return AlignmentCorrection(
                        is_correction=True,
                        confidence=0.7,
                        correction_type="explicit_override",
                        extracted_rule=f"Corrección de comportamiento: {clean_text}",
                        trigger_text=clean_text,
                        should_persist_rule=True,
                    )
                else:
                    logger.info("FeedbackSensor: detected raw NEGATIVE_FEEDBACK (recorded for episode, no permanent rule) -> %s", clean_text[:60])
                    return AlignmentCorrection(
                        is_correction=True,
                        confidence=0.6,
                        correction_type=CorrectionIntent.NEGATIVE_FEEDBACK.value,
                        extracted_rule=None,
                        trigger_text=clean_text,
                        should_persist_rule=False,  # Don't create random rules from just "eso está mal"
                    )

        return AlignmentCorrection(
            is_correction=False,
            confidence=0.0,
            correction_type=CorrectionIntent.NONE.value,
            should_persist_rule=False,
        )
