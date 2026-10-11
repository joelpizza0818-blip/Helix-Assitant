MCP_URL_UNSUPPORTED_ERROR = (
    "URL-based MCP servers are not supported; configure a local stdio launch command."
)


def _desired_mcp_servers(server_configs: list[dict]) -> dict[str, str]:
    return {
        config["name"]: config["command"]
        for config in server_configs
        if isinstance(config, dict)
        and "url" not in config
        and "server_url" not in config
        and config.get("enabled", True) is True
        and isinstance(config.get("name"), str)
        and isinstance(config.get("command"), str)
        and config["name"].strip()
        and config["command"].strip()
    }


def _mcp_server_statuses(
    server_configs: list[dict],
    active_servers: dict[str, str],
    connecting_servers: set[str],
    server_errors: dict[str, str],
    tools_cache: dict[str, list],
) -> list[dict]:
    statuses = []
    for config in server_configs:
        if not isinstance(config, dict):
            continue
        name = config.get("name")
        if not isinstance(name, str):
            continue

        unsupported_url = "url" in config or "server_url" in config
        enabled = config.get("enabled", True) is True
        if unsupported_url:
            status = "unsupported"
            error = MCP_URL_UNSUPPORTED_ERROR
        elif not enabled:
            status = "disabled"
            error = None
        elif name in connecting_servers:
            status = "connecting"
            error = None
        elif name in active_servers:
            status = "connected"
            error = None
        elif name in server_errors:
            status = "error"
            error = server_errors[name]
        else:
            status = "pending"
            error = None

        item = {
            "name": name,
            "enabled": enabled,
            "status": status,
            "tool_count": len(tools_cache.get(name, [])),
            "error": error,
        }
        if not unsupported_url and isinstance(config.get("command"), str):
            item["command"] = config["command"]
        statuses.append(item)
    return statuses
