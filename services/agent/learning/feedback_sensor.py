"""Feedback Sensor for HELIX Adaptive Learning Harness.

Detects user corrections, alignment errors, negative feedback, and preference
declarations from incoming user turns. Automatically extracts corrected rules
to feed into the procedural learning cycle.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Patterns that indicate the user is correcting the previous behavior
_CORRECTION_PATTERNS = [
    # Spanish patterns
    re.compile(r"^\s*no\b[,\.\s]+(?:hazlo|usa|ejecuta|pon|escribe|quiero|así no)", re.IGNORECASE),
    re.compile(r"^\s*(?:te equivocaste|está mal|eso no funciona|así no era|no quiero eso)", re.IGNORECASE),
    re.compile(r"\b(?:en vez de|en lugar de)\s+([^,]+?)\s+(?:usa|haz|pon|prefiere)\s+([^,]+)", re.IGNORECASE),
    re.compile(r"\b(?:mejor usa|mejor hazlo con|hazlo de esta otra forma|hazlo con)\b", re.IGNORECASE),
    re.compile(r"\b(?:no vuelvas a|nunca uses|no uses|evita usar)\s+([^,\.]+)", re.IGNORECASE),
    re.compile(r"\b(?:siempre debes|a partir de ahora|recuerda siempre)\s+([^,\.]+)", re.IGNORECASE),
    # English patterns
    re.compile(r"^\s*no\b[,\.\s]+(?:do it|use|run|not like that|don't|instead)", re.IGNORECASE),
    re.compile(r"^\s*(?:you are wrong|that is wrong|that didn't work|that failed|not what I wanted)", re.IGNORECASE),
    re.compile(r"\b(?:instead of)\s+([^,]+?)\s+(?:use|do|prefer)\s+([^,]+)", re.IGNORECASE),
    re.compile(r"\b(?:stop doing|never use|don't use|avoid using)\s+([^,\.]+)", re.IGNORECASE),
    re.compile(r"\b(?:always use|from now on|remember to always)\s+([^,\.]+)", re.IGNORECASE),
]


@dataclass
class AlignmentCorrection:
    is_correction: bool
    confidence: float
    correction_type: str  # 'negative_feedback' | 'explicit_override' | 'constraint' | 'preference'
    extracted_rule: Optional[str] = None
    trigger_text: str = ""


class FeedbackSensor:
    """Monitors user interactions and detects alignment corrections in real-time."""

    def __init__(self):
        pass

    def inspect_message(self, text: str, previous_actions: Optional[List[Dict[str, Any]]] = None) -> AlignmentCorrection:
        """Evaluates whether the user's turn contains a correction of previous behavior."""
        clean_text = text.strip()
        if not clean_text:
            return AlignmentCorrection(is_correction=False, confidence=0.0, correction_type="none")

        for pattern in _CORRECTION_PATTERNS:
            match = pattern.search(clean_text)
            if match:
                # Classify correction type
                lower_text = clean_text.lower()
                correction_type = "explicit_override"
                extracted_rule = None

                if any(kw in lower_text for kw in ["nunca", "evita", "no uses", "never", "don't use"]):
                    correction_type = "constraint"
                    extracted_rule = f"Evitar: {clean_text}"
                elif any(kw in lower_text for kw in ["siempre", "prefer", "a partir de ahora", "always", "from now on"]):
                    correction_type = "preference"
                    extracted_rule = f"Preferencia: {clean_text}"
                elif any(kw in lower_text for kw in ["en vez de", "en lugar de", "instead of"]):
                    correction_type = "substitution"
                    extracted_rule = clean_text
                else:
                    correction_type = "negative_feedback"
                    extracted_rule = f"Corrección del usuario: {clean_text}"

                logger.info(
                    "Sensor detected user alignment correction (%s): %s",
                    correction_type,
                    clean_text[:60],
                )
                return AlignmentCorrection(
                    is_correction=True,
                    confidence=0.9,
                    correction_type=correction_type,
                    extracted_rule=extracted_rule,
                    trigger_text=clean_text,
                )

        return AlignmentCorrection(
            is_correction=False,
            confidence=0.0,
            correction_type="none",
        )
