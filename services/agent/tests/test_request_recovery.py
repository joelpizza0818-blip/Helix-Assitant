import io

import pytest

from services.agent.ai.base_provider import ChatMessage
from services.agent.core.react_loop import (
    _adaptive_iteration_limit,
    _compact_messages_for_retry,
)


def test_context_compaction_keeps_system_and_current_request():
    messages = [
        ChatMessage(role="system", content="Keep safety and user instructions."),
        ChatMessage(role="user", content="Old request " * 200),
        ChatMessage(role="assistant", content="Old answer " * 200),
        ChatMessage(role="user", content="Current task: finish this change."),
    ]

    assert _compact_messages_for_retry(messages, 1)
    assert messages[0].role == "system"
    assert any("Current task: finish this change." in item.content for item in messages)
    assert any("Condensed excerpts" in item.content for item in messages)
    assert sum(len(item.content) for item in messages) < 4000


def test_context_compaction_trims_large_tool_results_on_second_pass():
    tool_result = ChatMessage(
        role="tool",
        content=f"{'a' * 4000}{'b' * 4000}",
        provider_data={"payload": "original"},
    )
    messages = [
        ChatMessage(role="system", content="System instructions."),
        ChatMessage(role="user", content="Complete the current task."),
        tool_result,
    ]

    assert _compact_messages_for_retry(messages, 2)
    assert len(tool_result.content) < 1300
    assert "[Earlier output omitted" in tool_result.content
    assert tool_result.provider_data is None


def test_long_requests_get_a_bounded_iteration_budget_without_affecting_planning():
    long_request = ChatMessage(
        role="user",
        content="Implement these items:\n- first\n- second\n- third\n- fourth",
    )
    assert _adaptive_iteration_limit([long_request], 10, "main") == 18
    assert _adaptive_iteration_limit([long_request], 1, "planning") == 1
    assert _adaptive_iteration_limit(
        [ChatMessage(role="user", content="Hello")], 10, "main"
    ) == 10


def test_context_retry_downscales_large_attached_images():
    image_library = pytest.importorskip("PIL.Image")
    image = image_library.new("RGB", (1600, 1200), color="orange")
    raw = io.BytesIO()
    image.save(raw, format="PNG")
    image_message = ChatMessage(
        role="user",
        content="Describe this image.",
        image_bytes=raw.getvalue(),
        image_mime_type="image/png",
    )
    messages = [
        ChatMessage(role="system", content="Keep the task context."),
        image_message,
        ChatMessage(role="user", content="Please inspect the attached image."),
    ]

    assert _compact_messages_for_retry(messages, 2)
    with image_library.open(io.BytesIO(image_message.image_bytes)) as compacted:
        assert max(compacted.size) <= 1280
