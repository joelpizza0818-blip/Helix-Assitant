import pytest
from services.agent.mcp.protocol import MCPRequest, MCPResponse, MCPToolDefinition
from services.agent.mcp.tool_provider import MCPToolWrapper, MCPToolBridge
from services.agent.mcp.client import MCPClient, MCPClientManager
from services.agent.core.mcp_settings import (
    _desired_mcp_servers,
    _mcp_server_statuses,
)

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


def test_mcp_client_rejects_url_transport_without_echoing_url():
    url = "http://127.0.0.1:8765/mcp?token=do-not-log"

    with pytest.raises(ValueError, match="MCP URL transport is not supported") as error:
        MCPClient(server_url=url)

    assert url not in str(error.value)


@pytest.mark.asyncio
async def test_mcp_client_requires_a_stdio_command():
    with pytest.raises(ValueError, match="local stdio servers only"):
        await MCPClient().connect()


@pytest.mark.asyncio
async def test_mcp_manager_rejects_url_before_starting_or_network_access():
    url = "http://127.0.0.1:8765/mcp"
    manager = MCPClientManager(event_bus=None)

    with pytest.raises(ValueError, match="MCP URL transport is not supported"):
        await manager.add_server("remote", url=url)

    assert manager.clients == {}
    assert manager.tools_cache == {}


@pytest.mark.parametrize("url_field", ["url", "server_url"])
def test_legacy_url_only_mcp_server_reports_unsupported_without_echoing_secrets(url_field):
    secret_url = "https://mcp.example/private?token=url-secret"
    secret_credential = "credential-secret"
    legacy_config = {
        "name": "legacy-remote",
        url_field: secret_url,
        "headers": {"Authorization": secret_credential},
        "enabled": True,
    }

    statuses = _mcp_server_statuses(
        [legacy_config],
        active_servers={},
        connecting_servers=set(),
        server_errors={},
        tools_cache={},
    )
    status = statuses[0]

    assert _desired_mcp_servers([legacy_config]) == {}
    assert status["status"] == "unsupported"
    assert "URL-based MCP servers are not supported" in status["error"]
    assert secret_url not in str(statuses)
    assert secret_credential not in str(statuses)
    assert "url" not in status
    assert "server_url" not in status
    assert "headers" not in status
    assert "command" not in status
