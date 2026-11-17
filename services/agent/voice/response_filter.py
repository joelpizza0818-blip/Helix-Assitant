"""Absolute code-free speech policy.

No code, command, SQL statement, patch, log, stack trace, inline code or tool
output may ever reach a text-to-speech engine.  This module is the single
place that turns an agent response into speakable prose.  TTS adapters call it
again defensively, so a future UI cannot bypass the policy by accident.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional

CODE = "code"
INLINE_CODE = "inline_code"
COMMAND = "command"
SQL = "sql"
LOG = "log"
DIFF = "diff"
STRUCTURED = "structured_data"
PATH = "path"
URL = "url"
HASH = "identifier"

_ANNOUNCED_KINDS = {CODE, COMMAND, SQL, LOG, DIFF, STRUCTURED}

_FENCED_BLOCK = re.compile(
    r"(?ms)^[ \t]*(?P<fence>`{3,}|~{3,})[^\n]*\n.*?(?:^[ \t]*(?P=fence)[ \t]*$|\Z)"
)
_INLINE_TRIPLE = re.compile(r"(?s)```.*?```")
_INLINE_CODE = re.compile(r"(?<!`)`[^`\n]{1,400}`(?!`)")
_HTML_BLOCK = re.compile(
    r"(?is)<(?:script|style|pre|code)\b[^>]*>.*?</(?:script|style|pre|code)>"
)
_HTML_TAG = re.compile(r"(?i)</?[a-z][a-z0-9:-]*(?:\s[^<>]{0,300})?/?>")
_MARKDOWN_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]+\)")
_MARKDOWN_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_URL = re.compile(r"(?i)\bhttps?://[^\s<>()\[\]{}]+")
_WINDOWS_PATH = re.compile(
    r"(?i)\b[A-Z]:\\(?:[^\\\s:*?\"<>|]+\\)*[^\\\s:*?\"<>|]*"
)
_UNIX_PATH = re.compile(
    r"(?<![\w])/(?:usr|etc|var|home|opt|tmp|bin|sbin|dev|proc|sys|mnt|media|srv)/[^\s,;:]+"
)
_RELATIVE_CODE_PATH = re.compile(
    r"(?i)\b(?:src|lib|app|apps|services|tests?|docs?|scripts?|packages?|"
    r"components?|hooks?|pages?|routes?|models?|core|config)/"
    r"[\w./-]+\.(?:py|pyi|ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|md|dart|"
    r"java|kt|go|rs|c|cc|cpp|h|hpp|cs|rb|php|sh|ps1|bat|sql|css|scss|html|"
    r"vue|svelte|xml|ini|cfg|conf|env)\b"
)
_HASH = re.compile(r"\b(?:[A-Fa-f0-9]{24,}|[A-Za-z0-9+/]{48,}={0,2})\b")
_SHELL_PROMPT = re.compile(r"^\s*(?:\$|>|PS [^>\n]*>|[A-Za-z]:\\[^>\n]*>|%[^%\n]*%>)\s*")
_SHELL_COMMAND = re.compile(
    r"(?i)^\s*(?:"
    r"sudo\s|npm\s|npx\s|pnpm\s|yarn\s|bun\s|pip3?\s|python3?\s|py\s|"
    r"node\s|deno\s|git\s|docker(?:\s|-compose\s)|kubectl\s|helm\s|"
    r"curl\s|wget\s|ssh\s|scp\s|rsync\s|powershell\s|pwsh\s|cmd\s|"
    r"winget\s|choco\s|scoop\s|brew\s|apt(?:-get)?\s|dnf\s|yum\s|pacman\s|"
    r"systemctl\s|service\s|chmod\s|chown\s|make\s+\w|cmake\s|cargo\s|"
    r"flutter\s|dart\s|adb\s|gcc\s|clang\s|javac\s|java\s+-jar|"
    r"(?:cd|ls|dir|mkdir|rmdir|rm|del|cp|mv|copy|move|cat|type|echo)\s+"
    r")"
)
_SQL = re.compile(
    r"(?i)^\s*(?:SELECT\s|INSERT\s+INTO\s|UPDATE\s+\w+\s+SET\s|"
    r"DELETE\s+FROM\s|CREATE\s+(?:TABLE|DATABASE|INDEX|VIEW|SCHEMA)\s|"
    r"ALTER\s+TABLE\s|DROP\s+(?:TABLE|DATABASE|INDEX|VIEW)\s|"
    r"TRUNCATE\s|GRANT\s|REVOKE\s|EXPLAIN\s|WITH\s+\w+\s+AS\s*\(|"
    r"PRAGMA\s|VACUUM\s|BEGIN\s+TRANSACTION)"
)
_LOG = re.compile(
    r"(?i)^\s*(?:"
    r"\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?|"
    r"\d{2}:\d{2}:\d{2}[.,]\d+\s+(?:INFO|WARN|ERROR|DEBUG|TRACE)|"
    r"(?:INFO|WARN|WARNING|ERROR|DEBUG|TRACE|CRITICAL|FATAL)\b\s*[:\-\]]|"
    r"Traceback \(most recent call last\)|"
    r'File\s+".+",\s+line\s+\d+|'
    r"at\s+\S+\s+\([^)]*:\d+(?::\d+)?\)|"
    r"Caused by:\s"
    r")"
)
_CODE_LINE = re.compile(
    r"(?i)^\s*(?:"
    r"#!|#include\s|package\s+\w|using\s+\w|namespace\s+\w|"
    r"import\s+[\w.{*]|from\s+[\w.]+\s+import\s|"
    r"(?:async\s+)?def\s+\w+\s*\(|class\s+\w+|"
    r"(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(|"
    r"(?:const|let|var)\s+\w+\s*=|"
    r"(?:public|private|protected|static)\s+\w+|"
    r"return\s+[\[{(]|"
    r"if\s*\(|for\s*\(|while\s*\(|switch\s*\(|try\s*\{|catch\s*\(|"
    r"@(?:Override|Injectable|Component|Autowired)\b|"
    r"(?:>>>|\.\.\.)\s|"
    r"(?:diff --git|@@\s+-\d|\+\+\+\s|---\s)"
    r")"
)
_JSON_LINE = re.compile(r"^\s*[\[{].*(?::|,).*[\]}]\s*,?\s*$")
_YAML_ENTRY = re.compile(r"^\s{0,8}[A-Za-z_][\w.-]{0,64}:\s*(?:[\[{|>&*!]|$)")
_DIFF_MARKER = re.compile(r"^(?:diff --git|index [0-9a-f]+\.\.|@@\s|[-+]{3}\s)")
_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEPARATOR = re.compile(r"^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$")
_MARKDOWN_PREFIX = re.compile(r"^\s*(?:#{1,6}\s*|>\s?|[-*+]\s+|\d+[.)]\s+)")
_EMPHASIS = re.compile(r"(?<!\w)[*_~]{1,3}|[*_~]{1,3}(?!\w)")
_SENTENCE_END = re.compile(r"[.!?…](?:\s|$)")
_INLINE_COMMAND_HINT = re.compile(
    r"(?i)^(?:sudo|npm|npx|pnpm|yarn|pip|python|node|git|docker|kubectl|curl|"
    r"wget|powershell|winget|choco|brew|apt|systemctl|chmod|chown|make|cmake|"
    r"cargo|flutter|adb|cd|ls|dir|mkdir|rm|del|cp|mv|cat|type|echo)\b"
)
_INLINE_CODE_HINT = re.compile(r"[{}();=<>]|=>|->|::|</|/>")
_INLINE_PATH_HINT = re.compile(r"(?:[A-Za-z]:\\|/[\w.-]+/|\.(?:py|ts|tsx|js|jsx|json|ya?ml|md|dart|java|go|rs|c|cpp|h|cs|rb|php|sh|ps1|bat|sql)\b)")


def _replace_inline_code(match: re.Match, spanish: bool) -> str:
    content = (match.group(0)[1:-1] if match.group(0) else "").strip()
    if not content:
        return ""
    if _INLINE_COMMAND_HINT.search(content) or content.startswith(("$", ">", "PS ")):
        return "el comando" if spanish else "the command"
    if _INLINE_PATH_HINT.search(content):
        return "el archivo" if spanish else "the file"
    if _INLINE_CODE_HINT.search(content):
        return "el código" if spanish else "the code"
    return ""


@dataclass(frozen=True)
class SpeechFilterResult:
    text: str
    had_code: bool
    kinds: tuple[str, ...]
    original_chars: int
    spoken_chars: int
    truncated: bool = False


def _looks_spanish(text: str) -> bool:
    if re.search(r"[¿¡ñáéíóúü]", text, re.IGNORECASE):
        return True
    lowered = f" {text.lower()} "
    hits = sum(
        1
        for word in (
            " que ",
            " para ",
            " con ",
            " esto ",
            " este ",
            " puedo ",
            " vamos ",
            " código ",
            " archivo ",
            " pantalla ",
            " gracias ",
            " hola ",
            " ahora ",
            " pero ",
            " está ",
        )
        if word in lowered
    )
    return hits >= 2


def _notice(kinds: Iterable[str], spanish: bool) -> str:
    kinds = set(kinds)
    if DIFF in kinds:
        return "Los cambios están en pantalla." if spanish else "The changes are on screen."
    if SQL in kinds:
        return "La consulta está en pantalla." if spanish else "The query is on screen."
    if LOG in kinds:
        return "El registro está en pantalla." if spanish else "The log is on screen."
    if COMMAND in kinds:
        return (
            "El comando y su salida están en pantalla."
            if spanish
            else "The command and its output are on screen."
        )
    if CODE in kinds or STRUCTURED in kinds:
        return (
            "El código generado está en pantalla."
            if spanish
            else "The generated code is on screen."
        )
    return "Los detalles técnicos están en pantalla." if spanish else "The technical details are on screen."


def _classify_fence(info: str, body: str) -> str:
    info = (info or "").strip().lower()
    if info in {"sql", "mysql", "postgresql", "postgres", "sqlite"}:
        return SQL
    if info in {"diff", "patch"} or re.search(r"(?m)^(?:diff --git|@@\s)", body):
        return DIFF
    if info in {"bash", "sh", "shell", "zsh", "powershell", "ps1", "cmd", "bat", "console"}:
        return COMMAND
    if info in {"json", "yaml", "yml", "toml", "xml", "ini", "csv"}:
        return STRUCTURED
    if info in {"log", "logs", "text"} and re.search(r"(?im)\b(?:error|warn|info|debug|trace)\b", body):
        return LOG
    return CODE


def _strip_fenced_blocks(text: str, kinds: set[str]) -> str:
    def replace(match: re.Match) -> str:
        fence_line = match.group(0).splitlines()[0] if match.group(0) else ""
        info = re.sub(r"^[ \t]*[`~]+", "", fence_line).strip()
        body = match.group(0)
        kinds.add(_classify_fence(info, body))
        return "\n\n"

    return _FENCED_BLOCK.sub(replace, text)


def _is_structural_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if _SHELL_PROMPT.match(line) or _SHELL_COMMAND.match(line):
        return True
    if _SQL.match(line):
        return True
    if _LOG.match(line):
        return True
    if _CODE_LINE.match(line):
        return True
    if _JSON_LINE.match(stripped):
        return True
    if len(stripped) > 12 and _YAML_ENTRY.match(line) and not re.search(r"[.!?]\s*$", stripped):
        return True
    if stripped.count(";") >= 1 and re.search(r"[{}()=<>]", stripped):
        return True
    if re.search(r"(?:=>|->|::|</|/>|\bnull\b|\bundefined\b|\bTrue\b|\bFalse\b)", stripped):
        return True
    # Long unbroken machine tokens are usually ids, hashes or minified code.
    for token in stripped.split():
        if len(token) > 60 and not token.endswith((".", ",", ";", ":")):
            return True
    return False


def _clean_line(line: str, kinds: set[str], spanish: bool) -> str:
    stripped = line.strip()
    if not stripped:
        return ""
    # Strip Markdown presentation prefixes before the machine-content checks.
    # Otherwise a blockquote (" > prose") looks like a shell prompt and a
    # numbered list item that quotes SQL would be spoken as prose.
    stripped = _MARKDOWN_PREFIX.sub("", stripped).strip()
    if not stripped or re.fullmatch(r"[-*+>#~_`]+", stripped):
        return ""
    if _TABLE_SEPARATOR.match(stripped):
        kinds.add(STRUCTURED)
        return ""
    if _TABLE_ROW.match(stripped):
        kinds.add(STRUCTURED)
        return ""
    if _DIFF_MARKER.match(stripped):
        kinds.add(DIFF)
        return ""
    if _is_structural_line(stripped):
        if _SHELL_COMMAND.match(stripped) or _SHELL_PROMPT.match(stripped):
            kinds.add(COMMAND)
        if _SQL.match(stripped):
            kinds.add(SQL)
        if _LOG.match(stripped):
            kinds.add(LOG)
        if _CODE_LINE.match(stripped) or _JSON_LINE.match(stripped):
            kinds.add(CODE if not _JSON_LINE.match(stripped) else STRUCTURED)
        return ""
    if stripped.startswith("```") or stripped.startswith("~~~"):
        return ""
    return stripped


def _replace_machine_tokens(text: str, kinds: set[str], spanish: bool) -> str:
    text = _MARKDOWN_IMAGE.sub(
        "una imagen" if spanish else "an image", text
    )
    text = _MARKDOWN_LINK.sub(r"\1", text)
    if _URL.search(text):
        kinds.add(URL)
        text = _URL.sub("el enlace" if spanish else "the link", text)
    if _WINDOWS_PATH.search(text) or _UNIX_PATH.search(text):
        kinds.add(PATH)
        text = _WINDOWS_PATH.sub("el archivo" if spanish else "the file", text)
        text = _UNIX_PATH.sub("el archivo" if spanish else "the file", text)
    if _RELATIVE_CODE_PATH.search(text):
        kinds.add(PATH)
        text = _RELATIVE_CODE_PATH.sub("el archivo" if spanish else "the file", text)
    if _HASH.search(text):
        kinds.add(HASH)
        text = _HASH.sub("el identificador" if spanish else "the identifier", text)
    return text


def _truncate(text: str, max_chars: int) -> tuple[str, bool]:
    if len(text) <= max_chars:
        return text, False
    cut = text[:max_chars]
    boundary = -1
    for match in _SENTENCE_END.finditer(cut):
        boundary = match.end()
    if boundary < max_chars * 0.45:
        boundary = cut.rfind(" ")
    if boundary <= 0:
        boundary = max_chars
    return cut[:boundary].rstrip(), True


def filter_for_speech(
    text: str,
    *,
    max_chars: int = 1200,
    strict: bool = True,
) -> SpeechFilterResult:
    """Return only speakable prose for an assistant response.

    ``strict`` is the production default.  It performs a second pass over the
    cleaned text and removes any residual machine-looking line.  Tests and
    diagnostics should keep it enabled.
    """
    if not isinstance(text, str) or not text.strip():
        return SpeechFilterResult("", False, (), 0, 0)
    original = text
    spanish = _looks_spanish(text)
    kinds: set[str] = set()

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _HTML_BLOCK.sub("\n\n", text)
    text = _strip_fenced_blocks(text, kinds)
    text = _INLINE_TRIPLE.sub(" ", text)
    if _INLINE_CODE.search(text):
        kinds.add(INLINE_CODE)
        text = _INLINE_CODE.sub(lambda match: _replace_inline_code(match, spanish), text)
    if _HTML_TAG.search(text):
        kinds.add(CODE)
        text = _HTML_TAG.sub(" ", text)

    lines = []
    in_diff = False
    for raw_line in text.split("\n"):
        stripped = raw_line.strip()
        if stripped.startswith("diff --git") or stripped.startswith("@@ "):
            in_diff = True
            kinds.add(DIFF)
            continue
        if in_diff:
            if not stripped:
                in_diff = False
                lines.append("")
                continue
            if stripped.startswith(("+", "-", " ", "\\", "index ", "--- ", "+++ ")):
                continue
            in_diff = False
        lines.append(_clean_line(raw_line, kinds, spanish))
    text = "\n".join(lines)

    text = _replace_machine_tokens(text, kinds, spanish)
    text = _EMPHASIS.sub("", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    text = "\n".join(line.strip() for line in text.split("\n")).strip()
    text = re.sub(r" {2,}", " ", text)

    if strict and text:
        final_lines = []
        for line in text.split("\n"):
            if _is_structural_line(line):
                kinds.add(CODE)
                continue
            final_lines.append(line)
        text = "\n".join(final_lines).strip()

    if kinds & _ANNOUNCED_KINDS:
        notice = _notice(kinds, spanish)
        text = f"{notice} {text}".strip() if text else notice
    elif not text and kinds:
        # A response made only of inline code or machine tokens still needs a
        # brief, truthful spoken fallback.
        text = _notice(kinds | {CODE}, spanish)

    text = re.sub(r"\s+", " ", text).strip()
    text, truncated = _truncate(text, max_chars=max(120, int(max_chars)))
    if truncated:
        text = (
            f"{text} El resto está en pantalla."
            if spanish
            else f"{text} The rest is on screen."
        )

    had_code = bool(kinds)
    return SpeechFilterResult(
        text=text,
        had_code=had_code,
        kinds=tuple(sorted(kinds)),
        original_chars=len(original),
        spoken_chars=len(text),
        truncated=truncated,
    )


class IncrementalSpeechFilter:
    """Release complete, safe prose while an assistant response is streaming."""

    _BOUNDARY = re.compile(r"(?<=[.!?])\s+|\n+")
    _MAX_BUFFER_CHARS = 260

    def __init__(self) -> None:
        self._buffer = ""

    def feed(self, delta: str) -> list[str]:
        if delta:
            self._buffer += delta
        return self._drain(final=False)

    def finish(self) -> list[str]:
        return self._drain(final=True)

    def _drain(self, *, final: bool) -> list[str]:
        output = []
        while self._buffer:
            boundary = self._next_safe_boundary()
            if boundary is None and len(self._buffer) >= self._MAX_BUFFER_CHARS:
                boundary = self._buffer.rfind(" ", 0, self._MAX_BUFFER_CHARS + 1)
                if boundary > 0 and not self._is_markup_balanced(
                    self._buffer[:boundary]
                ):
                    boundary = None
            if boundary is not None:
                candidate = self._buffer[:boundary].strip()
                if not candidate or not self._is_markup_balanced(candidate):
                    break
                self._buffer = self._buffer[boundary:].lstrip()
                spoken = filter_for_speech(candidate).text
                if spoken:
                    output.append(spoken)
                continue
            if not final:
                break
            candidate = self._buffer.strip()
            self._buffer = ""
            if candidate and self._is_markup_balanced(candidate):
                spoken = filter_for_speech(candidate).text
                if spoken:
                    output.append(spoken)
        return output

    def _next_safe_boundary(self) -> Optional[int]:
        for match in self._BOUNDARY.finditer(self._buffer):
            candidate = self._buffer[:match.end()].strip()
            if self._is_markup_balanced(candidate):
                return match.end()
        return None

    @staticmethod
    def _is_markup_balanced(text: str) -> bool:
        fence_runs = re.findall(r"`{3,}|~{3,}", text)
        if len(fence_runs) % 2:
            return False
        inline_markers = re.sub(r"`{3,}|~{3,}", "", text)
        if "``" in inline_markers or "~~" in inline_markers:
            return False
        return inline_markers.count("`") % 2 == 0


def contains_code(text: str) -> bool:
    """Cheap detector used by tests and diagnostics."""
    if not isinstance(text, str) or not text:
        return False
    return bool(
        _FENCED_BLOCK.search(text)
        or _INLINE_CODE.search(text)
        or _SQL.search(text)
        or _SHELL_PROMPT.search(text)
        or _SHELL_COMMAND.search(text)
        or _LOG.search(text)
        or _DIFF_MARKER.search(text)
        or _CODE_LINE.search(text)
    )
