import logging
from datetime import datetime, timezone

try:
    from services.agent.ai.base_provider import ChatMessage
    from services.agent.core.task_manager import TaskStatus, _safe_text
except ImportError:
    from ai.base_provider import ChatMessage
    from core.task_manager import TaskStatus, _safe_text

logger = logging.getLogger(__name__)


class TaskRoutingMixin:
    """Route incoming tasks to saved-workflow, conversation, or direct execution."""

    async def _execute_task(self, task_id: str, description: str, context: dict = None):
        """Initialize a task, then route it to the matching execution path."""
        await self.task_manager.update_status(task_id, TaskStatus.RUNNING)
        await self.event_bus.publish("ORCHESTRATION_STARTED", {"task_id": task_id})

        context = context or {}

        # CCL blocks are scoped to the active task. Keep retrieval on the same
        # session instead of using the registration-time placeholder session.
        context_retrieve = (
            self.tool_registry.get_tool("context_retrieve")
            if self.tool_registry is not None
            else None
        )
        if context_retrieve is not None and hasattr(context_retrieve, "_session_id"):
            context_retrieve._session_id = task_id

        workflow = context.get("workflow_definition")
        if workflow is not None:
            return await self._execute_saved_workflow_task(
                task_id, description, context, workflow
            )
        if context.get("input_source") in {"voice", "text"}:
            return await self._execute_conversation_task(
                task_id, description, context
            )
        return await self._execute_direct_task(task_id, description, context)

    async def _execute_saved_workflow_task(
        self, task_id: str, description: str, context: dict, workflow: dict
    ) -> dict:
        """Execute a saved workflow and publish its result or failure."""
        try:
            if self.workflow_store is None or not isinstance(workflow, dict):
                raise RuntimeError("Saved workflow execution is unavailable.")
            workflow_input = (
                context.get("workflow_input")
                or workflow.get("description")
                or workflow.get("name")
                or description
            )
            if not isinstance(workflow_input, str):
                raise ValueError("Workflow input must be text.")
            plan = self.workflow_store.to_plan(workflow, workflow_input)
            workflow_result = await self._execute_workflow_plan(
                task_id,
                plan,
                screen_request_active=bool(context.get("screen_request_active")),
                task_description=workflow_input,
                conversation_id=context.get("conversation_id"),
                source_device_id=context.get("source_device_id"),
            )
        except Exception as error:
            logger.exception("Workflow execution failed for task %s.", task_id)
            message = (
                "No pude completar el workflow. Verifica sus pasos e "
                "inténtalo de nuevo."
            )
            if hasattr(self.task_manager, "set_result"):
                await self.task_manager.set_result(
                    task_id,
                    error=message,
                )
            await self.task_manager.update_status(task_id, TaskStatus.FAILED)
            await self.event_bus.publish(
                "AGENT_MESSAGE",
                {
                    "task_id": task_id,
                    "role": "assistant",
                    "content": message,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "conversation_id": context.get("conversation_id"),
                },
            )
            await self.event_bus.publish(
                "ORCHESTRATION_FAILED",
                {
                    "task_id": task_id,
                    "workflow_id": context.get("workflow_id"),
                    "conversation_id": context.get("conversation_id"),
                    "error": type(error).__name__,
                },
            )
            return {
                "status": "failed",
                "error": message,
            }
        if workflow_result.get("status") == "cancelled":
            await self.task_manager.update_status(task_id, TaskStatus.CANCELLED)
            return workflow_result
        report = "\n".join(
            f"{step_id} ({result.get('status', 'unknown')}): "
            f"{_safe_text(result.get('output', ''), 1000)}"
            for step_id, result in workflow_result.get("steps", {}).items()
        )
        succeeded = workflow_result.get("status") == "completed"
        if hasattr(self.task_manager, "set_result"):
            await self.task_manager.set_result(
                task_id,
                result=report if succeeded else None,
                error=None if succeeded else _safe_text(report, 500),
            )
        await self.task_manager.update_status(
            task_id,
            TaskStatus.COMPLETED if succeeded else TaskStatus.FAILED,
        )
        if succeeded:
            await self.event_bus.publish(
                "AGENT_MESSAGE",
                {
                    "task_id": task_id,
                    "role": "assistant",
                    "content": report,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "provider": "workflow",
                    "model": workflow.get("name", "workflow"),
                    "conversation_id": context.get("conversation_id"),
                },
            )
        await self.event_bus.publish(
            "ORCHESTRATION_COMPLETED" if succeeded else "ORCHESTRATION_FAILED",
            {
                "task_id": task_id,
                "response": report,
                "workflow_id": context.get("workflow_id"),
                "conversation_id": context.get("conversation_id"),
            },
        )
        return workflow_result

    async def _execute_direct_task(
        self, task_id: str, description: str, context: dict
    ) -> dict:
        """Execute a non-conversation request as a workflow or one direct model call."""
        workflow_result = None
        try:
            if getattr(self.react_loop, "complex_workflows_enabled", False):
                plan = await self.planner.create_plan(description, context)
                if len(plan.steps) > 1:
                    workflow_result = await self._execute_workflow_plan(
                        task_id,
                        plan,
                        screen_request_active=False,
                        conversation_id=context.get("conversation_id"),
                        source_device_id=context.get("source_device_id"),
                    )
            if workflow_result is None:
                response = await self.react_loop.execute(
                    [ChatMessage(role="user", content=description)],
                    role="main",
                    task_id=task_id,
                    conversation_id=context.get("conversation_id"),
                    source_device_id=context.get("source_device_id"),
                )
                if not isinstance(response.content, str) or not response.content.strip():
                    raise ValueError("The model returned an empty response.")
                if hasattr(self.task_manager, "set_result"):
                    await self.task_manager.set_result(task_id, result=response.content)
                await self.task_manager.update_status(task_id, TaskStatus.COMPLETED)
                await self.event_bus.publish(
                    "ORCHESTRATION_COMPLETED",
                    {"task_id": task_id, "response": response.content},
                )
                return {
                    "status": "completed",
                    "task_id": task_id,
                    "response": response.content,
                }
        except Exception as error:
            logger.exception("Task %s failed during execution", task_id)
            if hasattr(self.task_manager, "set_result"):
                await self.task_manager.set_result(
                    task_id,
                    result=None,
                    error=f"Task failed ({type(error).__name__}).",
                )
            await self.task_manager.update_status(task_id, TaskStatus.FAILED)
            await self.event_bus.publish(
                "ORCHESTRATION_FAILED",
                {"task_id": task_id, "error": type(error).__name__},
            )
            return {
                "status": "failed",
                "task_id": task_id,
                "error": type(error).__name__,
            }
        if workflow_result["status"] == "cancelled":
            await self.task_manager.update_status(task_id, TaskStatus.CANCELLED)
            await self.event_bus.publish(
                "ORCHESTRATION_CANCELLED",
                {"task_id": task_id, "results": workflow_result["steps"]},
            )
            return {"status": "cancelled", "task_id": task_id}
        report = self._workflow_report(workflow_result)
        completed = workflow_result["status"] == "completed"
        if hasattr(self.task_manager, "set_result"):
            await self.task_manager.set_result(
                task_id,
                result=report,
                error=None if completed else "Workflow steps failed.",
            )
        await self.task_manager.update_status(
            task_id,
            TaskStatus.COMPLETED if completed else TaskStatus.FAILED,
        )
        await self.event_bus.publish(
            "ORCHESTRATION_COMPLETED" if completed else "ORCHESTRATION_FAILED",
            {"task_id": task_id, "results": workflow_result["steps"]},
        )
        return {
            "status": workflow_result["status"],
            "task_id": task_id,
            "results": workflow_result["steps"],
        }
