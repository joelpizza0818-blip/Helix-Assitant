import asyncio
import logging
import json
import uuid
import inspect
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from typing import List

try:
    from services.agent.ai.base_provider import ChatMessage, ChatResponse
except ImportError:
    pass

logger = logging.getLogger(__name__)
CONFIRMATION_TIMEOUT_SECONDS = 300
_SHELL_TOOL_NAMES = {"shell_tool", "cmd_tool", "powershell_tool"}
_SHELL_OUTPUT_LIMIT = 600


def _model_tool_output(tool_name: str, output) -> str:
    if tool_name not in _SHELL_TOOL_NAMES:
        return str(output)
    if is_dataclass(output) and not isinstance(output, type):
        output = asdict(output)
    serialized = (
        json.dumps(output, ensure_ascii=False, default=str)
        if isinstance(output, (dict, list, tuple))
        else str(output)
    )
    if len(serialized) <= _SHELL_OUTPUT_LIMIT:
        return serialized
    marker = "[... Output truncated ...]"
    return serialized[:_SHELL_OUTPUT_LIMIT - len(marker)] + marker

try:
    from .task_manager import _safe_text
except ImportError:
    from core.task_manager import _safe_text


def _safe_confirmation_value(value):
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]"
            if any(token in str(key).casefold() for token in ("key", "token", "secret", "password", "authorization", "credential"))
            else _safe_confirmation_value(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_safe_confirmation_value(item) for item in value]
    return _safe_text(value, 240)

