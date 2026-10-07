import pytest
from services.agent.mcp.protocol import MCPRequest, MCPResponse, MCPToolDefinition
from services.agent.mcp.tool_provider import MCPToolWrapper, MCPToolBridge
from services.agent.mcp.client import MCPClientManager

def test_mcp_protocol_messages():
    req = MCPRequest(id=1, method="tools/list")
    assert req.jsonrpc == "2.0"
    assert req.id == 1
    assert req.method == "tools/list"

    resp = MCPResponse(id=1, result={"tools": []})
    assert resp.jsonrpc == "2.0"
    assert resp.result == {"tools": []}

def test_mcp_tool_wrapper():
    mcp_tool = MCPToolDefinition(
        name="test_tool",
        description="A test MCP tool",
        input_schema={
            "type": "object",
            "properties": {"arg1": {"type": "string"}},
            "required": ["arg1"]
        }
    )
    client_mgr = MCPClientManager(event_bus=None)

    wrapper = MCPToolWrapper(server_name="test_server", client_manager=client_mgr, mcp_tool=mcp_tool)
    assert wrapper.name == "test_server_test_tool"
    assert wrapper.description == "A test MCP tool"

