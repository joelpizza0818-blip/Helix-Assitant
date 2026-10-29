def configure_subagent_delegation(
    settings,
    key_manager,
    tool_registry,
    delegate_task_tool,
    message_subagent_tool=None,
    promote_subagent_tool=None,
):
    # Child agents reuse the active provider session in the managed runtime.
    enabled = isinstance(settings, dict) and settings.get("subagents_enabled") is True
    if enabled:
        tool_registry.register_tool(delegate_task_tool, source="native")
        if message_subagent_tool is not None:
            tool_registry.register_tool(message_subagent_tool, source="native")
        if promote_subagent_tool is not None:
            tool_registry.register_tool(promote_subagent_tool, source="native")
    else:
        tool_registry.unregister_tool(delegate_task_tool.name)
        if message_subagent_tool is not None:
            tool_registry.unregister_tool(message_subagent_tool.name)
        if promote_subagent_tool is not None:
            tool_registry.unregister_tool(promote_subagent_tool.name)
    return enabled


def safe_subagent_lifecycle_payload(payload):
    """Expose lifecycle state without prompts, results, errors, or credentials."""
    safe = {
        key: payload.get(key)
        for key in (
            "agent_id", "parent_id", "role", "status",
            "task_id", "resource", "profile_id", "name", "color",
            "promotion", "created_at", "started_at", "completed_at",
        )
        if key in payload
    }
    if payload.get("result") is not None:
        safe["has_result"] = True
    if payload.get("error") is not None:
        safe["failed"] = True
    return safe
