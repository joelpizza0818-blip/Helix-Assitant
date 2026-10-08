import json
import asyncio
import logging
import os
import shlex
from typing import List, Dict, Any, Optional
from .protocol import (
    MCPRequest, MCPResponse, MCPToolDefinition, MCPResource,
    MCP_INITIALIZE, MCP_LIST_TOOLS, MCP_CALL_TOOL,
    MCP_LIST_RESOURCES, MCP_READ_RESOURCE
)

logger = logging.getLogger(__name__)

class MCPClient:
    def __init__(self, server_command: str = None, server_url: str = None):
        self.server_command = server_command
        self.server_url = server_url
        self.process = None
        self._req_id = 0
        self._pending_requests: Dict[int, asyncio.Future] = {}
        self._reader_task = None
        self._stderr_task = None

    async def connect(self):
        if self.server_command:
            if os.name == "nt":
                self.process = await asyncio.create_subprocess_shell(
                    self.server_command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            else:
                args = shlex.split(self.server_command)
                self.process = await asyncio.create_subprocess_exec(
                    *args,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            self._reader_task = asyncio.create_task(self._read_responses())
            self._stderr_task = asyncio.create_task(self._drain_stderr())
            logger.info("Connected to MCP server process.")
        elif self.server_url:
            raise NotImplementedError("HTTP/URL transport not yet implemented")
        else:
            raise ValueError("Must provide either server_command or server_url")

    async def disconnect(self):
        if self.process:
            if self.process.returncode is None:
                self.process.terminate()
                await self.process.wait()
        for task in (self._reader_task, self._stderr_task):
            if task:
                task.cancel()
        await asyncio.gather(
            *(task for task in (self._reader_task, self._stderr_task) if task),
            return_exceptions=True,
        )
        logger.info("Disconnected from MCP server")

    async def initialize(self) -> dict:
        return await self._send_request(MCP_INITIALIZE, {
            "protocolVersion": "2.0",
            "clientInfo": {"name": "helix-mcp-client", "version": "1.0.0"}
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
            self.process.stdin.write(req_str.encode('utf-8'))
            await self.process.stdin.drain()
            
        try:
            result = await asyncio.wait_for(future, timeout=60)
        except asyncio.TimeoutError as error:
            self._pending_requests.pop(req_id, None)
            raise TimeoutError(f"MCP request {method} timed out") from error
        if result.error:
            raise Exception(f"MCP Error: {result.error}")
        return result.result

    async def _drain_stderr(self):
        if not self.process or not self.process.stderr:
            return
        while await self.process.stderr.readline():
            pass

    async def _read_responses(self):
        try:
            while True:
                if not self.process or not self.process.stdout:
                    break
                line = await self.process.stdout.readline()
                if not line:
                    break
                
                try:
                    data = json.loads(line.decode('utf-8'))
                    resp = MCPResponse(
                        id=data.get('id'),
                        result=data.get('result'),
                        error=data.get('error')
                    )
                    
                    if resp.id in self._pending_requests:
                        self._pending_requests[resp.id].set_result(resp)
                        del self._pending_requests[resp.id]
                except json.JSONDecodeError:
                    logger.error(f"Failed to parse MCP response: {line}")
        except asyncio.CancelledError:
            pass
        finally:
            for future in self._pending_requests.values():
                if not future.done():
                    future.set_exception(ConnectionError("MCP server closed its output stream"))
            self._pending_requests.clear()

class MCPClientManager:
    """Manages multiple MCP client connections."""
    def __init__(self, event_bus):
        self.event_bus = event_bus
        self.clients: Dict[str, MCPClient] = {}
        self.tools_cache: Dict[str, List[MCPToolDefinition]] = {}

    async def add_server(self, name: str, command: str = None, url: str = None) -> MCPClient:
        client = MCPClient(server_command=command, server_url=url)
        await client.connect()
        await client.initialize()
        
        self.clients[name] = client
        self.tools_cache[name] = await client.list_tools()
        
        if self.event_bus:
            await self.event_bus.publish('mcp.server_added', {'name': name})
            
        return client

    async def remove_server(self, name: str):
        if name in self.clients:
            await self.clients[name].disconnect()
            del self.clients[name]
            if name in self.tools_cache:
                del self.tools_cache[name]
                
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
