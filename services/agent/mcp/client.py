import json
import asyncio
import ctypes
import logging
import os
import shlex
import re
import shutil
import subprocess
from collections import deque
from typing import List, Dict, Any, Optional
from .protocol import (
    MCPRequest, MCPResponse, MCPToolDefinition, MCPResource,
    MCP_INITIALIZE, MCP_LIST_TOOLS, MCP_CALL_TOOL,
    MCP_LIST_RESOURCES, MCP_READ_RESOURCE
)

logger = logging.getLogger(__name__)


_SECRET_VALUE = re.compile(
    r"(?i)\b(?:bearer\s+|sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,}|"
    r"gh[pousr]_[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\S*"
)
_NAMED_SECRET = re.compile(
    r"(?i)(\b(?:api[_-]?key|authorization|password|secret|token|credential)\b"
    r"\s*[:=]\s*)(?:bearer\s+)?([^\s,;]+)"
)


def safe_mcp_diagnostic(value: str, limit: int = 240) -> str:
    text = " ".join(value.split())
    text = _NAMED_SECRET.sub(r"\1[REDACTED]", text)
    text = _SECRET_VALUE.sub("[REDACTED]", text)
    text = re.sub(r"https?://\S+", "[URL REDACTED]", text)
    return text[:limit]


def _windows_short_path(value: str) -> str:
    """Return an 8.3 path when Windows exposes one, otherwise keep the path."""
    if os.name != "nt":
        return value
    try:
        get_short_path = ctypes.windll.kernel32.GetShortPathNameW
        get_short_path.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32]
        get_short_path.restype = ctypes.c_uint32
        size = 512
        while size <= 32768:
            buffer = ctypes.create_unicode_buffer(size)
            length = get_short_path(value, buffer, size)
            if length == 0:
                return value
            if length < size:
                return buffer.value
            size *= 2
    except (AttributeError, OSError):
        return value
    return value


