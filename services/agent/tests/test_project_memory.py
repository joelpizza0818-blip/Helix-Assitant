import json

import pytest

from services.agent.memory.project_memory import ProjectMemoryStore


def test_import_folder_references_existing_directory_and_selects_it(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    store = ProjectMemoryStore(tmp_path / "helix" / "projects")

    project = store.import_folder(str(root))

    assert project["root_path"] == str(root.resolve())
    assert store.get_active_project_id() == project["project_id"]
    assert store.list_projects()["projects"] == [project]
    assert (tmp_path / "helix" / "projects" / project["project_id"] / "graph.json").exists()


def test_import_folder_reuses_existing_project_and_rejects_missing_path(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    store = ProjectMemoryStore(tmp_path / "projects")

    first = store.import_folder(str(root))
    duplicate = store.import_folder(str(root))

    assert duplicate == first
    with pytest.raises(ValueError, match="could not be found"):
        store.import_folder(str(tmp_path / "missing"))


def test_project_graph_context_includes_relevant_nodes_and_execution(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    store = ProjectMemoryStore(tmp_path / "projects")
    project = store.import_folder(str(root))
    node = store.add_memory_node(
        project["project_id"],
        "decision",
        "Database migration",
        "Use additive migrations before removing legacy columns.",
        related_to=[project["project_id"]],
        relation="has_decision",
    )
    store.record_execution(
        project["project_id"],
        "task-123",
        "completed",
        "Task: migrate database. Result: additive migration passed.",
    )

    context = store.get_relevant_context(
        project["project_id"],
        "database migration",
    )
    graph = json.loads(
        (
            tmp_path
            / "projects"
            / project["project_id"]
            / "graph.json"
        ).read_text(encoding="utf-8")
    )

    assert "Database migration" in context
    assert "additive migration passed" in context
    assert str(root.resolve()) in context
    assert any(item["node_id"] == node["node_id"] for item in graph["nodes"])
    assert any(item["relation"] == "has_decision" for item in graph["edges"])


def test_session_execution_memory_is_scoped_to_its_conversation(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    store = ProjectMemoryStore(tmp_path / "projects", execution_ttl="session")
    project = store.import_folder(str(root))
    store.record_execution(
        project["project_id"],
        "task-session",
        "completed",
        "Session-only execution summary.",
        session_id="conversation-a",
    )

    assert "Session-only execution summary" not in store.get_relevant_context(
        project["project_id"],
        "",
        session_id="conversation-b",
    )
    assert "Session-only execution summary" in store.get_relevant_context(
        project["project_id"],
        "",
        session_id="conversation-a",
    )


def test_project_graph_can_edit_nodes_relationships_and_styles(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    store = ProjectMemoryStore(tmp_path / "projects")
    project = store.import_folder(str(root))
    added = store.add_memory_node(
        project["project_id"],
        "decision",
        "Initial choice",
        "Initial project memory.",
        related_to=[project["project_id"]],
        relation="documents",
    )
    graph = store.get_project_graph(project["project_id"])
    decision = next(node for node in graph["nodes"] if node["node_id"] == added["node_id"])
    edge = graph["edges"][0]
    decision.update(
        title="Revised choice",
        content="Edited project memory.",
        color="#123ABC",
        x=-1234,
        y=5678,
    )
    edge.update(relation="supports", color="#ABCDEF")

    saved = store.save_project_graph(project["project_id"], graph["nodes"], graph["edges"])
    saved_node = next(node for node in saved["nodes"] if node["node_id"] == added["node_id"])
    saved_edge = next(item for item in saved["edges"] if item["edge_id"] == edge["edge_id"])

    assert saved_node["title"] == "Revised choice"
    assert saved_node["content"] == "Edited project memory."
    assert saved_node["color"] == "#123ABC"
    assert saved_node["x"] == -1234
    assert saved_node["y"] == 5678
    assert saved_edge["relation"] == "supports"
    assert saved_edge["color"] == "#ABCDEF"
    assert "Edited project memory." in store.get_relevant_context(
        project["project_id"],
        "revised choice",
    )


@pytest.mark.parametrize("corruption", ["missing_root", "invalid_node", "invalid_edge"])
def test_project_graph_rejects_invalid_persisted_data(tmp_path, corruption):
    root = tmp_path / "workspace"
    root.mkdir()
    store = ProjectMemoryStore(tmp_path / "projects")
    project = store.import_folder(str(root))
    graph_path = (
        tmp_path
        / "projects"
        / project["project_id"]
        / "graph.json"
    )
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    if corruption == "missing_root":
        graph["nodes"] = []
    elif corruption == "invalid_node":
        graph["nodes"][0]["type"] = "unsupported"
    else:
        graph["edges"] = [{
            "edge_id": "edge-1",
            "source": project["project_id"],
            "target": project["project_id"],
            "relation": "relates_to",
            "color": "not-a-color",
        }]
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    with pytest.raises(RuntimeError, match="Stored project graph has an invalid format"):
        store.get_project_graph(project["project_id"])


def test_project_graph_repairs_legacy_missing_colors_and_edge_ids(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    store = ProjectMemoryStore(tmp_path / "projects")
    project = store.import_folder(str(root))
    added = store.add_memory_node(
        project["project_id"],
        "decision",
        "Initial choice",
        "Initial project memory.",
        related_to=[project["project_id"]],
        relation="documents",
    )
    graph_path = (
        tmp_path
        / "projects"
        / project["project_id"]
        / "graph.json"
    )
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    node = next(node for node in graph["nodes"] if node["node_id"] == added["node_id"])
    del node["color"]
    del graph["edges"][0]["edge_id"]
    del graph["edges"][0]["color"]
    graph_path.write_text(json.dumps(graph), encoding="utf-8")

    loaded = store.get_project_graph(project["project_id"])
    persisted = json.loads(graph_path.read_text(encoding="utf-8"))

    loaded_node = next(
        node for node in loaded["nodes"] if node["node_id"] == added["node_id"]
    )
    assert loaded_node["color"] == "#22C55E"
    assert loaded["edges"][0]["edge_id"]
    assert loaded["edges"][0]["color"] == "#8A8380"
    assert persisted["edges"][0]["edge_id"] == loaded["edges"][0]["edge_id"]


def test_project_graph_rejects_root_deletion_and_cleans_deleted_execution(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    store = ProjectMemoryStore(tmp_path / "projects", execution_ttl="permanent")
    project = store.import_folder(str(root))
    store.record_execution(
        project["project_id"],
        "task-delete",
        "completed",
        "Execution to delete.",
    )
    graph = store.get_project_graph(project["project_id"])
    task_node = next(node for node in graph["nodes"] if node.get("task_id") == "task-delete")

    with pytest.raises(ValueError, match="project root node cannot be deleted"):
        store.save_project_graph(
            project["project_id"],
            [node for node in graph["nodes"] if node["node_id"] != project["project_id"]],
            [
                edge
                for edge in graph["edges"]
                if edge["source"] != project["project_id"]
                and edge["target"] != project["project_id"]
            ],
        )

    saved = store.save_project_graph(
        project["project_id"],
        [node for node in graph["nodes"] if node["node_id"] != task_node["node_id"]],
        [edge for edge in graph["edges"] if edge["target"] != task_node["node_id"]],
    )
    execution_data = json.loads(
        (
            tmp_path
            / "projects"
            / project["project_id"]
            / "execution.json"
        ).read_text(encoding="utf-8")
    )

    assert all(node["node_id"] != task_node["node_id"] for node in saved["nodes"])
    assert execution_data["records"] == []


def test_execution_ttl_configuration_rejects_unknown_policies(tmp_path):
    with pytest.raises(ValueError, match="Execution memory TTL"):
        ProjectMemoryStore(tmp_path / "projects", execution_ttl="forever-ish")

    store = ProjectMemoryStore(tmp_path / "projects")
    with pytest.raises(ValueError, match="Execution memory TTL"):
        store.configure("forever-ish")


def test_project_file_operations_and_link_indexing(tmp_path):
    root = tmp_path / "workspace"
    (root / "src").mkdir(parents=True)
    (root / "src" / "main.py").write_text(
        "from .utils import helper\nimport requests\n# See [[README.md]]\n",
        encoding="utf-8",
    )
    (root / "src" / "utils.py").write_text("def helper():\n    return 1\n", encoding="utf-8")
    (root / "README.md").write_text(
        "Documentation for [[src/main.py]]. The Python runtime powers this project.\n",
        encoding="utf-8",
    )
    store = ProjectMemoryStore(tmp_path / "projects")
    project = store.import_folder(str(root))
    runtime = store.add_memory_node(
        project["project_id"],
        "technology",
        "Python runtime",
        "Runtime used by the project.",
    )

    graph = store.get_project_graph(project["project_id"])
    nodes_by_title = {node["title"]: node for node in graph["nodes"]}

    assert {"README.md", "src/main.py", "src/utils.py", "requests"} <= set(nodes_by_title)
    assert any(
        edge["source"] == nodes_by_title["src/main.py"]["node_id"]
        and edge["target"] == nodes_by_title["src/utils.py"]["node_id"]
        and edge["relation"] == "imports"
        for edge in graph["edges"]
    )
    assert any(edge["relation"] == "references" for edge in graph["edges"])
    assert any(
        edge["source"] == nodes_by_title["README.md"]["node_id"]
        and edge["target"] == runtime["node_id"]
        and edge["relation"] == "mentions"
        for edge in graph["edges"]
    )
    assert nodes_by_title["src/main.py"]["origin"] == "file_index"


def test_project_file_operations_are_rooted_and_import_files_are_copied(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    source = tmp_path / "notes.md"
    source.write_text("Imported knowledge.", encoding="utf-8")
    store = ProjectMemoryStore(tmp_path / "projects")
    project = store.import_folder(str(root))

    store.create_project_entry(project["project_id"], "docs", "folder")
    result = store.import_project_files(
        project["project_id"],
        [str(source)],
        "docs",
    )

    assert (root / "docs" / "notes.md").read_text(encoding="utf-8") == "Imported knowledge."
    assert result["entries"][0]["path"] == "docs"
    with pytest.raises(ValueError, match="stay inside"):
        store.create_project_entry(project["project_id"], "../outside.txt", "file")
    with pytest.raises(FileExistsError):
        store.import_project_files(project["project_id"], [str(source)], "docs")
