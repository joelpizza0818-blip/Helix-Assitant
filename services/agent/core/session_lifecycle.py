"""Session Lifecycle and History Compaction for HELIX Agent."""

import logging
import os
import platform
import re

try:
    from services.agent.core.runtime_context import describe_runtime_os
except ImportError:
    from core.runtime_context import describe_runtime_os

logger = logging.getLogger(__name__)

_HISTORY_SUMMARY_LIMIT = 900

_OS_QUERY_INTENT = re.compile(
    r"\b(?:what|which)\s+(?:operating system|os)\s+"
    r"(?:is\s+(?:helix|this computer|my computer)\s+running|"
    r"(?:am i|is helix|is this computer|is my computer)\s+"
    r"(?:running|using|on)|does helix run on)\b"
    r"|\bwhat\s+(?:is\s+)?(?:my|this computer's|helix's)\s+"
    r"(?:operating system|os)\b"
    r"|\b(?:qué|que)\s+(?:sistema operativo|os)\s+"
    r"(?:(?:está|esta)\s+(?:usando|corriendo|ejecutando)\s+"
    r"(?:helix|esta computadora|este equipo|mi computadora|mi equipo)|"
    r"(?:usa|corre|ejecuta|tiene)\s+"
    r"(?:helix|esta computadora|este equipo|mi computadora|mi equipo)|"
    r"(?:tengo instalado|tengo)\b)"
    r"|\b(?:qué|que)\s+versión\s+de\s+windows\s+tengo\b",
    re.IGNORECASE,
)


def compact_conversation_history(
    history: list,
    turn_limit: int = 20,
    auto_compaction: bool = True,
) -> tuple[list, str]:
    messages = [
        {"role": message["role"], "content": message["content"]}
        for message in history
        if isinstance(message, dict)
        and message.get("role") in {"user", "assistant"}
        and isinstance(message.get("content"), str)
    ]
    message_limit = max(1, min(100, int(turn_limit))) * 2
    if len(messages) <= message_limit:
        return messages, ""

    recent = messages[-message_limit:]
    older = messages[:-message_limit]
    if not auto_compaction:
        logger.info(
            "Conversation history windowed messages=%d->%d turns=%d compaction=disabled",
            len(messages),
            len(recent),
            turn_limit,
        )
        return recent, ""

    summary_prefix = (
        "Earlier conversation, compact extract; prioritize the exact recent messages: "
    )
    summary_parts = []
    summary_length = len(summary_prefix)
    for message in reversed(older):
        content = " ".join(message["content"].split())
        if len(content) > 200:
            content = f"{content[:199]}…"
        label = "User" if message["role"] == "user" else "HELIX"
        part = f"{label}: {content}"
        separator_length = 3 if summary_parts else 0
        if summary_length + separator_length + len(part) > _HISTORY_SUMMARY_LIMIT:
            remaining = _HISTORY_SUMMARY_LIMIT - summary_length - separator_length
            content_budget = remaining - len(label) - 2
            if content_budget > 1:
                summary_parts.append(
                    f"{label}: {content[:content_budget - 1]}…"
                )
            break
        summary_parts.append(part)
        summary_length += separator_length + len(part)

    summary = summary_prefix + " | ".join(reversed(summary_parts))
    logger.info(
        "Conversation history compacted messages=%d->%d turns=%d summary_characters=%d",
        len(messages),
        len(recent),
        turn_limit,
        len(summary) if summary_parts else 0,
    )
    return recent, summary if summary_parts else ""


def fast_os_answer(text: str, tool_registry=None) -> str | None:
    if not _OS_QUERY_INTENT.search(text):
        return None
    os_name = platform.system()
    operating_system_name = describe_runtime_os()
    architecture = platform.machine()
    shell_tool = tool_registry.get_tool("shell_tool") if tool_registry else None
    shell = getattr(shell_tool, "default_shell_type", None) or (
        "powershell" if os_name == "Windows" else "bash"
    )
    is_spanish = bool(
        re.search(r"\b(qué|que|sistema|está|esta|corre|ejecuta|usa|helix)\b", text, re.I)
    )
    if os_name == "Windows":
        shell_name = {
            "powershell": "PowerShell",
            "cmd": "CMD",
            "wsl": "WSL Bash",
            "bash": "Bash",
        }.get(shell, shell)
        shell_description = (
            f"el shell configurado es {shell_name}"
            if is_spanish
            else f"configured shell is {shell_name}"
        )
        description = (
            f"{operating_system_name} ({architecture}); {shell_description}."
        )
    elif os_name == "Darwin":
        shell_description = (
            f"el shell configurado es {shell}"
            if is_spanish
            else f"configured shell is {shell}"
        )
        description = (
            f"{operating_system_name} ({architecture}); {shell_description}."
        )
    else:
        shell_description = (
            f"el shell configurado es {shell}"
            if is_spanish
            else f"configured shell is {shell}"
        )
        description = (
            f"{operating_system_name} ({architecture}); {shell_description}."
        )
    return description
