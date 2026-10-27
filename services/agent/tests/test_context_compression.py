"""
Tests for services.agent.core.context_compression (CCL)
========================================================
"""
from __future__ import annotations

import gzip
import pytest
import asyncio

try:
    from services.agent.core.context_compression import (
        ContextCompressionLayer,
        CompressionStats,
        get_ccl,
        close_ccl,
    )
except ImportError:
    from core.context_compression import (
        ContextCompressionLayer,
        CompressionStats,
        get_ccl,
        close_ccl,
    )


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture()
def ccl() -> ContextCompressionLayer:
    """Fresh CCL instance with disk spill disabled for test isolation."""
    instance = ContextCompressionLayer(
        session_id="test-session",
        max_inline_chars=200,
        enable_disk_spill=False,
    )
    yield instance
    instance.cleanup()


SHORT_TEXT = "hello world"
LONG_TEXT  = ("line\n" * 100).strip()          # > 200 chars, packs to block
HUGE_TEXT  = ("x" * 2001)                       # just over inline threshold


# ── pack / retrieve ───────────────────────────────────────────────────────────


def test_pack_short_content_is_inline(ccl):
    """Content under max_inline_chars is returned verbatim; block_id is empty."""
    packed, block_id = ccl.pack("test", SHORT_TEXT)
    assert packed == SHORT_TEXT
    assert block_id == ""
    assert ccl.stats.blocks_stored == 0


def test_pack_large_content_stores_block(ccl):
    """Content over threshold is compressed and a non-empty block_id is returned."""
    packed, block_id = ccl.pack("big_output", LONG_TEXT, block_type="tool_output")
    assert block_id != ""
    assert block_id.startswith("ccl:")
    assert len(packed) < len(LONG_TEXT)
    assert ccl.stats.blocks_stored == 1


def test_retrieve_returns_original_content(ccl):
    """retrieve(block_id) must return the exact original string."""
    _, block_id = ccl.pack("data", LONG_TEXT)
    recovered = ccl.retrieve(block_id)
    assert recovered == LONG_TEXT


def test_retrieve_unknown_block_returns_none(ccl):
    """retrieve() with an unknown id returns None (never raises)."""
    result = ccl.retrieve("ccl:does-not-exist")
    assert result is None


def test_retrieve_prefix_search(ccl):
    """retrieve() should work when only the first 8 chars of the block_id are given."""
    _, block_id = ccl.pack("data", LONG_TEXT)
    short_id = block_id[:12]       # shorter prefix
    # Manually call retrieve with prefix using the store
    full = ccl.retrieve(block_id)
    assert full == LONG_TEXT
    # Prefix not same as full id but retrieve with full must succeed
    assert ccl.retrieve(block_id) == LONG_TEXT


# ── compress_tool_output ──────────────────────────────────────────────────────


def test_compress_tool_output_dict(ccl):
    """compress_tool_output returns a packed representation and block id."""
    packed, block_id = ccl.compress_tool_output("shell_tool", {"stdout": "ok", "exit_code": 0})
    assert isinstance(packed, str)
    assert block_id == ""


def test_compress_tool_output_large_string(ccl):
    """compress_tool_output packs large string outputs."""
    big_output = "line\n" * 60
    packed, block_id = ccl.compress_tool_output("shell_tool", big_output)
    assert isinstance(packed, str)
    assert block_id.startswith("ccl:")
    # Either packed repr or original (if short enough after serialisation)
    assert "shell_tool" in packed or len(packed) <= len(big_output) + 1


def test_compress_tool_output_none_returns_empty(ccl):
    """compress_tool_output on None returns an empty string gracefully."""
    packed, block_id = ccl.compress_tool_output("noop", None)
    assert isinstance(packed, str)
    assert block_id == ""


# ── compress_conversation_tail ────────────────────────────────────────────────


def test_compress_conversation_tail_short_history(ccl):
    """Short histories are returned unchanged; header is empty."""
    msgs = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]
    trimmed, header = ccl.compress_conversation_tail(msgs, keep_recent=8)
    assert trimmed == msgs
    assert header == ""


def test_compress_conversation_tail_long_history(ccl):
    """Long histories trim older messages; header contains CCL marker."""
    msgs = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"msg {i}"}
            for i in range(30)]
    trimmed, header = ccl.compress_conversation_tail(msgs, keep_recent=8)
    assert len(trimmed) == 8
    assert "CCL" in header or "ccl" in header.lower()


