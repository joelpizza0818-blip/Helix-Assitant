import re
from collections.abc import Mapping, Sequence
from typing import Any


_TOOL_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from",
    "get", "give", "help", "i", "in", "is", "it", "me", "my", "of", "on",
    "please", "the", "this", "to", "with", "you", "your", "el", "la", "los",
    "las", "un", "una", "y", "de", "del", "en", "por", "para", "mi", "me",
    "que", "quiero", "necesito", "puedes", "haz", "hacer",
}
_TOOL_TERM_GROUPS = (
    {"search", "find", "locate", "lookup", "buscar", "busca", "encuentra"},
    {"file", "files", "folder", "directory", "archivo", "archivos", "carpeta"},
    {"screen", "screenshot", "desktop", "pantalla", "escritorio", "captura"},
    {"browser", "web", "website", "internet", "navegador", "sitio", "pagina"},
    {"dom", "page", "tab", "form", "email", "correo", "pestaña", "formulario"},
    {"command", "shell", "terminal", "powershell", "cmd", "bash", "comando"},
    {"click", "press", "type", "keyboard", "mouse", "clic", "escribe", "teclado"},
    {"read", "open", "view", "inspect", "leer", "abrir", "ver", "revisar"},
    {"write", "create", "edit", "save", "update", "escribir", "crear", "editar"},
    {"delete", "remove", "borrar", "eliminar"},
    {"git", "github", "repository", "repo", "pull", "issue", "branch"},
    {"memory", "remember", "recall", "memoria", "recuerda"},
)
_EXTERNAL_TOOL_SOURCES = {"mcp", "plugin", "hook"}


def _tool_terms(text: str) -> set[str]:
    """Normalize user and tool descriptions into synonym-expanded search terms."""
    terms = {
        term.casefold()
        for term in re.findall(r"[\w.-]+", text, flags=re.UNICODE)
        if len(term) > 1 and term.casefold() not in _TOOL_STOP_WORDS
    }
    for group in _TOOL_TERM_GROUPS:
        if terms.intersection(group):
            terms.update(group)
    return terms


def select_tool_candidates(
    candidate_tools: Sequence[tuple[str, Any]],
    tool_sources: Mapping[str, str],
    query: str | None,
    preferred_tool_names: Sequence[str] | None,
    max_external_tools: int,
) -> list[tuple[str, Any]]:
    """Keep all native tools and rank external tools against the current request."""
    if query is None:
        return list(candidate_tools)

    query_terms = _tool_terms(query)
    preferred_names = set(preferred_tool_names or [])
    native_tools = [
        item
        for item in candidate_tools
        if tool_sources.get(item[0]) not in _EXTERNAL_TOOL_SOURCES
    ]
    external_tools = [
        item
        for item in candidate_tools
        if tool_sources.get(item[0]) in _EXTERNAL_TOOL_SOURCES
    ]
    ranked_external = []
    for name, tool in external_tools:
        tool_terms = _tool_terms(f"{name} {tool.description}")
        score = len(query_terms & tool_terms)
        if name in preferred_names:
            score += len(query_terms) + 1
        ranked_external.append((score, name, tool))
    ranked_external.sort(key=lambda item: (-item[0], item[1]))
    best_score = ranked_external[0][0] if ranked_external else 0
    relevance_floor = max(1, int(best_score * 0.7 + 0.99))
    relevant_tools = [
        (name, tool)
        for score, name, tool in ranked_external
        if score >= relevance_floor
    ]
    selected_external = (
        relevant_tools[:max_external_tools]
        if relevant_tools
        else [
            (name, tool)
            for _score, name, tool in ranked_external[:max_external_tools]
        ]
    )
    return native_tools + selected_external


def normalize_tool_schema(tool: Any) -> dict[str, Any]:
    """Expose the model-facing schema shape and HELIX capability metadata."""
    schema = tool.get_schema()
    parameters = schema.get("parameters", schema)
    normalized_schema = {
        "name": schema.get("name", tool.name),
        "description": schema.get("description", tool.description),
        "parameters": parameters,
    }
    required_capability = getattr(tool, "required_capability", None)
    if required_capability:
        normalized_schema["x-helix-required-capability"] = required_capability
    return normalized_schema
