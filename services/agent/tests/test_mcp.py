import asyncio
import base64
import shlex
import sys

import pytest
from services.agent.mcp.protocol import MCPRequest, MCPResponse, MCPToolDefinition
from services.agent.mcp.tool_provider import MCPToolWrapper, MCPToolBridge
from services.agent.mcp.client import MCPClient, MCPClientManager, safe_mcp_diagnostic
import services.agent.mcp.client as mcp_client_module
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


def _python_command(source):
    encoded = base64.b64encode(source.encode()).decode()
    code = f"import base64;exec(base64.b64decode('{encoded}'))"
    return shlex.join([sys.executable, "-u", "-c", code])


@pytest.mark.asyncio
async def test_mcp_stdio_command_performs_initialize_and_tools_list():
    source = """
import json, sys
for line in sys.stdin:
    request = json.loads(line)
    if request["method"] == "initialize":
        result = {"protocolVersion": "2.0"}
    elif request["method"] == "tools/list":
        result = {"tools": [{"name": "echo", "inputSchema": {"type": "object"}}]}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
"""
    manager = MCPClientManager(event_bus=None)

    client = await manager.add_server("test", command=_python_command(source))

    assert (await client.initialize()) == {"protocolVersion": "2.0"}
    assert [tool.name for tool in manager.get_all_tools()] == ["echo"]
    process = client.process
    await manager.remove_server("test")
    assert client.process is None
    assert process.returncode is not None


@pytest.mark.asyncio
async def test_mcp_manager_closes_process_when_initialize_is_rejected(monkeypatch):
    child_processes = []
    real_client = mcp_client_module.MCPClient

    class TrackedClient(real_client):
        async def connect(self):
            await super().connect()
            child_processes.append(self.process)

    monkeypatch.setattr(mcp_client_module, "MCPClient", TrackedClient)
    source = """
import json, sys
for line in sys.stdin:
    request = json.loads(line)
    print(json.dumps({"jsonrpc":"2.0", "id":request["id"], "error":{"code":-1, "message":"token=private-value"}}), flush=True)
"""
    manager = MCPClientManager(event_bus=None)

    with pytest.raises(RuntimeError) as error:
        await manager.add_server("rejected", command=_python_command(source))

    assert manager.clients == {}
    assert manager.tools_cache == {}
    assert child_processes[0].returncode is not None
    assert "private-value" not in str(error.value)
    assert "REDACTED" in str(error.value)


@pytest.mark.asyncio
async def test_mcp_timeout_terminates_stdio_process():
    client = MCPClient(server_command=_python_command("import time;time.sleep(10)"))
    client.request_timeout = 0.02
    await client.connect()
    process = client.process

    with pytest.raises(TimeoutError, match="timed out"):
        await client.initialize()

    assert process.returncode is not None
    assert client.process is None


@pytest.mark.asyncio
@pytest.mark.skipif(
    sys.platform == "win32",
    reason=(
        "Closing a Python child stdout descriptor does not expose EOF to the "
        "Windows asyncio pipe reader while the child remains alive."
    ),
)
async def test_mcp_server_closing_stdout_while_still_running_fails_fast_and_terminates():
    client = MCPClient(server_command=_python_command(
        "import sys,os,time;sys.stdout.close();os.close(1);time.sleep(10)"
    ))
    client.request_timeout = 5
    await client.connect()
    process = client.process

    with pytest.raises(ConnectionError, match="closed stdout before its process exited"):
        await client.initialize()

    await asyncio.wait_for(process.wait(), timeout=1)
    async def cleanup_finished():
        while client.process is not None:
            await asyncio.sleep(0.01)

    await asyncio.wait_for(cleanup_finished(), timeout=1)
    assert client.process is None


@pytest.mark.asyncio
async def test_mcp_manager_cleans_up_process_on_protocol_failure(monkeypatch):
    created_clients = []
    real_client = mcp_client_module.MCPClient

    class TrackedClient(real_client):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            created_clients.append(self)

    monkeypatch.setattr(mcp_client_module, "MCPClient", TrackedClient)
    source = "import sys;sys.stderr.write('token=private-value\\\\n');sys.stderr.flush();sys.exit(3)"
    manager = MCPClientManager(event_bus=None)

    with pytest.raises(ConnectionError) as error:
        await manager.add_server("broken", command=_python_command(source))

    assert manager.clients == {}
    assert manager.tools_cache == {}
    assert created_clients[0].process is None
    assert "private-value" not in str(error.value)
    assert "REDACTED" in str(error.value)


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


def test_mcp_diagnostics_redact_named_credentials_and_urls():
    safe = safe_mcp_diagnostic(
        "startup failed authorization: bearer private-value "
        "at https://example.test/path?token=private-url"
    )

    assert "private-value" not in safe
    assert "private-url" not in safe
    assert "[REDACTED]" in safe
    assert "[URL REDACTED]" in safe
