from services.agent.mcp.helix_vault_server import HelixVaultServer


def test_vault_mcp_is_read_only_and_scoped(tmp_path):
    note = tmp_path / "04 - Desarrollo" / "Tarea.md"
    note.parent.mkdir()
    note.write_text("sandbox y MCP", encoding="utf-8")
    server = HelixVaultServer(tmp_path)

    listed = server.call("list_notes", {})
    assert listed["notes"] == ["04 - Desarrollo\\Tarea.md"]
    searched = server.call("search_notes", {"query": "sandbox"})
    assert searched["matches"][0]["path"] == "04 - Desarrollo\\Tarea.md"
    assert "MCP" in server.call("read_note", {"path": "04 - Desarrollo/Tarea.md"})["content"]

    try:
        server.call("read_note", {"path": "../outside.md"})
    except ValueError as exc:
        assert "outside" in str(exc)
    else:
        raise AssertionError("Vault MCP allowed a path outside the selected root")
