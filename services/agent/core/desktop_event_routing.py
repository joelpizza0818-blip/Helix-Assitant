def select_desktop_event_recipients(
    event_name: str,
    payload: dict,
    clients: set,
    conversation_clients: dict[str, set],
) -> set:
    if event_name != "BROWSER_FRAME":
        return clients.copy()
    conversation_id = payload.get("conversation_id")
    if not isinstance(conversation_id, str):
        return set()
    return conversation_clients.get(conversation_id, set()).copy()
