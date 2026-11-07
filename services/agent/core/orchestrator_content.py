import io
import logging
import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Mapping, Sequence
from typing import Literal, TypedDict

logger = logging.getLogger(__name__)
_HISTORY_SUMMARY_LIMIT = 900


class ConversationMessage(TypedDict):
    role: Literal["user", "assistant"]
    content: str


def resolve_plan_value(value: object, step_outputs: Mapping[str, object]) -> object:
    """Resolve validated workflow references against completed step outputs."""
    if isinstance(value, Mapping):
        if "$from_step" in value:
            if set(value) - {"$from_step", "path"}:
                raise ValueError("A step result reference contains unsupported fields.")
            source = value["$from_step"]
            if not isinstance(source, str) or source not in step_outputs:
                raise ValueError(f"Result for dependency {source} is unavailable.")
            resolved = step_outputs[source]
            path = value.get("path", [])
            if not isinstance(path, list):
                raise ValueError("A step result reference path must be a list.")
            for part in path:
                if isinstance(resolved, Mapping) and isinstance(part, str):
                    if part not in resolved:
                        raise ValueError(
                            f"Dependency {source} did not return the requested value."
                        )
                    resolved = resolved[part]
                elif (
                    isinstance(resolved, (list, tuple))
                    and isinstance(part, int)
                    and not isinstance(part, bool)
                    and 0 <= part < len(resolved)
                ):
                    resolved = resolved[part]
                else:
                    raise ValueError(
                        f"Dependency {source} did not return the requested value."
                    )
            return resolved
        return {
            key: resolve_plan_value(item, step_outputs)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [resolve_plan_value(item, step_outputs) for item in value]
    return value


def extract_attachment_text(name: str, mime_type: str, raw: bytes) -> str:
    """Extract supported text formats locally without persisting the attachment."""
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


def compact_conversation_history(
    history: Sequence[object],
    turn_limit: int = 20,
    auto_compaction: bool = True,
    compact_message_threshold: int = 10,
) -> tuple[list[ConversationMessage], str]:
    """Keep recent user/assistant turns and summarize older ones within a fixed budget."""
    messages: list[ConversationMessage] = []
    for message in history:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        if role in {"user", "assistant"} and isinstance(content, str):
            messages.append({"role": role, "content": content})

    message_limit = max(1, min(100, int(turn_limit))) * 2
    active_threshold = min(message_limit, max(4, compact_message_threshold))
    if len(messages) <= active_threshold:
        return messages, ""

    recent = messages[-active_threshold:]
    older = messages[:-active_threshold]
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
    summary_parts: list[str] = []
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
