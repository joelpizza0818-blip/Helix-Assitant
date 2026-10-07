from typing import List, Optional, Any, Dict
from dataclasses import dataclass, field

# JSON-RPC 2.0 message types
@dataclass
class MCPRequest:
    method: str
    params: Optional[Dict[str, Any]] = None
    id: Optional[int] = None
    jsonrpc: str = '2.0'

    def to_dict(self) -> dict:
        d = {"jsonrpc": self.jsonrpc, "method": self.method}
        if self.id is not None:
            d["id"] = self.id
        if self.params is not None:
            d["params"] = self.params
        return d

@dataclass
class MCPResponse:
    id: Optional[int] = None
    result: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None
    jsonrpc: str = '2.0'

    def to_dict(self) -> dict:
        d = {"jsonrpc": self.jsonrpc, "id": self.id}
        if self.error is not None:
            d["error"] = self.error
        else:
            d["result"] = self.result
        return d

# MCP-specific types
@dataclass
class MCPToolDefinition:
    name: str
    description: str
    input_schema: dict

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema
        }

@dataclass
class MCPResource:
    uri: str
    name: str
    description: str
    mime_type: str

    def to_dict(self) -> dict:
        return {
            "uri": self.uri,
            "name": self.name,
            "description": self.description,
            "mimeType": self.mime_type
        }

@dataclass
class MCPPrompt:
    name: str
    description: str
    arguments: List[dict]

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "arguments": self.arguments
        }

# MCP Methods
MCP_INITIALIZE = 'initialize'
MCP_LIST_TOOLS = 'tools/list'
MCP_CALL_TOOL = 'tools/call'
MCP_LIST_RESOURCES = 'resources/list'
MCP_READ_RESOURCE = 'resources/read'
MCP_LIST_PROMPTS = 'prompts/list'
MCP_GET_PROMPT = 'prompts/get'
