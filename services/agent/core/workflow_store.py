import json
import math
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from services.agent.core.planner import Plan, PlanStep, Planner
except ImportError:
    from core.planner import Plan, PlanStep, Planner


_WORKFLOW_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")
_NODE_ID = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")
_NODE_TYPES = {
    "trigger", "tool", "agent", "capability", "condition", "parallel", "merge", "output",
}
_CONDITION_OPERATORS = {"truthy", "exists", "equals", "contains"}
_POSITION_LIMIT = 100000
_MAX_NODES = 100
_MAX_WORKFLOW_BYTES = 512 * 1024


class WorkflowStore:
    def __init__(self, directory: Path, tool_registry=None) -> None:
        self.directory = Path(directory)
        self.tool_registry = tool_registry

    def list_workflows(self) -> list[dict[str, Any]]:
        if not self.directory.is_dir():
            return []
        workflows = []
        for path in sorted(self.directory.glob("*.json")):
            workflow_id = path.stem
            if not _WORKFLOW_ID.fullmatch(workflow_id):
                continue
            workflows.append(self.get_workflow(workflow_id))
        return workflows

    def get_workflow(self, workflow_id: str) -> dict[str, Any]:
        path = self._workflow_path(workflow_id)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as error:
            raise ValueError(f"Workflow '{workflow_id}' was not found.") from error
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Workflow '{workflow_id}' could not be loaded.") from error
        return self._validate(data, workflow_id=workflow_id)

    def save_workflow(self, workflow: dict[str, Any]) -> dict[str, Any]:
        normalized = self._validate(workflow)
        serialized = json.dumps(
            normalized,
            ensure_ascii=False,
            allow_nan=False,
            indent=2,
        ).encode("utf-8")
        if len(serialized) > _MAX_WORKFLOW_BYTES:
            raise ValueError("Workflow exceeds the 512 KiB size limit.")

        path = self._workflow_path(normalized["id"])
        self.directory.mkdir(parents=True, exist_ok=True)
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=path.parent,
                prefix=f".{normalized['id']}.",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                temporary_file.write(serialized)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            temporary_path.replace(path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
        return normalized

    def delete_workflow(self, workflow_id: str) -> bool:
        path = self._workflow_path(workflow_id)
        try:
            path.unlink()
            return True
        except FileNotFoundError:
            return False

    def get_tool_options(self) -> list[dict[str, str]]:
        if self.tool_registry is None:
            raise RuntimeError("Workflow tool registry is unavailable.")
        return [
            {
                "name": item["name"],
                "description": str(item.get("description", ""))[:240],
                "required_capability": str(
                    item.get("x-helix-required-capability", "")
                ),
            }
            for item in self.tool_registry.get_tool_schemas()
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        ]

    def get_capability_options(self) -> list[dict[str, str]]:
        capabilities = {}
        for tool in self.get_tool_options():
            capability = tool["required_capability"]
            if capability:
                capabilities.setdefault(
                    capability,
                    f"Required by {tool['name']}",
                )
        return [
            {"id": capability, "description": description}
            for capability, description in sorted(capabilities.items())
        ]

    def to_plan(
        self,
        workflow: dict[str, Any],
        input_text: str,
    ) -> Plan:
        normalized = self._validate(workflow, workflow_id=workflow.get("id"))
        nodes = {node["id"]: node for node in normalized["nodes"]}
        incoming: dict[str, list[dict[str, Any]]] = {
            node_id: [] for node_id in nodes
        }
        for edge in normalized["edges"]:
            incoming[edge["target"]].append(edge)

        steps = []
        for node in normalized["nodes"]:
            node_id = node["id"]
            node_type = node["type"]
            config = node["config"]
            dependencies = [
                edge["source"]
                for edge in incoming[node_id]
                if edge["source"] != node_id
            ]
            when = []
            for edge in incoming[node_id]:
                source_node = nodes[edge["source"]]
                if source_node["type"] == "condition":
                    when.append({
                        "source": edge["source"],
                        "value": edge["label"].casefold() == "true",
                    })
            if node_type == "condition":
                source_id = config["source"]
                if source_id not in nodes or source_id == node_id:
                    raise ValueError("Condition node references an invalid source.")
                if source_id not in dependencies:
                    dependencies.append(source_id)
                action = "__workflow_condition__"
                params = config
            elif node_type == "trigger":
                action = "__workflow_trigger__"
                params = {"input": input_text}
            elif node_type == "tool":
                action = config["action"]
                params = config.get("params", {})
                for source in Planner._parameter_dependencies(params):
                    if source not in nodes:
                        raise ValueError(
                            f"Tool node '{node_id}' references unknown node '{source}'."
                        )
                    if source not in dependencies:
                        raise ValueError(
                            f"Tool node '{node_id}' must connect to referenced node '{source}'."
                        )
            elif node_type == "agent":
                action = "__workflow_agent__"
                params = config
            elif node_type == "capability":
                action = "__workflow_capability__"
                params = config
            elif node_type == "parallel":
                action = "__workflow_parallel__"
                params = {}
            elif node_type == "merge":
                action = "__workflow_merge__"
                params = {}
            elif node_type == "output":
                action = "__workflow_output__"
                params = config
                source_id = config.get("source")
                if source_id is not None:
                    if source_id not in nodes:
                        raise ValueError(
                            f"Output node '{node_id}' references an unknown node."
                        )
                    if source_id not in dependencies:
                        dependencies.append(source_id)
            else:
                raise ValueError(f"Workflow node type '{node_type}' is unsupported.")
            steps.append(
                PlanStep(
                    id=node_id,
                    action=action,
                    params=params,
                    dependencies=dependencies,
                    when=when,
                    run_if_any=node_type == "merge",
                )
            )
        return Plan(steps)

    def _workflow_path(self, workflow_id: str) -> Path:
        if not isinstance(workflow_id, str) or not _WORKFLOW_ID.fullmatch(workflow_id):
            raise ValueError("Workflow id must be a lowercase slug.")
        return self.directory / f"{workflow_id}.json"

    def _validate(
        self,
        workflow: Any,
        *,
        workflow_id: str | None = None,
    ) -> dict[str, Any]:
        if not isinstance(workflow, dict):
            raise ValueError("Workflow must be an object.")
        identifier = workflow.get("id", workflow_id)
        name = workflow.get("name")
        description = workflow.get("description", "")
        nodes = workflow.get("nodes")
        edges = workflow.get("edges")
        if (
            not isinstance(identifier, str)
            or not _WORKFLOW_ID.fullmatch(identifier)
            or (workflow_id is not None and identifier != workflow_id)
            or not isinstance(name, str)
            or not name.strip()
            or len(name) > 120
            or not isinstance(description, str)
            or len(description) > 1000
            or not isinstance(nodes, list)
            or not 2 <= len(nodes) <= _MAX_NODES
            or not isinstance(edges, list)
            or len(edges) > _MAX_NODES * 3
        ):
            raise ValueError("Workflow fields are invalid.")

        normalized_nodes = []
        node_ids = set()
        for node in nodes:
            if not isinstance(node, dict):
                raise ValueError("Workflow nodes must be objects.")
            node_id = node.get("id")
            node_type = node.get("type")
            title = node.get("title")
            x = node.get("x")
            y = node.get("y")
            config = node.get("config", {})
            if (
                not isinstance(node_id, str)
                or not _NODE_ID.fullmatch(node_id)
                or node_id in node_ids
                or not isinstance(node_type, str)
                or node_type not in _NODE_TYPES
                or not isinstance(title, str)
                or not title.strip()
                or len(title) > 120
                or isinstance(x, bool)
                or isinstance(y, bool)
                or not isinstance(x, (int, float))
                or not isinstance(y, (int, float))
                or not math.isfinite(x)
                or not math.isfinite(y)
                or not -_POSITION_LIMIT <= x <= _POSITION_LIMIT
                or not -_POSITION_LIMIT <= y <= _POSITION_LIMIT
                or not isinstance(config, dict)
            ):
                raise ValueError("Workflow node fields are invalid.")
            self._validate_node_config(node_type, config)
            normalized_nodes.append({
                "id": node_id,
                "type": node_type,
                "title": title.strip(),
                "x": x,
                "y": y,
                "config": config,
            })
            node_ids.add(node_id)

        triggers = [node for node in normalized_nodes if node["type"] == "trigger"]
        outputs = [node for node in normalized_nodes if node["type"] == "output"]
        if len(triggers) != 1 or not outputs:
            raise ValueError("Workflow must have exactly one trigger and at least one output.")

        normalized_edges = []
        edge_ids = set()
        edge_pairs = set()
        outgoing: dict[str, list[dict[str, Any]]] = {
            node_id: [] for node_id in node_ids
        }
        incoming: dict[str, list[dict[str, Any]]] = {
            node_id: [] for node_id in node_ids
        }
        for edge in edges:
            if not isinstance(edge, dict):
                raise ValueError("Workflow connections must be objects.")
            edge_id = edge.get("id")
            source = edge.get("source")
            target = edge.get("target")
            label = edge.get("label", "")
            if (
                not isinstance(edge_id, str)
                or not _NODE_ID.fullmatch(edge_id)
                or edge_id in edge_ids
                or not isinstance(source, str)
                or source not in node_ids
                or not isinstance(target, str)
                or target not in node_ids
                or source == target
                or not isinstance(label, str)
                or len(label) > 32
                or (source, target) in edge_pairs
            ):
                raise ValueError("Workflow connection fields are invalid.")
            normalized = {
                "id": edge_id,
                "source": source,
                "target": target,
                "label": label,
            }
            normalized_edges.append(normalized)
            outgoing[source].append(normalized)
            incoming[target].append(normalized)
            edge_ids.add(edge_id)
            edge_pairs.add((source, target))

        for node in normalized_nodes:
            if node["type"] == "condition":
                labels = [
                    edge["label"].casefold() for edge in outgoing[node["id"]]
                ]
                if len(labels) != 2 or set(labels) != {"true", "false"}:
                    raise ValueError(
                        "Condition nodes require exactly one 'true' and one 'false' connection."
                    )
                if len({edge["target"] for edge in outgoing[node["id"]]}) != 2:
                    raise ValueError("Condition branches must target different nodes.")
                if (
                    node["config"]["source"] not in node_ids
                    or node["config"]["source"] == node["id"]
                ):
                    raise ValueError("Condition node references an unknown source.")
                if not any(
                    edge["source"] == node["config"]["source"]
                    and edge["target"] == node["id"]
                    for edge in normalized_edges
                ):
                    raise ValueError("Condition source must be connected to the condition node.")
            if node["type"] == "output" and node["config"].get("source") not in {
                None,
                *node_ids,
            }:
                raise ValueError("Output node references an unknown source.")
            if (
                node["type"] == "output"
                and node["config"].get("source") == node["id"]
            ):
                raise ValueError("Output nodes cannot reference themselves.")
            if node["type"] == "trigger" and incoming[node["id"]]:
                raise ValueError("The workflow trigger cannot have incoming connections.")
            if node["type"] == "output" and outgoing[node["id"]]:
                raise ValueError("Output nodes cannot have outgoing connections.")

        self._validate_graph(triggers[0]["id"], normalized_nodes, outgoing)
        normalized_workflow = {
            "id": identifier,
            "name": name.strip(),
            "description": description.strip(),
            "nodes": normalized_nodes,
            "edges": normalized_edges,
            "updated_at": workflow.get(
                "updated_at", datetime.now(timezone.utc).isoformat()
            ),
        }
        try:
            encoded = json.dumps(
                normalized_workflow,
                ensure_ascii=False,
                allow_nan=False,
            ).encode("utf-8")
        except (TypeError, ValueError) as error:
            raise ValueError("Workflow contains values that cannot be stored.") from error
        if len(encoded) > _MAX_WORKFLOW_BYTES:
            raise ValueError("Workflow exceeds the 512 KiB size limit.")
        return normalized_workflow

    def _validate_node_config(self, node_type: str, config: dict[str, Any]) -> None:
        if node_type == "tool":
            action = config.get("action")
            params = config.get("params", {})
            if not isinstance(action, str) or not action or not isinstance(params, dict):
                raise ValueError("Tool nodes require an action name and parameter object.")
            if self.tool_registry is not None:
                known_tools = {
                    tool["name"] for tool in self.get_tool_options()
                }
                if action not in known_tools:
                    raise ValueError(f"Workflow references unavailable tool '{action}'.")
        elif node_type == "agent":
            role = config.get("role", "main")
            task = config.get("task", "")
            profile_id = config.get("profile_id")
            if (
                not isinstance(role, str)
                or not role
                or len(role) > 40
                or not isinstance(task, str)
                or len(task) > 2000
                or (
                    profile_id is not None
                    and (
                        not isinstance(profile_id, str)
                        or len(profile_id) > 80
                    )
                )
            ):
                raise ValueError("Agent nodes require a role and task description.")
        elif node_type == "capability":
            capability = config.get("capability")
            if not isinstance(capability, str) or not re.fullmatch(
                r"[a-z0-9][a-z0-9_-]{0,63}",
                capability,
            ):
                raise ValueError("Capability nodes require a valid capability id.")
            if self.tool_registry is not None and capability not in {
                item["id"] for item in self.get_capability_options()
            }:
                raise ValueError(f"Workflow references unavailable capability '{capability}'.")
        elif node_type == "condition":
            source = config.get("source")
            operator = config.get("operator")
            path = config.get("path", [])
            if (
                not isinstance(source, str)
                or not _NODE_ID.fullmatch(source)
                or not isinstance(operator, str)
                or operator not in _CONDITION_OPERATORS
                or not isinstance(path, list)
                or any(not isinstance(part, (str, int)) for part in path)
                or len(path) > 16
            ):
                raise ValueError("Condition node configuration is invalid.")
        elif node_type == "output":
            source = config.get("source")
            if source is not None and (
                not isinstance(source, str) or not _NODE_ID.fullmatch(source)
            ):
                raise ValueError("Output node source is invalid.")

    @staticmethod
    def _validate_graph(
        trigger_id: str,
        nodes: list[dict[str, Any]],
        outgoing: dict[str, list[dict[str, Any]]],
    ) -> None:
        visited = set()
        active = set()

        def visit(node_id: str) -> None:
            if node_id in active:
                raise ValueError("Workflow connections cannot contain cycles.")
            if node_id in visited:
                return
            active.add(node_id)
            for edge in outgoing[node_id]:
                visit(edge["target"])
            active.remove(node_id)
            visited.add(node_id)

        visit(trigger_id)
        if len(visited) != len(nodes):
            raise ValueError("Every workflow node must be reachable from its trigger.")
