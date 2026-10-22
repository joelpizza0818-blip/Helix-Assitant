"""Multimedia and Screen Context Handler for HELIX Agent.

Extracts text from uploaded user documents and manages on-demand screen observation.
"""

import io
import logging
import re
import zipfile
import xml.etree.ElementTree as ET

try:
    from services.agent.perception.screen_observation_policy import (
        screen_observation_scope,
    )
except ImportError:
    from perception.screen_observation_policy import screen_observation_scope

logger = logging.getLogger(__name__)

_SCREEN_OBSERVATION_INTENT = re.compile(
    r"\b(?:"
    r"(?:look\s+at|inspect|describe|summari[sz]e|read|check|analy[sz]e|"
    r"mira|observa|describe|resume|lee|revisa|inspecciona)"
    r"\s+(?:(?:my|the|current|active|open|this|mi|la|el|actual)\s+)?"
    r"(?:screen|desktop|window|pantalla|escritorio|ventana|"
    r"(?:open|active|current)\s+"
    r"(?:(?:microsoft\s+)?(?:word|excel|notepad)\s+)?"
    r"(?:window|app|application|aplicaci[o\u00f3]n))"
    r"|what(?:'s|\s+is)\s+(?:on|in|inside)\s+"
    r"(?:(?:my|the|current|active|this)\s+)?"
    r"(?:screen|desktop|window)"
    r"|what(?:'s|\s+is)\s+(?:in|inside)\s+"
    r"(?:the\s+)?(?:open|active|current)\s+"
    r"(?:(?:microsoft\s+)?(?:word|excel|notepad)\s+)?"
    r"(?:window|app|application)"
    r"|what(?:'s|\s+is)\s+(?:visible|shown|displayed)\s+(?:in|on)\s+"
    r"(?:(?:the\s+)?(?:my|the|current|active|this)\s+)?"
    r"(?:screen|desktop|window)"
    r"|(?:qu[e\u00e9]|que)\s+(?:hay|aparece|se\s+ve|ves)\s+"
    r"(?:en|dentro\s+de)\s+(?:(?:la|mi)\s+)?"
    r"(?:pantalla|escritorio|ventana)(?:\s+(?:abierta|actual))?"
    r"|(?:take|capture|grab|make)\s+(?:a\s+)?"
    r"(?:screenshot|screen\s+capture|capture\s+of\s+(?:the\s+)?screen)"
    r"|(?:toma|haz|captura)\s+(?:una?\s+)?"
    r"(?:captura(?:\s+de\s+pantalla)?|pantallazo)"
    r")\b",
    re.IGNORECASE,
)

_SCREEN_ACTION_INTENT = re.compile(
    r"^\s*(?:(?:please|kindly|por\s+favor)\s+)?"
    r"(?:click|clic|tap|press|select|choose|type|write|paste|drag|"
    r"haz\s+clic(?:\s+en)?|pulsa|selecciona|escribe|pega|arrastra)"
    r"\s+(?:(?:the|a|an|my|this|el|la|un|una|mi)\s+)?"
    r"(?:"
    r"(?:microsoft\s+)?(?:word|excel|notepad)\s+"
    r"(?:app|application|document|window|icon|aplicaci[o\u00f3]n|"
    r"documento|ventana|icono)|"
    r"(?:microsoft\s+)?(?:word|excel|notepad)\s+"
    r"(?:button|menu|link|element|bot[o\u00f3]n|men[u\u00fa]|enlace|elemento)|"
    r"(?:app|application|aplicaci[o\u00f3]n)\s+"
    r"(?:microsoft\s+)?(?:word|excel|notepad)|"
    r"(?:save|submit|close|menu|button|link|icon|element|"
    r"guardar|enviar|cerrar|men[u\u00fa]|bot[o\u00f3]n|enlace|icono|elemento)"
    r"(?:\s+(?:button|menu|link|icon|element|bot[o\u00f3]n|men[u\u00fa]|"
    r"enlace|icono|elemento))?\s+"
    r"(?:on|in|en)\s+"
    r"(?:(?:the|my|current|active|this|el|la|mi|actual)\s+)?"
    r"(?:screen|desktop|window|pantalla|escritorio|ventana)"
    r")\b",
    re.IGNORECASE,
)

