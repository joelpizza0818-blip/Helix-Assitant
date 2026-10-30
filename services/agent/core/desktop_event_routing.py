def select_desktop_event_recipients(
    event_name: str,
    payload: dict,
    clients: set,
    conversation_clients: dict[str, set],
) -> set:
    if event_name not in {"BROWSER_FRAME", "DESKTOP_FRAME"}:
        return clients.copy()
    conversation_id = payload.get("conversation_id")
    if not isinstance(conversation_id, str):
        device_id = payload.get("source_device_id")
        if isinstance(device_id, str):
            conversation_id = f"mobile_{device_id}"
        else:
            return set()
    return conversation_clients.get(conversation_id, set()).copy()
