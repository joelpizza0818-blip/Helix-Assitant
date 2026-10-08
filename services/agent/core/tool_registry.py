import os
import importlib
from typing import List, Dict, Optional
import inspect
import re

try:
    from services.agent.tools.base_tool import BaseTool
except ImportError:
    pass # Will be handled by whoever provides BaseTool

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
    {"command", "shell", "terminal", "powershell", "cmd", "bash", "comando"},
    {"click", "press", "type", "keyboard", "mouse", "clic", "escribe", "teclado"},
    {"read", "open", "view", "inspect", "leer", "abrir", "ver", "revisar"},
    {"write", "create", "edit", "save", "update", "escribir", "crear", "editar"},
    {"delete", "remove", "borrar", "eliminar"},
    {"git", "github", "repository", "repo", "pull", "issue", "branch"},
    {"memory", "remember", "recall", "memoria", "recuerda"},
)


def _tool_terms(text: str) -> set[str]:
    terms = {
        term.casefold()
        for term in re.findall(r"[\w.-]+", text, flags=re.UNICODE)
        if len(term) > 1 and term.casefold() not in _TOOL_STOP_WORDS
    }
    for group in _TOOL_TERM_GROUPS:
        if terms.intersection(group):
            terms.update(group)
    return terms


class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, 'BaseTool'] = {}
        self._tool_sources: Dict[str, str] = {}

    def register_tool(self, tool: 'BaseTool', source: str = "native"):
        self._tools[tool.name] = tool
        self._tool_sources[tool.name] = source

    def get_tool(self, name: str) -> Optional['BaseTool']:
        return self._tools.get(name)

    def unregister_tool(self, name: str) -> None:
        self._tools.pop(name, None)
        self._tool_sources.pop(name, None)

    def get_all_tools(self) -> List['BaseTool']:
        return list(self._tools.values())

    def get_tools_by_source(self, source: str) -> List['BaseTool']:
        return [
            tool
            for name, tool in self._tools.items()
            if self._tool_sources.get(name) == source
        ]

    def get_tools_for_capability(self, capability: str) -> List['BaseTool']:
        return [t for t in self._tools.values() if capability.lower() in t.description.lower() or capability.lower() in t.name.lower()]

    def get_tool_schemas(
        self,
        query: Optional[str] = None,
        preferred_tool_names: Optional[List[str]] = None,
        max_external_tools: int = 8,
    ) -> List[dict]:
        schemas = []
        candidate_tools = list(self._tools.items())
        external_sources = {"mcp", "plugin", "hook"}
        if query is not None:
            query_terms = _tool_terms(query)
            preferred_names = set(preferred_tool_names or [])
            native_tools = [
                item
                for item in candidate_tools
                if self._tool_sources.get(item[0]) not in external_sources
            ]
            external_tools = [
                item
                for item in candidate_tools
                if self._tool_sources.get(item[0]) in external_sources
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
            external_tools = (
                relevant_tools[:max_external_tools]
                if relevant_tools
                else [
                    (name, tool)
                    for _score, name, tool in ranked_external[:max_external_tools]
                ]
            )
            candidate_tools = native_tools + external_tools

        for _name, tool in candidate_tools:
            schema = tool.get_schema()
            parameters = schema.get("parameters", schema)
            schemas.append({
                "name": schema.get("name", tool.name),
                "description": schema.get("description", tool.description),
                "parameters": parameters,
            })
        return schemas

    def auto_discover(self, tools_dir: str):
        if not os.path.exists(tools_dir):
            return

        package_name = (
            f"{__package__.rsplit('.', 1)[0]}.tools"
            if __package__ and "." in __package__
            else "tools"
        )
        
        for filename in os.listdir(tools_dir):
            if filename.endswith('.py') and filename != '__init__.py':
                module_name = filename[:-3]
                module = importlib.import_module(f"{package_name}.{module_name}")

                for _, obj in inspect.getmembers(module, inspect.isclass):
                    if obj.__module__ == module.__name__ and obj.__name__ != 'BaseTool':
                        try:
                            if hasattr(obj, 'execute') and hasattr(obj, 'name'):
                                tool_instance = obj()
                                self.register_tool(tool_instance, source="native")
                        except TypeError:
                            pass
