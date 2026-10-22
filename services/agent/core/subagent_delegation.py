def configure_subagent_delegation(settings, key_manager, tool_registry, delegate_task_tool):
    # Child agents reuse the active provider session in the managed runtime.
    enabled = isinstance(settings, dict) and settings.get("subagents_enabled") is True
    if enabled:
        tool_registry.register_tool(delegate_task_tool, source="native")
    else:
        tool_registry.unregister_tool(delegate_task_tool.name)
    return enabled


def safe_subagent_lifecycle_payload(payload):
    """Expose lifecycle state without prompts, results, errors, or credentials."""
    safe = {
        key: payload.get(key)
        for key in (
            "agent_id", "parent_id", "role", "status",
            "created_at", "started_at", "completed_at",
        )
        if key in payload
    }
    if payload.get("result") is not None:
        safe["has_result"] = True
    if payload.get("error") is not None:
        safe["failed"] = True
    return safe
