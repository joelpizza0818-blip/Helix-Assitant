from services.agent.core.desktop_event_routing import (
    select_desktop_event_recipients,
)


def test_browser_frames_only_reach_clients_registered_for_the_conversation():
    cli_client = object()
    mobile_client = object()
    unrelated_client = object()
    clients = {cli_client, mobile_client, unrelated_client}
    conversation_clients = {
        "cli_conv_1": {cli_client},
        "mobile_device_1": {mobile_client},
    }

    recipients = select_desktop_event_recipients(
        "BROWSER_FRAME",
        {"conversation_id": "cli_conv_1"},
        clients,
        conversation_clients,
    )

    assert recipients == {cli_client}


def test_browser_frames_without_a_conversation_have_no_recipients():
    assert select_desktop_event_recipients(
        "BROWSER_FRAME",
        {},
        {object()},
        {},
    ) == set()


def test_non_browser_events_keep_the_existing_broadcast_behavior():
    clients = {object(), object()}
    recipients = select_desktop_event_recipients(
        "AGENT_MESSAGE",
        {},
        clients,
        {},
    )

    assert recipients == clients
    assert recipients is not clients