class ReActLoop:
    def __init__(self, provider_registry, model_router, fallback_manager, 
                 tool_registry, key_manager, event_bus, role_config,
                 permission_manager=None):
        self.provider_registry = provider_registry
        self.model_router = model_router
        self.fallback_manager = fallback_manager
        self.tool_registry = tool_registry
        self.key_manager = key_manager
        self.event_bus = event_bus
        self.role_config = role_config
        self.permission_manager = permission_manager
        self._pending_confirmations = {}
        self.auto_approve_up_to = "LOW_RISK"
        self.permissions_mode = "SMART_APPROVAL"

    async def _ensure_confirmation_subscriptions(self):
        subscribe = getattr(self.event_bus, "subscribe", None)
        if subscribe is not None:
            await subscribe("CONFIRMATION_GRANTED", self._handle_confirmation_event)
            await subscribe("CONFIRMATION_REJECTED", self._handle_confirmation_event)

    async def _handle_confirmation_event(self, event_name, payload):
        request_id = payload.get("request_id")
        future = self._pending_confirmations.get(request_id)
        if future and not future.done():
            future.set_result(event_name == "CONFIRMATION_GRANTED")

    async def _request_tool_confirmation(self, tool, arguments, task_id):
        request_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self._pending_confirmations[request_id] = future
        permission_level = str(tool.permission_level)
        if permission_level == "MODERATE":
            permission_level = "MODIFY"
        try:
            await self.event_bus.publish(
                "WAIT_CONFIRMATION",
                {
                    "id": request_id,
                    "task_id": task_id,
                    "action": tool.name,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "what_will_change": json.dumps(
                        _safe_confirmation_value(arguments),
                        ensure_ascii=False,
                        sort_keys=True,
                    ),
                    "why": "This tool requires your explicit approval before it can run.",
                    "level": permission_level,
                },
            )
            return await asyncio.wait_for(future, timeout=CONFIRMATION_TIMEOUT_SECONDS)
        finally:
            self._pending_confirmations.pop(request_id, None)
            await self.event_bus.publish(
                "CONFIRMATION_RESOLVED",
                {"request_id": request_id, "task_id": task_id},
            )

    async def execute(self, messages: List['ChatMessage'], role: str = 'main',
                      max_iterations: int = 10, task_id: str = None,
                      preferred_tool_names: List[str] = None) -> 'ChatResponse':
        await self._ensure_confirmation_subscriptions()
        assignment = self.role_config.get_assignment(role)
        requirements = assignment.requirements
        requirements.tool_calling = True
        
        iteration = 0
        current_messages = list(messages)
        requirements.vision = requirements.vision or any(
            message.image_bytes for message in current_messages
        )
        provider_context = {
            "messages": current_messages,
            "_execution_failed_models": set(),
            "_execution_failed_keys": set(),
            "_helix_task_id": task_id,
        }
        
        while iteration < max_iterations:
            iteration += 1
            await self.event_bus.publish("REACT_STEP", {"iteration": iteration, "task_id": task_id, "role": role})
            
            async def provider_call(candidate, context):
                provider = self.provider_registry.get_provider(candidate.provider_id)
                request_text = "\n".join(
                    message.content
                    for message in current_messages[-8:]
                    if message.role == "user" and isinstance(message.content, str)
                )
                schemas_getter = self.tool_registry.get_tool_schemas
                schema_parameters = inspect.signature(schemas_getter).parameters
                supports_routing = "query" in schema_parameters or any(
                    parameter.kind == inspect.Parameter.VAR_KEYWORD
                    for parameter in schema_parameters.values()
                )
                if supports_routing:
                    tools = schemas_getter(
                        query=request_text,
                        preferred_tool_names=preferred_tool_names,
                    )
                else:
                    tools = schemas_getter()
                api_key = self.key_manager.get_key(candidate.provider_id, candidate.key_slot)
                if not api_key:
                    raise RuntimeError(
                        f"No API key is available for {candidate.provider_id} slot {candidate.key_slot}."
                    )
                if tools:
                    return await provider.tool_call(
                        context['messages'],
                        tools,
                        candidate.model_id,
                        api_key=api_key,
                    )
                else:
                    return await provider.chat(
                        context['messages'],
                        candidate.model_id,
                        api_key=api_key,
                    )

            provider_context["messages"] = current_messages
            response = await self.fallback_manager.execute_with_fallback(
                provider_call,
                requirements,
                provider_context,
            )

            if hasattr(response, 'tool_calls') and response.tool_calls:
                current_messages.append(ChatMessage(
                    role="assistant",
                    content=response.content or "",
                    tool_calls=[
                        {
                            "id": tc.id,
                            "name": tc.name,
                            "arguments": tc.arguments,
                        }
                        for tc in response.tool_calls
                    ],
                    provider_data=getattr(response, "provider_data", None),
                ))
                
                for tc in response.tool_calls:
                    tool = self.tool_registry.get_tool(tc.name)
                    tool_succeeded = False
                    image_bytes = None
                    if tool:
                        permission_ranks = {
                            "READ_ONLY": 0,
                            "LOW_RISK": 1,
                            "MODIFY": 2,
                            "EXECUTE": 3,
                            "SYSTEM": 4,
                            "CRITICAL": 5,
                        }
                        # Third-party and test tools may omit an explicit
                        # permission declaration; treat them as read-only
                        # until their arguments prove otherwise.
                        permission_level = str(getattr(tool, "permission_level", "READ_ONLY")).upper()
                        rank = permission_ranks.get(permission_level, 4)
                        approval_ceiling = permission_ranks.get(
                            self.auto_approve_up_to,
                            permission_ranks["LOW_RISK"],
                        )
                        requires_confirmation = (
                            tool.requires_confirmation or rank >= permission_ranks["EXECUTE"]
                        )
                        risk_requires_confirmation = False
                        if self.permission_manager is not None:
                            evaluation = self.permission_manager.evaluate_risk(
                                tool.name, tc.arguments, permission_level
                            )
                            permission_level = evaluation.level.name
                            rank = permission_ranks.get(permission_level, rank)
                            requires_confirmation = (
                                tool.requires_confirmation or evaluation.requires_confirmation
                            )
                            risk_requires_confirmation = evaluation.requires_confirmation
                        elif self.permissions_mode == "ALWAYS_ASK":
                            requires_confirmation = True
                        elif self.permissions_mode == "AUTO_APPROVE":
                            requires_confirmation = (
                                tool.requires_confirmation
                                or rank >= permission_ranks["SYSTEM"]
                            )
                        # A tool's explicit confirmation requirement must not
                        # be bypassed just because its declared risk tier is
                        # below the user's auto-approval ceiling.
                        confirmed = not requires_confirmation or (
                            not tool.requires_confirmation
                            and not risk_requires_confirmation
                            and self.permissions_mode != "ALWAYS_ASK"
                            and rank <= approval_ceiling
                        )
                        output = None
                        if not confirmed:
                            try:
                                confirmed = await self._request_tool_confirmation(
                                    tool, tc.arguments, task_id
                                )
                            except asyncio.TimeoutError:
                                confirmed = False
                                output = "Action not run: confirmation timed out."
                            if not confirmed and output is None:
                                output = "Action not run: confirmation was rejected."

                        if confirmed:
                            try:
                                if not tool.validate_params(tc.arguments):
                                    raise ValueError(
                                        f"Invalid parameters for tool {tc.name}."
                                    )
                                result = await tool.execute(tc.arguments)
                                tool_succeeded = result.success
                                output = result.output if result.success else f"Error: {result.error}"
                                if isinstance(output, dict):
                                    image_bytes = output.pop("screenshot_bytes", None)
                                    if image_bytes:
                                        requirements.vision = True
                                    output = json.dumps(output, ensure_ascii=False, default=str)
                            except Exception as e:
                                output = f"Execution Exception: {str(e)}"
                                image_bytes = None
                    else:
                        output = f"Error: Tool {tc.name} not found."
                    
                    await self.event_bus.publish(
                        "TOOL_EXECUTED",
                        {
                            "tool": tc.name,
                            "task_id": task_id,
                            "success": tool_succeeded,
                            # Keep execution events safe for renderer subscribers:
                            # the actual tool output may contain private context.
                            "result_summary": (
                                "Tool returned a result."
                                if tool_succeeded
                                else "Tool did not complete successfully."
                            ),
                        },
                    )
                    
                    current_messages.append(ChatMessage(
                        role="tool",
                        content=_model_tool_output(tc.name, output),
                        tool_call_id=tc.id,
                        tool_name=tc.name,
                    ))
                    if tool_succeeded and image_bytes:
                        current_messages.append(ChatMessage(
                            role="user",
                            content=f"Screen captured after {tc.name}. Use this to verify the result before continuing.",
                            image_bytes=image_bytes,
                        ))
            else:
                if not isinstance(response, ChatResponse):
                    response = ChatResponse(
                        content=response.content,
                        model=response.model,
                        provider=response.provider,
                        usage=getattr(response, 'usage', None),
                        finish_reason="stop"
                    )
                return response
                
        raise RuntimeError(
            f"Model did not finish the tool-call cycle within {max_iterations} iterations."
        )
