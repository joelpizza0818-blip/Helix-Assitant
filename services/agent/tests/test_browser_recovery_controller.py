import pytest

from services.agent.browser.observer import BrowserObservation
from services.agent.browser.recovery_controller import BrowserRecoveryController


@pytest.mark.parametrize(
    ("error", "expected_category"),
    [
        (TimeoutError("timed out"), "timeout"),
        (PermissionError("blocked"), "policy_denied"),
        (ValueError("ambiguous selector"), "invalid_target"),
        (RuntimeError("browser closed"), "browser_state"),
        (Exception("unexpected"), "unexpected"),
    ],
)
def test_recovery_controller_classifies_without_retrying(error, expected_category):
    failure = BrowserRecoveryController.handle_failure("click", error)

    assert failure["error_category"] == expected_category
    assert failure["automatic_retry"] is False
    assert failure["action_may_have_completed"] is True
    assert "No automatic retry was attempted" in (
        BrowserRecoveryController.user_message(failure)
    )


def test_recovery_controller_preserves_last_observed_page_for_uncertain_action():
    observation = BrowserObservation(
        url="https://example.org/form",
        title="Example form",
        visible_text="",
        interactive_controls="",
    )

    failure = BrowserRecoveryController.handle_failure(
        "type", RuntimeError("field verification failed"), observation
    )

    assert failure["last_observed_page"] == {
        "url": "https://example.org/form",
        "title": "Example form",
    }
    assert "verify the current browser state before retrying" in (
        BrowserRecoveryController.user_message(failure)
    )
    assert "https://example.org/form" in BrowserRecoveryController.user_message(failure)


def test_recovery_controller_does_not_claim_mutation_for_read_only_actions():
    failure = BrowserRecoveryController.handle_failure(
        "get_content", RuntimeError("page unavailable")
    )

    assert failure["action_may_have_completed"] is False
    message = BrowserRecoveryController.user_message(failure)
    assert message.startswith("No automatic retry was attempted.")
    assert "choose a different safe strategy" in message


def test_recovery_controller_warns_close_may_have_completed():
    failure = BrowserRecoveryController.handle_failure(
        "close", RuntimeError("bridge disconnected")
    )

    assert failure["action_may_have_completed"] is True
    assert "verify the current browser state before retrying" in (
        BrowserRecoveryController.user_message(failure)
    )
