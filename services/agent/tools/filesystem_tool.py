import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional
from .base_tool import BaseTool, ToolResult

class FilesystemTool(BaseTool):
    PROTECTED_PATHS = [
        Path(os.environ.get("WINDIR", "C:\\Windows")),
        Path(os.environ.get("WINDIR", "C:\\Windows")) / "System32"
    ]

    @property
    def name(self) -> str:
        return "filesystem_tool"

    @property
    def description(self) -> str:
        return "Tool for performing filesystem operations."

    @property
    def permission_level(self) -> str:
        return "MODERATE"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def _is_path_protected(self, path: Path) -> bool:
        try:
            resolved = path.resolve()
            for protected in self.PROTECTED_PATHS:
                if resolved == protected or protected in resolved.parents:
                    return True
        except Exception:
            return True
        return False

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return "operation" in params

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "operation": {"type": "string"},
                "path": {"type": "string"}
            },
            "required": ["operation"]
        }

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        operation = params.get("operation")
        path_str = params.get("path")
        path = Path(path_str) if path_str else None

        if path and self._is_path_protected(path):
            return ToolResult(success=False, output=None, error="Access to protected path denied without CRITICAL permission.")

        try:
            if operation == "read_file":
                with open(path, 'r', encoding='utf-8') as f:
                    return ToolResult(success=True, output=f.read())
            elif operation == "write_file":
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(params.get("content", ""))
                return ToolResult(success=True, output=True)
            elif operation == "append_file":
                with open(path, 'a', encoding='utf-8') as f:
                    f.write(params.get("content", ""))
                return ToolResult(success=True, output=True)
            elif operation == "delete_file":
                os.remove(path)
                return ToolResult(success=True, output=True)
            elif operation == "create_directory":
                path.mkdir(parents=True, exist_ok=True)
                return ToolResult(success=True, output=True)
            elif operation == "delete_directory":
                if params.get("recursive", False):
                    shutil.rmtree(path)
                else:
                    path.rmdir()
                return ToolResult(success=True, output=True)
            elif operation == "list_directory":
                items = [{"name": p.name, "is_dir": p.is_dir()} for p in path.iterdir()]
                return ToolResult(success=True, output=items)
            elif operation == "move_file":
                shutil.move(str(path), params.get("dest"))
                return ToolResult(success=True, output=True)
            elif operation == "copy_file":
                shutil.copy2(str(path), params.get("dest"))
                return ToolResult(success=True, output=True)
            elif operation == "file_exists":
                return ToolResult(success=True, output=path.exists())
            elif operation == "get_file_info":
                stat = path.stat()
                return ToolResult(success=True, output={"size": stat.st_size, "is_dir": path.is_dir()})
            elif operation == "search_files":
                directory, pattern = path, params.get("pattern", "*")
                recursive = params.get("recursive", True)
                files = list(directory.rglob(pattern)) if recursive else list(directory.glob(pattern))
                return ToolResult(success=True, output=[str(f) for f in files])
            return ToolResult(success=False, output=None, error=f"Unknown operation: {operation}")
        except Exception as e:
            return ToolResult(success=False, output=None, error=str(e))
