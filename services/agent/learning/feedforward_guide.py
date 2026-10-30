"""Feedforward Dynamic Guide for HELIX Adaptive Learning.

Generates and maintains ~/.helix/USER.md and injects tailored system guidance
before each model turn, ensuring the model acts according to the user's learned
preferences and verified procedural guidelines.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_USER_MD_PATH = Path.home() / ".helix" / "USER.md"


class FeedforwardGuide:
    """Manages the dynamic USER.md guide and system prompt feedforward injection."""

    def __init__(
        self,
        user_md_path: Optional[Path] = None,
        procedural_memory=None,
    ):
        self.user_md_path = Path(user_md_path or DEFAULT_USER_MD_PATH)
        self.user_md_path.parent.mkdir(parents=True, exist_ok=True)
        self.procedural_memory = procedural_memory
        self.ensure_user_md()

    def ensure_user_md(self) -> None:
        """Initializes ~/.helix/USER.md if not yet present."""
        if not self.user_md_path.exists():
            default_content = (
                "# HELIX - Perfil Adaptativo del Usuario (USER.md)\n\n"
                "> Este archivo contiene las pautas y hábitos aprendidos dinámicamente "
                "por HELIX a través de la interacción. Es editable tanto por el usuario como por el arnés.\n\n"
                "## Preferencias Generales\n"
                "- Idioma: Español\n"
                "- Estilo: Conciso, directo a la solución y sin preámbulos innecesarios\n"
                "- Terminal: PowerShell (Windows) con rutas entre comillas\n"
                "- Navegador: Playwright aislado para automatizaciones y extensión para sesión activa\n\n"
                "## Reglas de Procedimiento Aprendidas\n"
                "- Ejecución: Verificar exit codes antes de asumir éxito de un comando.\n\n"
                "## Restricciones y Anti-Patrones\n"
                "- No ejecutar operaciones destructivas sin confirmación.\n"
            )
            self.user_md_path.write_text(default_content, encoding="utf-8")

    def sync_from_profile(self, profile: Dict[str, Any]) -> None:
        """Synchronizes USER.md file from procedural memory profile."""
        preferences = profile.get("preferences", {})
        rules = profile.get("learned_rules", [])

        lines = [
            "# HELIX - Perfil Adaptativo del Usuario (USER.md)",
            "",
            "> Sincronizado automáticamente por el arnés adaptativo.",
            "",
            "## Preferencias Generales",
        ]

        for k, v in preferences.items():
            lines.append(f"- **{k}**: {v}")

        lines.extend(["", "## Reglas de Procedimiento Aprendidas"])
        if rules:
            for r in rules:
                rule_text = r.get("rule", "")
                conf = r.get("confidence", 1.0)
                lines.append(f"- {rule_text} *(confianza: {conf:.1f})*")
        else:
            lines.append("- (Aún no se han acumulado reglas personalizadas)")

        self.user_md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def build_feedforward_prompt(self, query: str = "") -> str:
        """Constructs the feedforward context string to inject into the system prompt."""
        if self.procedural_memory is not None:
            relevant_rules = self.procedural_memory.find_relevant_rules(query, top_k=4)
        else:
            relevant_rules = []

        # Read top summary from USER.md if available
        user_md_snippet = ""
        if self.user_md_path.exists():
            try:
                full_md = self.user_md_path.read_text(encoding="utf-8").strip()
                # Keep up to 600 characters of high-level guidance
                user_md_snippet = full_md[:600]
            except Exception:
                pass

        blocks = []
        if user_md_snippet:
            blocks.append(f"[Adaptive User Profile (USER.md)]:\n{user_md_snippet}")

        if relevant_rules:
            rule_texts = [f"- {r.get('rule')}" for r in relevant_rules]
            blocks.append(
                "[Learned Procedural Preferences for this Context]:\n"
                + "\n".join(rule_texts)
            )

        return "\n\n".join(blocks)
