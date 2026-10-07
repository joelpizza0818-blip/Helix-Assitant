import sys
import json
import asyncio
import logging
from typing import List, Dict, Any, Optional
from .protocol import (
    MCPRequest, MCPResponse, MCPToolDefinition, 
    MCP_INITIALIZE, MCP_LIST_TOOLS, MCP_CALL_TOOL,
    MCP_LIST_RESOURCES, MCP_READ_RESOURCE
)

logger = logging.getLogger(__name__)

class MCPServer:
    def __init__(self, tool_registry, host='127.0.0.1', port=3000):
        self.tool_registry = tool_registry
        self.host = host
        self.port = port
        self.running = False

    async def start(self):
        self.running = True
        logger.info("Starting MCP server (stdio transport)")
        
        loop = asyncio.get_event_loop()
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)

        while self.running:
            try:
                line = await reader.readline()
                if not line:
                    break
                response = await self._handle_message(line.decode('utf-8'))
                if response:
                    sys.stdout.write(response + '\n')
                    sys.stdout.flush()
            except Exception as e:
                logger.error(f"Error reading message: {e}")

    async def stop(self):
        self.running = False
        logger.info("MCP server stopped")

    async def handle_initialize(self, params: dict) -> dict:
        return {
            "protocolVersion": "2.0",
            "serverInfo": {
                "name": "helix-mcp-server",
                "version": "1.0.0"
            },
            "capabilities": {
                "tools": True,
                "resources": True
            }
        }

    async def handle_list_tools(self) -> List[dict]:
        if not hasattr(self.tool_registry, 'get_all_tools'):
            return []
        
        tools = self.tool_registry.get_all_tools()
        result = []
        for tool in tools:
            schema = tool.get_schema()
            result.append({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": schema.get("parameters", {})
            })
        return result

    async def handle_call_tool(self, name: str, arguments: dict) -> dict:
        if not hasattr(self.tool_registry, 'get_tool'):
            raise ValueError(f"Tool registry missing get_tool")
            
        tool = self.tool_registry.get_tool(name)
        if not tool:
            raise ValueError(f"Tool {name} not found")
        
        result = await tool.execute(arguments)
        return {
            "success": result.success,
            "output": result.output,
            "error": result.error
        }

    async def handle_list_resources(self) -> List[dict]:
        return []

    async def handle_read_resource(self, uri: str) -> dict:
        raise ValueError(f"Resource {uri} not found")

    async def _handle_message(self, message: str) -> str:
        try:
            data = json.loads(message)
            if 'method' not in data:
                return ""
            
            method = data.get('method')
            params = data.get('params', {})
            req_id = data.get('id')
            
            result = None
            error = None
            
            try:
                if method == MCP_INITIALIZE:
                    result = await self.handle_initialize(params)
                elif method == MCP_LIST_TOOLS:
                    result = {"tools": await self.handle_list_tools()}
                elif method == MCP_CALL_TOOL:
                    result = await self.handle_call_tool(params.get('name'), params.get('arguments', {}))
                elif method == MCP_LIST_RESOURCES:
                    result = {"resources": await self.handle_list_resources()}
                elif method == MCP_READ_RESOURCE:
                    result = await self.handle_read_resource(params.get('uri'))
                else:
                    error = {"code": -32601, "message": f"Method {method} not found"}
            except Exception as e:
                error = {"code": -32000, "message": str(e)}
                
            response = MCPResponse(id=req_id, result=result, error=error)
            return json.dumps(response.to_dict())
            
        except json.JSONDecodeError:
            err_resp = MCPResponse(id=None, error={"code": -32700, "message": "Parse error"})
            return json.dumps(err_resp.to_dict())
