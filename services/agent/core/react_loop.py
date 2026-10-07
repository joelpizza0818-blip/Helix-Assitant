import asyncio
import logging
import json
import uuid
from datetime import datetime, timezone
from typing import List

try:
    from services.agent.ai.base_provider import ChatMessage, ChatResponse
except ImportError:
    pass

logger = logging.getLogger(__name__)

class ReActLoop:
    def __init__(self, provider_registry, model_router, fallback_manager, 
                 tool_registry, key_manager, event_bus, role_config):
        self.provider_registry = provider_registry
        self.model_router = model_router
        self.fallback_manager = fallback_manager
        self.tool_registry = tool_registry
        self.key_manager = key_manager
        self.event_bus = event_bus
        self.role_config = role_config
        self._pending_confirmations = {}

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
                        arguments, ensure_ascii=False, sort_keys=True
                    ),
                    "why": "This tool requires your explicit approval before it can run.",
                    "level": permission_level,
                },
            )
            return await asyncio.wait_for(future, timeout=60)
        finally:
            self._pending_confirmations.pop(request_id, None)
            await self.event_bus.publish(
                "CONFIRMATION_RESOLVED",
                {"request_id": request_id, "task_id": task_id},
            )

    async def execute(self, messages: List['ChatMessage'], role: str = 'main',
                      max_iterations: int = 10, task_id: str = None) -> 'ChatResponse':
        await self._ensure_confirmation_subscriptions()
        assignment = self.role_config.get_assignment(role)
        requirements = assignment.requirements
        requirements.tool_calling = True
        
        iteration = 0
        current_messages = list(messages)
        provider_context = {
            "messages": current_messages,
            "_execution_failed_models": set(),
            "_execution_failed_keys": set(),
        }
        
        while iteration < max_iterations:
            iteration += 1
            await self.event_bus.publish("REACT_STEP", {"iteration": iteration, "task_id": task_id, "role": role})
            
            async def provider_call(candidate, context):
                provider = self.provider_registry.get_provider(candidate.provider_id)
                tools = self.tool_registry.get_tool_schemas()
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
                    if tool:
                        confirmed = not tool.requires_confirmation
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
                                output = (
                                    result.output
                                    if result.success
                                    else f"Error: {result.error}"
                                )
                            except Exception as e:
                                output = f"Execution Exception: {str(e)}"
                    else:
                        output = f"Error: Tool {tc.name} not found."
                    
                    await self.event_bus.publish(
                        "TOOL_EXECUTED",
                        {
                            "tool": tc.name,
                            "task_id": task_id,
                            "success": tool_succeeded,
                        },
                    )
                    
                    current_messages.append(ChatMessage(
                        role="tool",
                        content=str(output),
                        tool_call_id=tc.id,
                        tool_name=tc.name,
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
