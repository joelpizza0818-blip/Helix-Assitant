import pytest

from services.agent.core.desktop_bridge import DesktopRequestHandler
from services.agent.core.workflow_store import WorkflowStore


class ToolRegistry:
    def get_tool_schemas(self):
        return [{"name": "summarize", "description": "Summarize input"}]


def _workflow():
    return {
        "id": "summarize-flow",
        "name": "Summarize",
        "description": "Summarize the incoming text",
        "nodes": [
            {
                "id": "trigger",
                "type": "trigger",
                "title": "Input",
                "x": 0,
                "y": 0,
                "config": {},
            },
            {
                "id": "summarize",
                "type": "tool",
                "title": "Summarize",
                "x": 200,
                "y": 0,
                "config": {"action": "summarize", "params": {}},
            },
            {
                "id": "output",
                "type": "output",
                "title": "Result",
                "x": 400,
                "y": 0,
                "config": {"source": "summarize"},
            },
        ],
        "edges": [
            {"id": "edge-input", "source": "trigger", "target": "summarize"},
            {"id": "edge-output", "source": "summarize", "target": "output"},
        ],
    }


def test_workflow_store_saves_lists_and_deletes(tmp_path):
    store = WorkflowStore(tmp_path, ToolRegistry())

    saved = store.save_workflow(_workflow())

    assert store.get_workflow("summarize-flow") == saved
    assert store.list_workflows() == [saved]
    assert store.delete_workflow("summarize-flow") is True
    assert store.delete_workflow("summarize-flow") is False


def test_workflow_store_preserves_negative_canvas_positions(tmp_path):
    store = WorkflowStore(tmp_path, ToolRegistry())
    workflow = _workflow()
    workflow["nodes"][1]["x"] = -1200
    workflow["nodes"][1]["y"] = -350

    saved = store.save_workflow(workflow)

    assert saved["nodes"][1]["x"] == -1200
    assert saved["nodes"][1]["y"] == -350
    assert store.get_workflow("summarize-flow") == saved


def test_desktop_bridge_registers_workflow_execution_for_cancellation(tmp_path):
    import asyncio
    from unittest.mock import AsyncMock

    workflow = _workflow()
    task_manager = type("TaskManager", (), {})()
    task_manager.create_task = AsyncMock()
    task_manager.register_task_handle = AsyncMock()
    task_manager.unregister_task_handle = AsyncMock()
    orchestrator = type("Orchestrator", (), {})()
    orchestrator.execute_task = AsyncMock()
    store = type("Store", (), {})()
    store.get_workflow = lambda _workflow_id: workflow
    handler = DesktopRequestHandler(
        task_manager,
        None,
        None,
        None,
        tmp_path / "settings.json",
        orchestrator=orchestrator,
        workflow_store=store,
    )

    async def run():
        result = await handler._run_workflow({"id": "summarize-flow", "input": "hello"})
        await asyncio.sleep(0)
        return result

    result = asyncio.run(run())

    task_id = result["task_id"]
    assert task_id.startswith("workflow-")
    task_manager.register_task_handle.assert_awaited_once()
    orchestrator.execute_task.assert_awaited_once()
    task_manager.unregister_task_handle.assert_awaited_once()


def test_workflow_store_builds_advanced_skill_from_graph(tmp_path):
    store = WorkflowStore(tmp_path, ToolRegistry())
    workflow = store.save_workflow(_workflow())

    skill = store.to_skill(workflow, triggers=["summarize this", "make a summary"])

    assert skill["name"] == "summarize-flow"
    assert skill["workflow_id"] == "summarize-flow"
    assert skill["tools"] == ["summarize"]
    assert skill["triggers"] == ["summarize this", "make a summary"]
    assert "%summarize-flow" in skill["instructions"]
    assert "summarize" in skill["instructions"]

    with pytest.raises(ValueError, match="triggers"):
        store.to_skill(workflow, triggers=["x"] * 13)


