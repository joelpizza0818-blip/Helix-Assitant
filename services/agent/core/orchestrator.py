import asyncio

try:
    from services.agent.tools.context_retrieve_tool import ContextRetrieveTool
    from services.agent.core.task_checkpoint_store import TaskCheckpointStore
    from services.agent.core.conversation_execution import ConversationExecutionMixin
    from services.agent.core.task_lifecycle import TaskLifecycleMixin
    from services.agent.core.task_routing import TaskRoutingMixin
    from services.agent.core.workflow_execution import WorkflowExecutionMixin
    from services.agent.core.workflow_recovery import WorkflowRecoveryMixin
except ImportError:
    from tools.context_retrieve_tool import ContextRetrieveTool
    from core.task_checkpoint_store import TaskCheckpointStore
    from core.conversation_execution import ConversationExecutionMixin
    from core.task_lifecycle import TaskLifecycleMixin
    from core.task_routing import TaskRoutingMixin
    from core.workflow_execution import WorkflowExecutionMixin
    from core.workflow_recovery import WorkflowRecoveryMixin

# Preserve the helper import surface used by existing integrations and tests.
try:
    from services.agent.core.orchestrator_content import (
        compact_conversation_history as _compact_conversation_history,
        extract_attachment_text as _extract_attachment_text,
        resolve_plan_value as _resolve_plan_value,
    )
    from services.agent.core.orchestrator_intents import (
        _append_requested_screen_observation,
        _conversation_failure_message,
        _fast_os_answer,
        _should_control_desktop,
        _should_observe_screen,
        _requires_desktop_control_tool,
    )
except ImportError:
    from core.orchestrator_content import (
        compact_conversation_history as _compact_conversation_history,
        extract_attachment_text as _extract_attachment_text,
        resolve_plan_value as _resolve_plan_value,
    )
    from core.orchestrator_intents import (
        _append_requested_screen_observation,
        _conversation_failure_message,
        _fast_os_answer,
        _should_control_desktop,
        _should_observe_screen,
        _requires_desktop_control_tool,
    )


class Orchestrator(
    WorkflowExecutionMixin,
    WorkflowRecoveryMixin,
    TaskLifecycleMixin,
    TaskRoutingMixin,
    ConversationExecutionMixin,
):
    """Coordinate planning, workflow recovery, and task conversations."""

    def __init__(
        self,
        planner,
        task_manager,
        event_bus,
        react_loop,
        agent_manager,
        tool_registry,
        role_config,
        memory_manager=None,
        checkpoint_store: TaskCheckpointStore | None = None,
        project_memory_store=None,
        workflow_store=None,
    ):
        """Wire agent services and register context retrieval when available."""
        self.planner = planner
        self.task_manager = task_manager
        self.event_bus = event_bus
        self.react_loop = react_loop
        self.agent_manager = agent_manager
        self.tool_registry = tool_registry
        self.role_config = role_config
        self.memory_manager = memory_manager
        self.checkpoint_store = checkpoint_store
        self.project_memory_store = project_memory_store
        self.workflow_store = workflow_store
        self.continuous_screen_context_provider = None
        self._active_execution_ids = set()
        self._execution_lock = asyncio.Lock()
        # Register CCL context retrieval so compressed blocks can be hydrated per task.
        try:
            if tool_registry is not None and not tool_registry.get_tool("context_retrieve"):
                tool_registry.register_tool(ContextRetrieveTool(session_id="orchestrator"))
        except Exception:
            pass  # The tool is optional in lightweight test environments.
