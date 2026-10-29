import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from services.agent.core.agent_manager import AgentManager
from services.agent.core.agent_profiles import AgentProfileStore
from services.agent.core.event_bus import EventBus


class FakeContextManager:
    def __init__(self):
        self.messages = {}

    def get_system_prompt(self, _role):
        return "Test agent."

    def add_message(self, conversation_id, message):
        self.messages.setdefault(conversation_id, []).append(message)

    def get_messages(self, conversation_id):
        return self.messages.get(conversation_id, [])


class FakeReactLoop:
    def __init__(self):
        self.execute_kwargs = None

    async def execute(self, **kwargs):
        self.execute_kwargs = kwargs
        return SimpleNamespace(content="verified")


def test_model_created_profiles_are_bounded_and_persistent(tmp_path: Path):
    profile_path = tmp_path / "subagents" / "profiles.json"
    store = AgentProfileStore(profile_path)
    created = store.create(
        name="Verifier",
        role="analysis",
        description="Checks task outputs against explicit requirements.",
        capabilities=["verification"],
        color="#02b8cc",
    )

    restored = AgentProfileStore(profile_path).get("verifier")
    assert restored is not None
    assert restored.public_dict() == created.public_dict()

def test_profiles_can_be_personalized_without_losing_route_or_memory_identity(tmp_path: Path):
    profile_path = tmp_path / "subagents" / "profiles.json"
    store = AgentProfileStore(profile_path)
    store.assign_route("eliot", "google", "gemini-test", 2)

    updated = store.update(
        "eliot",
        name="Eliot Prime",
        role="analysis",
        description="Reviews technical claims and release evidence.",
        capabilities=["analysis", "verification"],
        color="#123abc",
        instructions="Cite evidence and clearly flag unknowns.",
    )

    restored = AgentProfileStore(profile_path).get("eliot")
    assert restored is not None
    assert updated.name == "Eliot Prime"
    assert updated.color == "#123abc"
    assert updated.instructions == "Cite evidence and clearly flag unknowns."
    assert updated.model_route == {
        "provider": "google",
        "model": "gemini-test",
        "key_slot": 2,
    }
    assert restored.public_dict() == updated.public_dict()

@pytest.mark.asyncio
async def test_profile_instructions_are_added_to_persistent_chat_prompt(tmp_path: Path):
    context_manager = FakeContextManager()
    store = AgentProfileStore(tmp_path / "profiles.json")
    manager = AgentManager(
        react_loop=FakeReactLoop(),
        context_manager=context_manager,
        event_bus=EventBus(),
        role_config=None,
        tool_registry=None,
        profile_store=store,
    )

    await manager.chat_with_agent("eliot", "Review this source.")
    manager.update_profile(
        "eliot",
        name="Eliot",
        role="research",
        description="Researches and verifies claims.",
        capabilities=["research"],
        color="#a0ca92",
        instructions="List assumptions before conclusions.",
    )
    await manager.chat_with_agent("eliot", "Review the next source.")

    system_prompt = context_manager.get_messages("subagent_eliot")[0].content
    assert "List assumptions before conclusions." in system_prompt
    assert "do not override the system instructions" in system_prompt


@pytest.mark.asyncio
async def test_profile_selection_uses_stored_identity_and_strict_model_route(tmp_path: Path):
    profile_path = tmp_path / "subagents" / "profiles.json"
    store = AgentProfileStore(profile_path)
    store.assign_route("eliot", "google", "gemini-test", 2)
    loop = FakeReactLoop()
    manager = AgentManager(
        react_loop=loop,
        context_manager=FakeContextManager(),
        event_bus=EventBus(),
        role_config=None,
        tool_registry=None,
        profile_store=AgentProfileStore(profile_path),
    )

    handle = await manager.delegate_task(
        "Verify the implementation",
        role="coding",
        profile_id="eliot",
    )
    result = await handle

    assert result["status"] == "success"
    assert result["profile_id"] == "eliot"
    assert result["name"] == "Eliot"
    assert manager.records[result["agent_id"]].role == "research"
    assert loop.execute_kwargs["preferred_route"] == {
        "provider": "google",
        "model": "gemini-test",
        "key_slot": 2,
    }


@pytest.mark.asyncio
async def test_direct_and_peer_chats_use_the_persistent_profile_conversation(tmp_path: Path):
    profile_path = tmp_path / "subagents" / "profiles.json"
    context_manager = FakeContextManager()
    manager = AgentManager(
        react_loop=FakeReactLoop(),
        context_manager=context_manager,
        event_bus=EventBus(),
        role_config=None,
        tool_registry=None,
        profile_store=AgentProfileStore(profile_path),
        memory_directory=tmp_path / "memories",
    )

    direct = await manager.chat_with_agent("eliot", "Check this conclusion.")
    peer = await manager.message_agent_from_task(
        "main-task", "eliot", "Verify the cited claim."
    )

    assert direct["response"] == "verified"
    assert peer["response"] == "verified"
    transcript = context_manager.get_messages("subagent_eliot")
    assert [message.role for message in transcript] == [
        "system", "user", "assistant", "user", "assistant",
    ]


@pytest.mark.asyncio
async def test_same_profile_tasks_queue_while_different_profiles_run_in_parallel():
    class ConcurrentLoop(FakeReactLoop):
        def __init__(self):
            super().__init__()
            self.active = 0
            self.max_active = 0

        async def execute(self, **kwargs):
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            await asyncio.sleep(0.02)
            self.active -= 1
            self.execute_kwargs = kwargs
            return SimpleNamespace(content="done")

    loop = ConcurrentLoop()
    manager = AgentManager(
        react_loop=loop,
        context_manager=FakeContextManager(),
        event_bus=EventBus(),
        role_config=None,
        tool_registry=None,
    )
    first = await manager.delegate_task("One", "research", profile_id="eliot")
    second = await manager.delegate_task("Two", "research", profile_id="eliot")
    third = await manager.delegate_task("Three", "coding", profile_id="joel")

    await asyncio.gather(first, second, third)

    assert loop.max_active == 2


@pytest.mark.asyncio
async def test_promotion_updates_the_next_turn_system_scope(tmp_path: Path):
    context_manager = FakeContextManager()
    manager = AgentManager(
        react_loop=FakeReactLoop(),
        context_manager=context_manager,
        event_bus=EventBus(),
        role_config=None,
        tool_registry=None,
        profile_store=AgentProfileStore(tmp_path / "profiles.json"),
        memory_directory=tmp_path / "memories",
    )
    await manager.chat_with_agent("eliot", "Review this.")
    await manager.promote_profile(
        "eliot",
        "Verify package release checksums.",
        ["release-verification"],
    )
    await manager.chat_with_agent("eliot", "Verify a release checksum.")

    system_prompt = context_manager.get_messages("subagent_eliot")[0].content
    assert "Verify package release checksums." in system_prompt
    assert "release-verification" in system_prompt


def test_profile_route_validation_rejects_missing_or_invalid_slots(tmp_path: Path):
    store = AgentProfileStore(tmp_path / "profiles.json")

    with pytest.raises(ValueError, match="model route"):
        store.assign_route("harvey", "google", "model-id", -1)