def test_desktop_bridge_saves_workflow_as_advanced_skill(tmp_path):
    import asyncio

    from services.agent.skills.skill_loader import SkillLoader
    from services.agent.skills.skill_registry import SkillRegistry

    workflow_store = WorkflowStore(tmp_path / "workflows", ToolRegistry())
    workflow_store.save_workflow(_workflow())
    skill_registry = SkillRegistry(SkillLoader())
    handler = DesktopRequestHandler(
        type("TaskManager", (), {})(),
        None,
        None,
        None,
        tmp_path / "settings.json",
        skill_registry=skill_registry,
        workflow_store=workflow_store,
    )

    result = asyncio.run(handler._save_workflow_skill({
        "id": "summarize-flow",
        "triggers": ["summarize this"],
    }))

    assert result["name"] == "summarize-flow"
    assert result["workflow_id"] == "summarize-flow"
    assert result["custom"] is True
    saved_skill = skill_registry.get_skill("summarize-flow")
    assert saved_skill is not None
    assert saved_skill.config["workflow_id"] == "summarize-flow"
    skill_file = tmp_path / "skills" / "summarize-flow" / "SKILL.md"
    assert skill_file.is_file()
    assert 'workflow_id: "summarize-flow"' in skill_file.read_text(encoding="utf-8")


def test_workflow_store_converts_graph_and_validates_tool_dependencies(tmp_path):
    store = WorkflowStore(tmp_path, ToolRegistry())
    workflow = _workflow()
    workflow["nodes"][1]["config"]["params"] = {
        "text": {"$from_step": "trigger"},
    }

    plan = store.to_plan(workflow, "hello")

    assert [step.id for step in plan.steps] == ["trigger", "summarize", "output"]
    assert plan.steps[1].dependencies == ["trigger"]
    assert plan.steps[2].dependencies == ["summarize"]

    workflow["nodes"][1]["config"]["params"]["text"]["$from_step"] = "output"
    with pytest.raises(ValueError, match="must connect"):
        store.to_plan(workflow, "hello")


def test_workflow_store_converts_condition_branches(tmp_path):
    store = WorkflowStore(tmp_path, ToolRegistry())
    workflow = {
        "id": "branch-flow",
        "name": "Branch",
        "nodes": [
            {"id": "trigger", "type": "trigger", "title": "Input", "x": 0, "y": 0, "config": {}},
            {"id": "condition", "type": "condition", "title": "Check", "x": 100, "y": 0, "config": {"source": "trigger", "operator": "truthy"}},
            {"id": "true", "type": "output", "title": "Yes", "x": 200, "y": 0, "config": {"value": "yes"}},
            {"id": "false", "type": "output", "title": "No", "x": 200, "y": 100, "config": {"value": "no"}},
        ],
        "edges": [
            {"id": "edge-input", "source": "trigger", "target": "condition"},
            {"id": "edge-true", "source": "condition", "target": "true", "label": "true"},
            {"id": "edge-false", "source": "condition", "target": "false", "label": "false"},
        ],
    }

    plan = store.to_plan(workflow, "hello")

    assert plan.steps[1].dependencies == ["trigger"]
    assert plan.steps[2].when == [{"source": "condition", "value": True}]
    assert plan.steps[3].when == [{"source": "condition", "value": False}]


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda graph: (
            graph["nodes"].append({
                "id": "agent",
                "type": "agent",
                "title": "Agent",
                "x": 300,
                "y": 100,
                "config": {"role": "main", "task": "test"},
            }),
            graph["edges"].extend([
                {"id": "edge-agent-a", "source": "summarize", "target": "agent"},
                {"id": "edge-agent-b", "source": "agent", "target": "summarize"},
            ]),
        ), "cannot contain cycles"),
        (lambda graph: graph["nodes"][2]["config"].update(source="missing"), "unknown source"),
        (lambda graph: graph["edges"][1].update(target="trigger"), "trigger cannot have incoming"),
    ],
)
def test_workflow_store_rejects_invalid_graphs(tmp_path, mutate, message):
    store = WorkflowStore(tmp_path, ToolRegistry())
    workflow = _workflow()
    mutate(workflow)

    with pytest.raises(ValueError, match=message):
        store.save_workflow(workflow)