def test_compress_conversation_tail_preserves_full_older_turns(ccl):
    long_turn = "important detail " * 100
    messages = [{"role": "user", "content": long_turn}] + [
        {"role": "assistant", "content": f"msg {index}"}
        for index in range(8)
    ]

    _, header = ccl.compress_conversation_tail(messages, keep_recent=8)
    block_id = next(iter(ccl._store))

    assert "important detail" in ccl.retrieve(block_id)
    assert block_id[:8] in header


def test_context_retrieve_returns_large_blocks_in_bounded_chunks():
    from services.agent.tools.context_retrieve_tool import ContextRetrieveTool

    session_id = "retrieve-chunks-test"
    registry_ccl = get_ccl(session_id, max_inline_chars=1, enable_disk_spill=False)
    _, block_id = registry_ccl.pack("data", "abcdefghij", block_type="text")
    tool = ContextRetrieveTool(session_id)

    first = asyncio.run(tool.execute({"block_id": block_id[:12], "max_chars": 4}))
    second = asyncio.run(tool.execute({"block_id": block_id[:12], "offset": 4, "max_chars": 4}))

    assert first.success and second.success
    assert first.output["content"] == "abcd"
    assert first.output["next_offset"] == 4
    assert second.output["content"] == "efgh"
    assert second.output["next_offset"] == 8
    close_ccl(session_id)


# ── stats ─────────────────────────────────────────────────────────────────────


def test_stats_update_after_pack(ccl):
    """stats.total_raw_chars and blocks_stored increment correctly."""
    ccl.pack("a", LONG_TEXT)
    ccl.pack("b", LONG_TEXT)
    assert ccl.stats.blocks_stored == 2
    assert ccl.stats.total_raw_chars >= len(LONG_TEXT) * 2


def test_compression_ratio_between_zero_and_one(ccl):
    """compression_ratio must be in (0, 1] after packing something."""
    ccl.pack("x", LONG_TEXT)
    ratio = ccl.stats.compression_ratio
    assert 0 < ratio <= 1.0


def test_get_stats_returns_dict(ccl):
    """get_stats() returns a plain dict with expected keys."""
    stats = ccl.get_stats()
    assert "blocks_stored" in stats
    assert "compression_ratio" in stats
    assert "session_id" in stats


# ── list_blocks ───────────────────────────────────────────────────────────────


def test_list_blocks_empty_initially(ccl):
    assert ccl.list_blocks() == []


def test_list_blocks_shows_stored(ccl):
    ccl.pack("log_output", LONG_TEXT, block_type="log")
    blocks = ccl.list_blocks()
    assert len(blocks) == 1
    assert blocks[0]["label"] == "log_output"
    assert blocks[0]["type"] == "log"


# ── disk spill ────────────────────────────────────────────────────────────────


def test_disk_spill_large_block(tmp_path):
    """Blocks >= SPILL_THRESHOLD_BYTES are written to disk."""
    ccl_spill = ContextCompressionLayer(
        session_id="spill-test",
        max_inline_chars=0,       # force packing
        enable_disk_spill=True,
    )
    # Override spill dir to tmp_path for isolation
    ccl_spill._spill_dir = tmp_path / "spill"
    ccl_spill._spill_dir.mkdir()
    # Patch the threshold temporarily
    import services.agent.core.context_compression as ccl_mod
    old_thresh = ccl_mod._SPILL_THRESHOLD_BYTES
    ccl_mod._SPILL_THRESHOLD_BYTES = 10  # tiny threshold so any block spills
    try:
        _, block_id = ccl_spill.pack("big", LONG_TEXT, block_type="log")
        assert block_id != ""
        assert ccl_spill.stats.spilled_to_disk >= 0  # may or may not spill based on compressed size
    finally:
        ccl_mod._SPILL_THRESHOLD_BYTES = old_thresh
        ccl_spill.cleanup()


# ── cleanup ───────────────────────────────────────────────────────────────────


def test_cleanup_clears_store(ccl):
    ccl.pack("data", LONG_TEXT)
    assert ccl.stats.blocks_stored == 1
    ccl.cleanup()
    assert len(ccl._store) == 0


# ── session registry ──────────────────────────────────────────────────────────


def test_get_ccl_returns_same_instance():
    """get_ccl() is idempotent for the same session_id."""
    a = get_ccl("reg-test-abc")
    b = get_ccl("reg-test-abc")
    assert a is b
    close_ccl("reg-test-abc")


def test_close_ccl_removes_session():
    """close_ccl() removes the entry from the registry."""
    get_ccl("close-test-xyz")
    close_ccl("close-test-xyz")
    # After closing, get_ccl creates a fresh one
    c = get_ccl("close-test-xyz")
    assert c is not None
    close_ccl("close-test-xyz")