class MCPClient:
    def __init__(self, server_command: str = None, server_url: str = None):
        if server_url is not None:
            raise ValueError(
                "MCP URL transport is not supported; provide a local stdio server_command."
            )
        self.server_command = server_command
        self.process = None
        self._req_id = 0
        self._pending_requests: Dict[int, asyncio.Future] = {}
        self._reader_task = None
        self._stderr_task = None
        self._stderr_tail = deque(maxlen=8)
        self._protocol_error = None
        self.request_timeout = 60
        self._disconnecting = False

    async def connect(self):
        if self.server_command:
            self._stderr_tail.clear()
            self._protocol_error = None
            self._disconnecting = False
            args = shlex.split(self.server_command)
            if not args:
                raise ValueError("MCP server command must not be empty.")
            try:
                command_args = args
                if os.name == "nt":
                    executable = shutil.which(args[0])
                    if executable and executable.lower().endswith((".cmd", ".bat")):
                        command_args = [
                            os.environ.get("COMSPEC", "cmd.exe"),
                            "/d",
                            "/c",
                            _windows_short_path(executable),
                            *args[1:],
                        ]
                self.process = await asyncio.create_subprocess_exec(
                    *command_args,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            except (OSError, ValueError) as error:
                raise RuntimeError(
                    "Could not start local stdio server "
                    f"({type(error).__name__}); verify the executable is installed "
                    "and available on PATH."
                ) from None
            self._reader_task = asyncio.create_task(self._read_responses())
            self._stderr_task = asyncio.create_task(self._drain_stderr())
            logger.info("Started local MCP stdio server process.")
        else:
            raise ValueError(
                "MCP currently supports local stdio servers only; provide server_command."
            )

    async def disconnect(self):
        process = self.process
        self._disconnecting = True
        if process:
            if process.stdin and not process.stdin.is_closing():
                process.stdin.close()
            if os.name == "nt":
                try:
                    tree_kill = await asyncio.create_subprocess_exec(
                        shutil.which("taskkill") or "taskkill",
                        "/PID",
                        str(process.pid),
                        "/T",
                        "/F",
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await asyncio.wait_for(tree_kill.wait(), timeout=2)
                except (OSError, asyncio.TimeoutError):
                    pass
            if process.returncode is None:
                try:
                    process.terminate()
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(process.wait(), timeout=2)
                except asyncio.TimeoutError:
                    try:
                        process.kill()
                    except ProcessLookupError:
                        pass
                    await process.wait()
        current_task = asyncio.current_task()
        for task in (self._reader_task, self._stderr_task):
            if task and task is not current_task:
                task.cancel()
        await asyncio.gather(
            *(
                task for task in (self._reader_task, self._stderr_task)
                if task and task is not current_task
            ),
            return_exceptions=True,
        )
        self._fail_pending(ConnectionError(self._closed_error()))
        self.process = None
        self._reader_task = None
        self._stderr_task = None
        logger.info("Disconnected from MCP server")

    async def initialize(self) -> dict:
        return await self._send_request(MCP_INITIALIZE, {
            "protocolVersion": "2.0",
            "clientInfo": {"name": "helix-mcp-client", "version": "1.0.0"},
            "capabilities": {},
        })

    async def list_tools(self) -> List[MCPToolDefinition]:
        response = await self._send_request(MCP_LIST_TOOLS)
        tools = []
        for t in response.get("tools", []):
            tools.append(MCPToolDefinition(
                name=t.get("name", ""),
                description=t.get("description", ""),
                input_schema=t.get("inputSchema", {})
            ))
        return tools

    async def call_tool(self, name: str, arguments: dict) -> Any:
        return await self._send_request(MCP_CALL_TOOL, {
            "name": name,
            "arguments": arguments
        })

    async def list_resources(self) -> List[MCPResource]:
        response = await self._send_request(MCP_LIST_RESOURCES)
        resources = []
        for r in response.get("resources", []):
            resources.append(MCPResource(
                uri=r.get("uri", ""),
                name=r.get("name", ""),
                description=r.get("description", ""),
                mime_type=r.get("mimeType", "")
            ))
        return resources

    async def read_resource(self, uri: str) -> Any:
        return await self._send_request(MCP_READ_RESOURCE, {"uri": uri})

    async def _send_request(self, method: str, params: dict = None) -> Any:
        self._req_id += 1
        req_id = self._req_id

        req = MCPRequest(method=method, params=params, id=req_id)
        future = asyncio.get_event_loop().create_future()
        self._pending_requests[req_id] = future

        req_str = json.dumps(req.to_dict()) + "\n"
        if self.process and self.process.stdin:
            try:
                self.process.stdin.write(req_str.encode('utf-8'))
                await self.process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError, OSError) as error:
                self._pending_requests.pop(req_id, None)
                diagnostic = self._closed_error()
                await self.disconnect()
                raise ConnectionError(diagnostic) from error
        else:
            self._pending_requests.pop(req_id, None)
            raise ConnectionError("MCP stdio server is not connected.")

        try:
            result = await asyncio.wait_for(future, timeout=self.request_timeout)
        except asyncio.TimeoutError as error:
            self._pending_requests.pop(req_id, None)
            diagnostic = self._closed_error()
            await self.disconnect()
            raise TimeoutError(
                f"MCP request {method} timed out; {diagnostic}"
            ) from error
        if result.error:
            raise RuntimeError(
                f"MCP server rejected {method}: {safe_mcp_diagnostic(str(result.error))}"
            )
        return result.result

    async def _drain_stderr(self):
        if not self.process or not self.process.stderr:
            return
        while True:
            line = await self.process.stderr.readline()
            if not line:
                break
            safe_line = safe_mcp_diagnostic(line.decode("utf-8", errors="replace"))
            if safe_line:
                self._stderr_tail.append(safe_line)

    def _closed_error(self) -> str:
        detail = "; ".join(self._stderr_tail)
        if self._protocol_error:
            detail = self._protocol_error if not detail else f"{self._protocol_error}; {detail}"
        if detail:
            return f"MCP stdio server closed or failed: {detail}"
        code = self.process.returncode if self.process else None
        return (
            f"MCP stdio server closed its output stream (exit code {code})."
            if code is not None
            else "MCP stdio server closed its output stream."
        )

    def _fail_pending(self, error: Exception) -> None:
        for future in self._pending_requests.values():
            if not future.done():
                future.set_exception(error)
        self._pending_requests.clear()

    async def _read_responses(self):
        try:
            while True:
                if not self.process or not self.process.stdout:
                    break

                stdout = self.process.stdout

                # Poll so an exited child is noticed even if the stream reader
                # does not surface EOF on this platform.
                try:
                    line = await asyncio.wait_for(stdout.readline(), timeout=0.1)
                except asyncio.TimeoutError:
                    # Timed out — check whether the child already exited or
                    # signalled EOF via at_eof().
                    proc = self.process
                    if proc and proc.returncode is not None:
                        break
                    if stdout.at_eof():
                        break
                    # Child still running and no EOF — keep waiting.
                    continue

                if not line:
                    # readline() returned b'' — true EOF.
                    break

                try:
                    data = json.loads(line.decode('utf-8'))
                    if not isinstance(data, dict):
                        raise ValueError("MCP response must be a JSON object")
                    resp = MCPResponse(
                        id=data.get('id'),
                        result=data.get('result'),
                        error=data.get('error')
                    )

                    if resp.id in self._pending_requests:
                        self._pending_requests[resp.id].set_result(resp)
                        del self._pending_requests[resp.id]
                except json.JSONDecodeError:
                    self._protocol_error = "MCP stdio server wrote invalid JSON to stdout."
                    logger.error("MCP stdio server wrote invalid JSON to stdout.")
                    break
                except (TypeError, ValueError):
                    self._protocol_error = "MCP stdio server sent an invalid JSON-RPC response."
                    logger.error("%s", self._protocol_error)
                    break
        except asyncio.CancelledError:
            pass
        finally:
            process = self.process
            unexpectedly_alive = False
            if (
                process is not None
                and process.returncode is None
                and not self._disconnecting
            ):
                try:
                    await asyncio.wait_for(process.wait(), timeout=0.2)
                except asyncio.TimeoutError:
                    self._protocol_error = self._protocol_error or (
                        "MCP stdio server closed stdout before its process exited."
                    )
                    unexpectedly_alive = True
            if unexpectedly_alive:
                # Fail requests now; a child that closed stdout but stayed
                # alive must not keep the request waiting for its timeout.
                await asyncio.sleep(0)
                self._fail_pending(ConnectionError(self._closed_error()))
                await self.disconnect()
            elif self._stderr_task and self._stderr_task is not asyncio.current_task():
                try:
                    await asyncio.wait_for(
                        asyncio.shield(self._stderr_task),
                        timeout=0.2,
                    )
                except asyncio.TimeoutError:
                    self._protocol_error = self._protocol_error or (
                        "MCP stdio server did not close its diagnostic stream."
                    )
                    await asyncio.sleep(0)
                    self._fail_pending(ConnectionError(self._closed_error()))
                    if process is not None and not self._disconnecting:
                        await self.disconnect()
            # The request futures may already have been failed above when a
            # stream stayed open; otherwise this releases them on EOF.
            self._fail_pending(ConnectionError(self._closed_error()))


class MCPClientManager:
    """Manages multiple MCP client connections."""
    def __init__(self, event_bus):
        self.event_bus = event_bus
        self.clients: Dict[str, MCPClient] = {}
        self.tools_cache: Dict[str, List[MCPToolDefinition]] = {}

    async def add_server(self, name: str, command: str = None, url: str = None) -> MCPClient:
        client = MCPClient(server_command=command, server_url=url)
        try:
            await client.connect()
            await client.initialize()
            tools = await client.list_tools()
        except BaseException:
            try:
                await client.disconnect()
            except Exception:
                logger.exception("Failed to clean up MCP stdio process after startup failure")
            raise

        self.clients[name] = client
        self.tools_cache[name] = tools

        if self.event_bus:
            await self.event_bus.publish('mcp.server_added', {'name': name})

        return client

    async def remove_server(self, name: str):
        if name in self.clients:
            client = self.clients.pop(name)
            self.tools_cache.pop(name, None)
            await client.disconnect()

            if self.event_bus:
                await self.event_bus.publish('mcp.server_removed', {'name': name})

    def get_all_tools(self) -> List[MCPToolDefinition]:
        all_tools = []
        for tools in self.tools_cache.values():
            all_tools.extend(tools)
        return all_tools

    async def call_tool(self, server_name: str, tool_name: str, arguments: dict) -> Any:
        if server_name not in self.clients:
            raise ValueError(f"Server {server_name} not found")

        return await self.clients[server_name].call_tool(tool_name, arguments)
