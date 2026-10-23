"""Read-only MCP stdio server for a user-selected Helix Obsidian vault.

Run with ``python -m services.agent.mcp.helix_vault_server --root <vault>``.
The server never writes to the vault and rejects paths outside the selected
root.  It is intentionally standalone so it can be used from HELIX or any
other MCP client for a safe access test.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


MAX_RESULTS = 100
MAX_NOTE_CHARS = 120_000


class HelixVaultServer:
    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        if not self.root.is_dir():
            raise ValueError(f"Vault root does not exist: {self.root}")

    def _safe_path(self, relative: str) -> Path:
        candidate = (self.root / relative).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("Path is outside the selected Helix Vault") from exc
        return candidate

    def _notes(self) -> list[Path]:
        return sorted(
            path for path in self.root.rglob("*.md")
            if path.is_file() and ".obsidian" not in path.parts
        )

    @staticmethod
    def _relative(path: Path, root: Path) -> str:
        """Expose portable MCP paths regardless of the host OS."""
        return path.relative_to(root).as_posix()

    def tools(self) -> list[dict]:
        return [
            {
                "name": "list_notes",
                "description": "List Markdown notes in the selected Helix Vault.",
                "inputSchema": {"type": "object", "properties": {}},
            },
            {
                "name": "search_notes",
                "description": "Search note names and contents in the selected Helix Vault.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"query": {"type": "string", "minLength": 1}},
                    "required": ["query"],
                },
            },
            {
                "name": "read_note",
                "description": "Read one Markdown note by path from the selected Helix Vault.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "minLength": 1}},
                    "required": ["path"],
                },
            },
        ]

    def call(self, name: str, arguments: dict) -> dict:
        if name == "list_notes":
            return {"notes": [self._relative(path, self.root) for path in self._notes()]}
        if name == "search_notes":
            query = str(arguments.get("query", "")).strip().casefold()
            if not query:
                raise ValueError("query is required")
            matches = []
            for path in self._notes():
                text = path.read_text(encoding="utf-8", errors="replace")
                if query in path.name.casefold() or query in text.casefold():
                    matches.append({"path": self._relative(path, self.root), "preview": text[:500]})
                if len(matches) >= MAX_RESULTS:
                    break
            return {"matches": matches}
        if name == "read_note":
            path = self._safe_path(str(arguments.get("path", "")))
            if path.suffix.casefold() != ".md" or not path.is_file():
                raise ValueError("Only existing Markdown notes can be read")
            return {
                "path": self._relative(path, self.root),
                "content": path.read_text(encoding="utf-8", errors="replace")[:MAX_NOTE_CHARS],
            }
        raise ValueError(f"Unknown tool: {name}")

    def handle(self, request: dict) -> dict | None:
        method = request.get("method")
        request_id = request.get("id")
        if method == "initialize":
            result = {
                "protocolVersion": "2.0",
                "serverInfo": {"name": "helix-vault-readonly", "version": "0.2.12"},
                "capabilities": {"tools": True},
            }
        elif method == "tools/list":
            result = {"tools": self.tools()}
        elif method == "tools/call":
            params = request.get("params", {})
            result = self.call(params.get("name", ""), params.get("arguments", {}))
        else:
            if request_id is None:
                return None
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"Method {method} not found"}}
        return {"jsonrpc": "2.0", "id": request_id, "result": result} if request_id is not None else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only Helix Vault MCP server")
    parser.add_argument("--root", required=True, help="Absolute path to the selected Helix Vault")
    args = parser.parse_args()
    server = HelixVaultServer(Path(args.root))
    for line in sys.stdin:
        try:
            response = server.handle(json.loads(line))
            if response is not None:
                # Keep stdio JSON ASCII-safe on Windows code pages. The MCP
                # client decodes stdout as UTF-8; escaped Unicode preserves
                # note content without depending on the host console encoding.
                sys.stdout.write(json.dumps(response, ensure_ascii=True) + "\n")
                sys.stdout.flush()
        except Exception as exc:
            request_id = None
            try:
                request_id = json.loads(line).get("id")
            except Exception:
                pass
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": str(exc)}}) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
