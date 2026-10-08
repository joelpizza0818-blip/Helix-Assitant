import pytest
from services.agent.memory.memory_manager import MemoryManager, MemoryType
from services.agent.memory.conversation_memory import ConversationMemory

@pytest.mark.asyncio
async def test_memory_status_requires_dedicated_database(monkeypatch):
    monkeypatch.delenv("HELIX_MEMORY_DATABASE_URL", raising=False)
    memory = MemoryManager()

    status = await memory.status()

    assert status["pgvector_ready"] is False
    assert status["provider"] == "local"
    assert "HELIX_MEMORY_DATABASE_URL" in status["message"]

@pytest.mark.asyncio
async def test_configuring_application_memory_preserves_session_memory():
    memory = MemoryManager()
    conversation = await memory.store(
        "remember this conversation",
        MemoryType.CONVERSATION,
    )

    memory.configure({"application_memory": {"preferred_language": "English"}})

    assert conversation.id in memory.memories
    assert "preferred_language" in memory.memories

@pytest.mark.asyncio
async def test_clear_conversation_memory_preserves_application_and_long_term_memory():
    memory = MemoryManager()
    conversation = await memory.store("conversation", MemoryType.CONVERSATION)
    long_term = await memory.store("long term", MemoryType.LONG_TERM)
    memory.configure({"application_memory": {"preference": "English"}})

    await memory.clear_conversation_memory()

    assert conversation.id not in memory.memories
    assert long_term.id in memory.memories
    assert "preference" in memory.memories

@pytest.mark.asyncio
async def test_conversation_memory_lifecycle(tmp_path):
    db_path = str(tmp_path / "conv_test.db")
    conv = ConversationMemory(db_path=db_path)

    await conv.add_message("user", "Hello Helix")
    await conv.add_message("assistant", "Greetings. Ready for commands.")

    messages = conv.get_messages(limit=10)
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "Hello Helix"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "Greetings. Ready for commands."

    await conv.clear()
    assert len(conv.get_messages()) == 0

def test_memory_types_defined():
    expected = {"SHORT_TERM", "CONVERSATION", "LONG_TERM", "SEMANTIC"}
    actual = set(t.name for t in MemoryType)
    assert expected == actual


def test_memory_settings_control_turn_limit_and_auto_compaction():
    memory = MemoryManager()

    memory.configure({
        "memory_context_limit": 6,
        "memory_auto_compaction": False,
    })

    assert memory.context_limit == 6
    assert memory.auto_compaction is False
