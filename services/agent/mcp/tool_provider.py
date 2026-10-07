import logging
from typing import Dict, Any
from services.agent.tools.base_tool import BaseTool, ToolResult
from .client import MCPClientManager
from .protocol import MCPToolDefinition

logger = logging.getLogger(__name__)

class MCPToolWrapper(BaseTool):
    def __init__(self, server_name: str, client_manager: MCPClientManager, mcp_tool: MCPToolDefinition):
        self.server_name = server_name
        self.client_manager = client_manager
        self.mcp_tool = mcp_tool

    @property
    def name(self) -> str:
        return f"{self.server_name}_{self.mcp_tool.name}"

    @property
    def description(self) -> str:
        return self.mcp_tool.description

    @property
    def permission_level(self) -> str:
        return "user"  # Default permission for external tools

    @property
    def requires_confirmation(self) -> bool:
        return True    # Safe behavior for external tools

    async def execute(self, params: Dict[str, Any]) -> ToolResult:
        try:
            result = await self.client_manager.call_tool(self.server_name, self.mcp_tool.name, params)
            
            # If the response follows standard MCP tool result format (content array, isError)
            if isinstance(result, dict):
                is_error = result.get('isError', False)
                if 'content' in result:
                    texts = []
                    for c in result.get('content', []):
                        if c.get('type') == 'text':
                            texts.append(c.get('text', ''))
                    
                    output = "\n".join(texts)
                    return ToolResult(success=not is_error, output=output, error=output if is_error else None)
            
            return ToolResult(success=True, output=result)
        except Exception as e:
            logger.error(f"Error executing MCP tool {self.name}: {e}")
            return ToolResult(success=False, output=None, error=str(e))

    def validate_params(self, params: Dict[str, Any]) -> bool:
        return True

    def get_schema(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.mcp_tool.input_schema,
            "permission_level": self.permission_level,
            "requires_confirmation": self.requires_confirmation
        }

class MCPToolBridge:
    """Wraps MCP tools as Helix BaseTool instances."""
    def __init__(self, mcp_client_manager: MCPClientManager, tool_registry):
        self.mcp_client_manager = mcp_client_manager
        self.tool_registry = tool_registry

    async def sync_tools(self):
        for server_name, tools in self.mcp_client_manager.tools_cache.items():
            for mcp_tool in tools:
                wrapper = self.create_tool_wrapper(server_name, mcp_tool)
                if hasattr(self.tool_registry, 'register_tool'):
                    self.tool_registry.register_tool(wrapper)
                else:
                    logger.warning("Tool registry missing register_tool method")

    def create_tool_wrapper(self, server_name: str, mcp_tool: MCPToolDefinition) -> BaseTool:
        return MCPToolWrapper(server_name, self.mcp_client_manager, mcp_tool)
