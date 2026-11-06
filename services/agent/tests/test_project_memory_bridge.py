import pytest

from services.agent.core.desktop_bridge import DesktopRequestHandler
from services.agent.memory.project_memory import ProjectMemoryStore
from services.agent.memory.user_memory_manager import UserMemoryManager


@pytest.mark.asyncio
async def test_desktop_project_requests_import_and_activate_folder(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    store = ProjectMemoryStore(tmp_path / "helix" / "projects")
    handler = DesktopRequestHandler(
        None,
        None,
        None,
        None,
        tmp_path / "helix" / "settings.json",
        project_memory_store=store,
    )

    imported = await handler.dispatch({
        "type": "IMPORT_PROJECT_FOLDER",
        "payload": {"folder_path": str(root)},
        "request_id": "import",
    })
    project_id = imported["payload"]["projects"][0]["project_id"]
    await handler.dispatch({
        "type": "SET_ACTIVE_PROJECT",
        "payload": {"project_id": None},
        "request_id": "deactivate",
    })
    activated = await handler.dispatch({
        "type": "SET_ACTIVE_PROJECT",
        "payload": {"project_id": project_id},
        "request_id": "activate",
    })
    fetched_graph = await handler.dispatch({
        "type": "GET_PROJECT_GRAPH",
        "payload": {"project_id": project_id},
        "request_id": "graph",
    })
    saved_graph = await handler.dispatch({
        "type": "SAVE_PROJECT_GRAPH",
        "payload": {
            "project_id": project_id,
            "graph": {
                "nodes": fetched_graph["payload"]["nodes"],
                "edges": fetched_graph["payload"]["edges"],
            },
        },
        "request_id": "save-graph",
    })
    listed_files = await handler.dispatch({
        "type": "GET_PROJECT_FILES",
        "payload": {"project_id": project_id},
        "request_id": "files",
    })
    created_folder = await handler.dispatch({
        "type": "CREATE_PROJECT_ENTRY",
        "payload": {
            "project_id": project_id,
            "relative_path": "docs",
            "entry_type": "folder",
        },
        "request_id": "create-folder",
    })

    assert imported["payload"]["active_project_id"] == project_id
    assert activated["payload"]["active_project_id"] == project_id
    assert saved_graph["payload"]["project_id"] == project_id
    assert listed_files["payload"]["entries"] == []
    assert created_folder["payload"]["entries"][0]["path"] == "docs"


@pytest.mark.asyncio
async def test_desktop_general_memory_graph_requests(tmp_path, monkeypatch):
    manager = UserMemoryManager(tmp_path / "user_memories.json")
    manager.update_summary("Helix remembers Python.")
    monkeypatch.setattr(UserMemoryManager, "_instance", manager)
    handler = DesktopRequestHandler(
        None,
        None,
        None,
        None,
        tmp_path / "helix" / "settings.json",
    )

    fetched = await handler.dispatch({
        "type": "GET_GENERAL_MEMORY_GRAPH",
        "payload": {},
        "request_id": "general-graph",
    })
    saved = await handler.dispatch({
        "type": "SAVE_GENERAL_MEMORY_GRAPH",
        "payload": {
            "graph": {
                "nodes": fetched["payload"]["nodes"],
                "edges": fetched["payload"]["edges"],
            },
        },
        "request_id": "save-general-graph",
    })

    assert fetched["payload"]["project_id"] == "general-memory"
    assert saved["payload"]["project_id"] == "general-memory"
