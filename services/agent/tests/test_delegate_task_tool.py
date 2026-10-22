import asyncio

import pytest

from services.agent.tools.delegate_task_tool import DelegateTaskTool
from services.agent.core.subagent_delegation import (
    configure_subagent_delegation,
    safe_subagent_lifecycle_payload,
)
from services.agent.core.tool_registry import ToolRegistry


class StubKeyManager:
    def __init__(self, configured_count, available):
        self.configured_count = configured_count
        self.available = available

    def get_distinct_configured_credential_count(self):
        return self.configured_count

    def get_configured_providers(self):
        return list(self.available)

    def get_available_keys(self, provider):
        return self.available.get(provider, [])


class StubAgentManager:
    def __init__(self):
        self.calls = []

    async def delegate_task(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        task = asyncio.get_running_loop().create_future()
        task.set_result({
            "status": "success",
            "agent_id": "child-id",
            "result": "Research completed.",
        })
        return task


@pytest.mark.asyncio
async def test_delegate_tool_excludes_parent_credential_and_returns_child_metadata():
    manager = StubAgentManager()
    tool = DelegateTaskTool(
        manager,
        StubKeyManager(2, {"google": [(0, "parent-key"), (1, "child-key")]}),
    )

    result = await tool.execute_with_context(
        {"task": "Research the API", "role": "research"},
        parent_id="parent-id",
        parent_credential="parent-key",
    )

    assert result.success is True
    assert result.output == {
        "agent_id": "child-id",
        "status": "completed",
        "result": "Research completed.",
    }
    args, kwargs = manager.calls[0]
    assert args == ("Research the API",)
    assert kwargs["parent_id"] == "parent-id"
    assert kwargs["excluded_api_keys"] == ["parent-key"]
    assert "parent-key" not in str(kwargs["context"])


@pytest.mark.asyncio
async def test_delegate_tool_fails_if_no_distinct_available_credential_exists():
    manager = StubAgentManager()
    tool = DelegateTaskTool(
        manager,
        StubKeyManager(2, {"google": [(0, "parent-key"), (1, "parent-key")]}),
    )

    result = await tool.execute_with_context(
        {"task": "Independent work"},
        parent_id="parent-id",
        parent_credential="parent-key",
    )

    assert result.success is False
    assert "No distinct available credential" in result.error
    assert manager.calls == []


@pytest.mark.asyncio
async def test_delegate_tool_fails_when_an_alternate_credential_is_unavailable():
    manager = StubAgentManager()
    tool = DelegateTaskTool(
        manager,
        StubKeyManager(2, {"google": [(0, "parent-key")]}),
    )

    result = await tool.execute_with_context(
        {"task": "Independent work"},
        parent_id="parent-id",
        parent_credential="parent-key",
    )

    assert result.success is False
    assert "No distinct available credential" in result.error
    assert manager.calls == []


def test_subagent_tool_registration_uses_the_active_provider_session():
    manager = StubAgentManager()
    key_manager = StubKeyManager(1, {"google": [(0, "one-key")]})
    registry = ToolRegistry()
    tool = DelegateTaskTool(manager, key_manager)

    assert configure_subagent_delegation(
        {"subagents_enabled": True}, key_manager, registry, tool
    )
    assert registry.get_tool(tool.name) is tool

    assert not configure_subagent_delegation(
        {"subagents_enabled": False}, key_manager, registry, tool
    )
    assert registry.get_tool(tool.name) is None


def test_subagent_lifecycle_event_exposes_only_safe_metadata():
    secret = "configured-private-credential"
    event = safe_subagent_lifecycle_payload({
        "agent_id": "child-id",
        "parent_id": "parent-id",
        "role": "research",
        "status": "failed",
        "task": f"prompt mentions {secret}",
        "result": f"response mentions {secret}",
        "error": f"provider error contains {secret}",
        "api_key": secret,
    })

    assert event == {
        "agent_id": "child-id",
        "parent_id": "parent-id",
        "role": "research",
        "status": "failed",
        "has_result": True,
        "failed": True,
    }
    assert secret not in str(event)
