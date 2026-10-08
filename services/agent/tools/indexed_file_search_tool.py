import asyncio
import os
from typing import Any, Dict

from .base_tool import BaseTool, ToolResult


def _is_windows_platform() -> bool:
    return os.name == "nt"


def _run_windows_search_query(sql: str, limit: int) -> list[dict[str, Any]]:
    try:
        import pythoncom
        import win32com.client
    except ImportError as error:
        raise RuntimeError("The Windows Search COM provider requires the declared pywin32 dependency.") from error

    pythoncom.CoInitialize()
    connection = None
    recordset = None
    try:
        connection = win32com.client.Dispatch("ADODB.Connection")
        connection.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
        recordset, _records_affected = connection.Execute(sql)
        results = []
        while not recordset.EOF and len(results) < limit:
            fields = recordset.Fields
            path = fields.Item("System.ItemPathDisplay").Value
            if path:
                modified = fields.Item("System.DateModified").Value
                results.append({
                    "name": str(fields.Item("System.ItemName").Value or ""),
                    "path": str(path),
                    "kind": str(fields.Item("System.Kind").Value or ""),
                    "modified": modified.isoformat() if hasattr(modified, "isoformat") else str(modified or ""),
                })
            recordset.MoveNext()
        return results
    except Exception as error:
        raise RuntimeError(f"Windows Search index query failed: {error}") from error
    finally:
        try:
            if recordset is not None:
                recordset.Close()
        finally:
            try:
                if connection is not None:
                    connection.Close()
            finally:
                pythoncom.CoUninitialize()


def _search_windows_index(query: str, limit: int) -> list[dict[str, Any]]:
    if not _is_windows_platform():
        raise RuntimeError("Indexed file search is available only on Windows.")

    escaped_query = query.replace("'", "''")
    sql = (
        "SELECT TOP "
        f"{limit} System.ItemName, System.ItemPathDisplay, System.Kind, System.DateModified "
        "FROM SystemIndex "
        f"WHERE CONTAINS(*, '{escaped_query}') "
        "ORDER BY System.DateModified DESC"
    )
    return _run_windows_search_query(sql, limit)


class IndexedFileSearchTool(BaseTool):
    @property
    def name(self) -> str:
        return "indexed_file_search"

    @property
    def description(self) -> str:
        return (
            "Search files and documents quickly in the Windows Search index. "
            "Only searches locations Windows has indexed; does not scan the disk."
        )

    @property
    def permission_level(self) -> str:
        return "LOW_RISK"

    @property
    def requires_confirmation(self) -> bool:
        return False

    def validate_params(self, params: Dict[str, Any]) -> bool:
        query = params.get("query")
        return isinstance(query, str) and 0 < len(query.strip()) <= 256

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Words or a phrase to find in indexed file names and contents.",
                },
                "max_results": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "default": 20,
                },
            },
            "required": ["query"],
        }

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        if not self.validate_params(params):
            return ToolResult(
                success=False,
                output=None,
                error="query must contain between 1 and 256 characters.",
            )

        query = params["query"].strip()
        max_results = params.get("max_results", 20)
        if isinstance(max_results, bool) or not isinstance(max_results, int):
            return ToolResult(
                success=False,
                output=None,
                error="max_results must be an integer between 1 and 100.",
            )

        try:
            results = await asyncio.to_thread(
                _search_windows_index,
                query,
                min(max(max_results, 1), 100),
            )
            return ToolResult(success=True, output=results)
        except (OSError, RuntimeError) as error:
            return ToolResult(success=False, output=None, error=str(error))