_METALINGUISTIC_INTENT = re.compile(
    r"^\s*(?:"
    r"what\s+does\b.*\bmean\b|"
    r"what\s+is\s+the\s+meaning\s+of\b|"
    r"explain\b.*\b(?:mean|means|meaning)\b|"
    r"explain\s+(?:the\s+)?(?:word|phrase|sentence|expression|term)\b|"
    r"translate\b|translation\b|"
    r"qu[e\u00e9]\s+(?:significa|quiere\s+decir)\b|"
    r"explica(?:r)?\b.*\b(?:significa|quiere\s+decir|significado)\b|"
    r"explica(?:r)?\s+(?:la\s+|el\s+)?(?:palabra|frase|oraci[o\u00f3]n|expresi[o\u00f3]n|t[e\u00e9]rmino)\b|"
    r"traduce\b|traducci[o\u00f3]n\b"
    r")",
    re.IGNORECASE,
)


def should_observe_screen(enabled: bool, description: str) -> bool:
    if not enabled or _METALINGUISTIC_INTENT.search(description):
        return False
    return bool(
        _SCREEN_OBSERVATION_INTENT.search(description)
        or _SCREEN_ACTION_INTENT.search(description)
    )


async def append_requested_screen_observation(
    messages: list,
    tool_registry,
    task_id: str,
) -> None:
    observe_tool = tool_registry.get_tool("computer.observe_screen")
    observation = None
    failure = None
    if observe_tool is None:
        failure = "Screen observation tool is unavailable."
    else:
        try:
            with screen_observation_scope(True):
                observation = await observe_tool.execute({})
        except Exception as error:
            logger.exception(
                "On-demand screen observation raised an error for task %s",
                task_id,
            )
            failure = f"Screen observation failed ({type(error).__name__})."

    observed = getattr(observation, "output", None)
    if failure is None and (
        observation is None or not getattr(observation, "success", False)
    ):
        logger.error(
            "Screen observation did not succeed for task %s: %s",
            task_id,
            getattr(observation, "error", None) or "Unknown error",
        )
        failure = getattr(observation, "error", None) or "Screen observation failed."

    if failure is not None:
        messages.append(
            {
                "role": "system",
                "content": f"[Screen Observation Note: {failure}]",
            }
        )
        return

    content_parts = []
    if isinstance(observed, dict):
        text_summary = observed.get("text")
        if text_summary:
            content_parts.append(
                f"[Current Screen Context:\n{text_summary}]"
            )
        active_window = observed.get("active_window")
        if active_window:
            content_parts.append(f"[Active Window: {active_window}]")
        screenshot = observed.get("screenshot")
        if screenshot:
            content_parts.append(f"[Screenshot bytes attached: {len(screenshot)}]")

    if content_parts:
        messages.append(
            {
                "role": "system",
                "content": "\n".join(content_parts),
            }
        )


def extract_attachment_text(name: str, mime_type: str, raw: bytes) -> str:
    """Extract common document formats without writing user attachments to disk."""
    lower_name = name.casefold()
    if mime_type == "application/pdf" or lower_name.endswith(".pdf"):
        try:
            import fitz
            return "\n".join(page.get_text() for page in fitz.open(stream=raw, filetype="pdf"))
        except Exception:
            return "This PDF could not be extracted locally."
    if mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" or lower_name.endswith(".docx"):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                root = ET.fromstring(archive.read("word/document.xml"))
            return "\n".join(
                node.text or "" for node in root.iter()
                if node.tag.casefold().endswith("}t")
            )
        except Exception:
            return "This DOCX could not be extracted locally."
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return "This binary attachment cannot be decoded locally."
