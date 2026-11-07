import json
import logging
import re
from typing import Any

try:
    from services.agent.core.planner import Plan, PlanStep
    from services.agent.core.task_manager import TaskStatus, _safe_text
except ImportError:
    from core.planner import Plan, PlanStep
    from core.task_manager import TaskStatus, _safe_text

logger = logging.getLogger(__name__)


class WorkflowRecoveryMixin:
    """Restore workflow checkpoints without replaying uncertain side effects."""

    async def _read_vault_context(
        self,
        *,
        task_id: str,
        task_description: str,
        failed_step: PlanStep,
        conversation_id: str | None,
        source_device_id: str | None,
    ) -> str:
        """Search the configured read-only vault for evidence before a safe workflow replan."""
        get_tools_by_source = getattr(self.tool_registry, "get_tools_by_source", None)
        if not callable(get_tools_by_source):
            return ""
        tools = get_tools_by_source("mcp")
        tools_by_name = {
            getattr(tool, "name", ""): tool
            for tool in tools
            if isinstance(getattr(tool, "name", None), str)
        }
        search_tools = [
            tool for name, tool in tools_by_name.items()
            if name.endswith("_search_notes")
        ]
        if not search_tools:
            return ""

        search_tool = search_tools[0]
        read_tool_name = search_tool.name[:-len("search_notes")] + "read_note"
        if read_tool_name not in tools_by_name:
            if hasattr(self.task_manager, "set_progress_label"):
                await self.task_manager.set_progress_label(
                    task_id,
                    "The configured vault MCP cannot read notes; changing approach using available context…",
                )
            return ""

        ignored = {
            "about", "after", "also", "and", "are", "for", "from", "help",
            "into", "that", "the", "this", "with", "workflow",
        }
        terms = [
            term for term in re.findall(r"[^\W_]{4,}", task_description, flags=re.UNICODE)
            if term.casefold() not in ignored
        ]
        query = (terms[0] if terms else failed_step.action)[:80]
        if hasattr(self.task_manager, "set_progress_label"):
            await self.task_manager.set_progress_label(
                task_id,
                "Searching the configured read-only Helix Vault before replanning…",
            )
        try:
            search = await self.react_loop.execute_planned_tool(
                search_tool.name,
                {"query": query},
                task_id=task_id,
                task_description=task_description,
                conversation_id=conversation_id,
                source_device_id=source_device_id,
            )
        except Exception:
            logger.exception("Could not search the configured Helix Vault during recovery.")
            if hasattr(self.task_manager, "set_progress_label"):
                await self.task_manager.set_progress_label(
                    task_id,
                    "Vault search failed; continuing recovery with the available task context…",
                )
            return ""
        if not getattr(search, "success", False):
            if hasattr(self.task_manager, "set_progress_label"):
                await self.task_manager.set_progress_label(
                    task_id,
                    "Vault search was unavailable or not approved; continuing recovery with the available context…",
                )
            return ""

        search_data = getattr(search, "raw_output", None)
        if isinstance(search_data, str):
            try:
                search_data = json.loads(search_data)
            except json.JSONDecodeError:
                return ""
        matches = search_data.get("matches", []) if isinstance(search_data, dict) else []
        notes = []
        for match in matches[:2] if isinstance(matches, list) else []:
            if not isinstance(match, dict) or not isinstance(match.get("path"), str):
                continue
            try:
                note = await self.react_loop.execute_planned_tool(
                    read_tool_name,
                    {"path": match["path"]},
                    task_id=task_id,
                    task_description=task_description,
                    conversation_id=conversation_id,
                    source_device_id=source_device_id,
                )
            except Exception:
                logger.exception("Could not read a Helix Vault note during recovery.")
                continue
            if not getattr(note, "success", False):
                continue
            note_data = getattr(note, "raw_output", None)
            if isinstance(note_data, str):
                try:
                    note_data = json.loads(note_data)
                except json.JSONDecodeError:
                    note_data = {"content": note_data}
            if isinstance(note_data, dict) and isinstance(note_data.get("content"), str):
                notes.append(
                    f"Note: {match['path']}\n{_safe_text(note_data['content'], 2400)}"
                )
        if not notes and hasattr(self.task_manager, "set_progress_label"):
            await self.task_manager.set_progress_label(
                task_id,
                "No readable Helix Vault notes matched; changing approach using available context…",
            )
        return "\n\n".join(notes)
    @staticmethod
    def _plan_from_checkpoint(checkpoint: dict) -> Plan:
        """Rebuild a validated workflow plan from its persisted checkpoint representation."""
        raw_steps = checkpoint.get("plan")
        if not isinstance(raw_steps, list):
            raise ValueError("Task checkpoint does not contain a workflow plan.")
        steps = []
        for raw_step in raw_steps:
            if not isinstance(raw_step, dict):
                raise ValueError("Task checkpoint contains an invalid workflow step.")
            steps.append(
                PlanStep(
                    id=raw_step["id"],
                    action=raw_step["action"],
                    params=raw_step["params"],
                    dependencies=raw_step["dependencies"],
                    when=raw_step.get("when", []),
                    run_if_any=raw_step.get("run_if_any", False),
                )
            )
        return Plan(steps)
    @staticmethod
    def _evaluate_workflow_condition(
        condition: dict,
        step_outputs: dict[str, Any],
    ) -> bool:
        """Evaluate one persisted workflow condition against completed step outputs."""
        source = step_outputs.get(condition["source"])
        for part in condition.get("path", []):
            try:
                source = source[part]
            except (KeyError, IndexError, TypeError):
                source = None
                break
        operator = condition["operator"]
        if operator == "truthy":
            return bool(source)
        if operator == "exists":
            return source is not None
        if operator == "equals":
            return source == condition.get("value")
        if operator == "contains":
            value = condition.get("value")
            return isinstance(source, (str, list, tuple, dict)) and value in source
        raise ValueError("Workflow condition operator is invalid.")
    @staticmethod
    def _workflow_output_value(
        output: dict,
        step_outputs: dict[str, Any],
        task_description: str,
    ) -> Any:
        """Resolve the configured workflow output from step data or the original input."""
        source = output.get("source")
        if source is not None:
            value = step_outputs.get(source)
            for part in output.get("path", []):
                try:
                    value = value[part]
                except (KeyError, IndexError, TypeError):
                    raise ValueError(
                        "Workflow output references a value that was not produced."
                    ) from None
            return value
        return str(output.get("value", task_description)).replace(
            "{{input}}",
            task_description,
        )
    async def _execute_workflow_agent(
        self,
        config: dict,
        *,
        task_id: str,
        task_description: str,
        conversation_id: str | None,
        step_outputs: dict[str, Any],
    ) -> SimpleNamespace:
        """Delegate one workflow step to its configured subagent and normalize its result."""
        if self.agent_manager is None:
            raise RuntimeError("Subagent execution is unavailable.")
        task = config.get("task", "").replace("{{input}}", task_description)
        handle = await self.agent_manager.delegate_task(
            task=task,
            role=config.get("role", "main"),
            parent_id=task_id,
            context={
                "workflow_input": task_description,
                "workflow_outputs": step_outputs,
                "conversation_id": conversation_id,
            },
            profile_id=config.get("profile_id"),
        )
        result = await handle
        succeeded = isinstance(result, dict) and result.get("status") == "success"
        output = result.get("result") if isinstance(result, dict) else None
        if not succeeded:
            output = result.get("error", "Workflow agent failed.") if isinstance(result, dict) else "Workflow agent returned an invalid result."
        return SimpleNamespace(
            success=succeeded,
            execution_succeeded=True,
            safe_to_retry=False,
            allow_replan=False,
            raw_output=output,
            output=_safe_text(output, 1000),
        )
    def _save_workflow_checkpoint(self, task_id: str, checkpoint: dict) -> None:
        """Persist resumable workflow state when checkpoint storage is configured."""
        if self.checkpoint_store is not None:
            self.checkpoint_store.save(task_id, checkpoint)
    def _clear_workflow_checkpoint(self, task_id: str) -> None:
        """Remove the saved checkpoint after a workflow reaches a terminal success."""
        if self.checkpoint_store is not None:
            self.checkpoint_store.delete(task_id)
    async def recover_interrupted_workflows(
        self,
        *,
        repeat_interrupted_actions: bool = False,
    ) -> list[str]:
        """Restore interrupted workflows without replaying uncertain side effects automatically."""
        if self.checkpoint_store is None:
            return []
        try:
            task_ids = self.checkpoint_store.list_task_ids()
        except Exception:
            logger.exception("Could not enumerate interrupted workflow checkpoints.")
            return []
        recovered_tasks = []
        for task_id in task_ids:
            try:
                checkpoint = self.checkpoint_store.load(task_id)
                if checkpoint is None:
                    continue
                if checkpoint.get("recovery_state") == "needs_attention":
                    logger.warning(
                        "Workflow task %s requires attention and will not be "
                        "replayed automatically.",
                        task_id,
                    )
                    await self._record_recovery_attention(task_id)
                    continue
                description = checkpoint.get("task_description")
                if not isinstance(description, str) or not description:
                    raise ValueError(
                        f"Task checkpoint for {task_id} has no task description."
                    )
                current_step = checkpoint.get("current_step")
                if (
                    isinstance(current_step, dict)
                    and current_step.get("status") in ("running", "interrupted")
                ):
                    interrupted_id = current_step.get("id")
                    plan = self._plan_from_checkpoint(checkpoint)
                    interrupted_step = next(
                        (step for step in plan.steps if step.id == interrupted_id),
                        None,
                    )
                    if interrupted_step is None:
                        raise ValueError(
                            f"Task checkpoint for {task_id} references an "
                            "unknown in-progress step."
                        )
                    step_results = dict(checkpoint.get("step_results", {}))
                    if repeat_interrupted_actions:
                        if interrupted_step.id in step_results and step_results[interrupted_step.id].get("status") != "completed":
                            del step_results[interrupted_step.id]
                        checkpoint["step_results"] = step_results
                        checkpoint["current_step"] = {
                            "id": interrupted_step.id,
                            "status": "pending",
                        }
                    else:
                        step_results[interrupted_step.id] = {
                            "action": interrupted_step.action,
                            "status": "failed",
                            "output": (
                                "Execution stopped during this action; its result is "
                                "unknown, so it was not repeated automatically."
                            ),
                        }
                        checkpoint["step_results"] = step_results
                        checkpoint["current_step"] = {
                            "id": interrupted_step.id,
                            "status": "interrupted",
                        }
                    self.checkpoint_store.save(task_id, checkpoint)
                checkpoint["recovery_state"] = "in_progress"
                self.checkpoint_store.save(task_id, checkpoint)
                existing_task = await self.task_manager.get_task(task_id)
                if existing_task is None:
                    await self.task_manager.create_task(
                        task_id,
                        description,
                        context={
                            "input_source": "recovery",
                            "conversation_id": checkpoint.get("conversation_id"),
                        },
                    )
                await self.task_manager.update_status(task_id, TaskStatus.RUNNING)
                await self.event_bus.publish(
                    "ORCHESTRATION_STARTED",
                    {"task_id": task_id, "recovered": True},
                )
                result = await self._execute_workflow_plan(
                    task_id,
                    self._plan_from_checkpoint(checkpoint),
                    checkpoint.get("screen_request_active", False),
                    checkpoint.get("vision_model_to_exclude"),
                    task_description=description,
                    conversation_id=checkpoint.get("conversation_id"),
                    source_device_id=checkpoint.get("source_device_id"),
                )
                if result["status"] == "cancelled":
                    self._clear_workflow_checkpoint(task_id)
                    await self.task_manager.update_status(
                        task_id, TaskStatus.CANCELLED
                    )
                    await self.event_bus.publish(
                        "ORCHESTRATION_CANCELLED",
                        {"task_id": task_id, "recovered": True},
                    )
                    continue
                completed = result["status"] == "completed"
                report = self._workflow_report(result)
                await self.task_manager.set_result(
                    task_id,
                    result=report,
                    error=None if completed else "Workflow steps failed.",
                )
                await self.task_manager.update_status(
                    task_id,
                    TaskStatus.COMPLETED if completed else TaskStatus.FAILED,
                )
                if completed:
                    self._clear_workflow_checkpoint(task_id)
                    recovered_tasks.append(task_id)
                await self.event_bus.publish(
                    "ORCHESTRATION_COMPLETED"
                    if completed
                    else "ORCHESTRATION_FAILED",
                    {
                        "task_id": task_id,
                        "recovered": True,
                        "results": result["steps"],
                    },
                )
                if not completed:
                    latest_checkpoint = self.checkpoint_store.load(task_id)
                    if latest_checkpoint is None:
                        latest_checkpoint = checkpoint
                    latest_checkpoint["recovery_state"] = "needs_attention"
                    self.checkpoint_store.save(task_id, latest_checkpoint)
            except Exception:
                logger.exception(
                    "Could not recover interrupted workflow task %s.",
                    task_id,
                )
                try:
                    await self._record_recovery_failure(task_id)
                except Exception:
                    logger.exception(
                        "Could not publish the recovery failure for task %s.",
                        task_id,
                    )
        return recovered_tasks
    async def resume_workflow(
        self,
        task_id: str,
        *,
        force: bool = False,
        repeat_interrupted_actions: bool = True,
    ) -> dict:
        """Resume a specific paused or interrupted workflow exactly where it left off."""
        if self.checkpoint_store is None:
            raise RuntimeError("Checkpoint store is not configured.")
        checkpoint = self.checkpoint_store.load(task_id)
        if checkpoint is None:
            raise ValueError(f"No checkpoint found for task {task_id}.")

        if checkpoint.get("recovery_state") == "needs_attention" and not force:
            raise ValueError(
                f"Task {task_id} requires attention before it can be resumed. Use force=True to resume."
            )

        description = checkpoint.get("task_description", f"Resumed task {task_id}")
        plan = self._plan_from_checkpoint(checkpoint)
        step_results = dict(checkpoint.get("step_results", {}))

        current_step = checkpoint.get("current_step")
        if isinstance(current_step, dict):
            current_id = current_step.get("id")
            if current_id and repeat_interrupted_actions:
                if current_id in step_results and step_results[current_id].get("status") != "completed":
                    del step_results[current_id]
                checkpoint["step_results"] = step_results
                checkpoint["current_step"] = {"id": current_id, "status": "pending"}

        checkpoint["recovery_state"] = "in_progress"
        self.checkpoint_store.save(task_id, checkpoint)

        existing_task = await self.task_manager.get_task(task_id)
        if existing_task is None:
            await self.task_manager.create_task(
                task_id,
                description,
                context={
                    "input_source": "resume",
                    "conversation_id": checkpoint.get("conversation_id"),
                },
            )
        await self.task_manager.update_status(task_id, TaskStatus.RUNNING)
        await self.event_bus.publish(
            "ORCHESTRATION_STARTED",
            {"task_id": task_id, "resumed": True},
        )
        result = await self._execute_workflow_plan(
            task_id,
            plan,
            checkpoint.get("screen_request_active", False),
            checkpoint.get("vision_model_to_exclude"),
            task_description=description,
            conversation_id=checkpoint.get("conversation_id"),
            source_device_id=checkpoint.get("source_device_id"),
        )
        completed = result["status"] == "completed"
        report = self._workflow_report(result)
        await self.task_manager.set_result(
            task_id,
            result=report,
            error=None if completed else "Workflow steps failed.",
        )
        await self.task_manager.update_status(
            task_id,
            TaskStatus.COMPLETED if completed else TaskStatus.FAILED,
        )
        if completed:
            self._clear_workflow_checkpoint(task_id)
        else:
            latest = self.checkpoint_store.load(task_id) or checkpoint
            latest["recovery_state"] = "needs_attention"
            self.checkpoint_store.save(task_id, latest)
        return result
    async def _record_recovery_attention(self, task_id: str) -> None:
        """Mark an interrupted workflow failed when a human must verify its side effects."""
        task = await self.task_manager.get_task(task_id)
        if task is None:
            await self.task_manager.create_task(
                task_id,
                "Interrupted workflow requires attention",
                context={"input_source": "recovery"},
            )
        await self.task_manager.set_result(
            task_id,
            result=(
                "Recovery stopped because an earlier action has an unknown "
                "result. Verify that action before deciding whether to retry."
            ),
            error="Workflow recovery requires attention.",
        )
        await self.task_manager.update_status(task_id, TaskStatus.FAILED)
        await self.event_bus.publish(
            "ORCHESTRATION_FAILED",
            {
                "task_id": task_id,
                "recovered": True,
                "error": "recovery_requires_attention",
            },
        )
    async def _record_recovery_failure(self, task_id: str) -> None:
        """Record a safe terminal failure when encrypted checkpoint recovery cannot proceed."""
        task = await self.task_manager.get_task(task_id)
        if task is None:
            await self.task_manager.create_task(
                task_id,
                "Interrupted workflow recovery failed",
                context={"input_source": "recovery"},
            )
        await self.task_manager.set_result(
            task_id,
            result=(
                "HELIX could not safely restore this workflow. Check the local "
                "agent log and verify any interrupted action before retrying."
            ),
            error="Encrypted workflow recovery failed.",
        )
        await self.task_manager.update_status(task_id, TaskStatus.FAILED)
        await self.event_bus.publish(
            "ORCHESTRATION_FAILED",
            {
                "task_id": task_id,
                "recovered": True,
                "error": "checkpoint_recovery_failed",
            },
        )
    @staticmethod
    def _workflow_report(workflow_result: dict) -> str:
        """Render workflow step outcomes as a concise user-facing report."""
        if workflow_result["status"] == "completed":
            heading = "Workflow completed:"
        else:
            heading = (
                "Workflow did not complete fully. Independent steps were handled "
                "safely; steps depending on a failure were skipped:"
            )
        lines = [heading]
        if workflow_result.get("replanned_from_step"):
            lines.append(
                "HELIX changed approach after a safe failure before that step ran."
            )
        for step_id, result in workflow_result["steps"].items():
            status = result["status"]
            summary = _safe_text(result.get("output", ""), 180)
            lines.append(
                f"- {step_id} ({result['action']}): {status}. {summary}"
            )
        return "\n".join(lines)
