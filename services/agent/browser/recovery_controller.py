import asyncio


_ACTIONS_WITH_POSSIBLE_SIDE_EFFECTS = {
    "click",
    "click_at",
    "close",
    "double_click_at",
    "drag",
    "navigate",
    "press_key",
    "refresh",
    "scroll",
    "scroll_at",
    "type",
    "go_back",
}


class BrowserRecoveryController:
    @staticmethod
    def classify_error(error: Exception) -> str:
        if isinstance(error, (asyncio.TimeoutError, TimeoutError)) or (
            error.__class__.__name__ == "TimeoutError"
        ):
            return "timeout"
        if isinstance(error, PermissionError):
            return "policy_denied"
        if isinstance(error, ValueError):
            return "invalid_target"
        if isinstance(error, RuntimeError):
            return "browser_state"
        return "unexpected"

    @classmethod
    def handle_failure(
        cls, action: str, error: Exception, observation=None
    ) -> dict[str, object]:
        if isinstance(observation, dict):
            last_observed_page = observation
        elif observation is not None:
            last_observed_page = {
                "url": observation.url,
                "title": observation.title,
            }
        else:
            last_observed_page = None
        # A failed response does not prove the browser action failed; retrying can duplicate side effects.
        return {
            "action": action,
            "error_category": cls.classify_error(error),
            "automatic_retry": False,
            "action_may_have_completed": action in _ACTIONS_WITH_POSSIBLE_SIDE_EFFECTS,
            "last_observed_page": last_observed_page,
        }

    @staticmethod
    def user_message(failure: dict[str, object]) -> str:
        if failure["action_may_have_completed"]:
            message = (
                "No automatic retry was attempted. The action may have taken "
                "effect; verify the current browser state before retrying."
            )
        else:
            message = "No automatic retry was attempted."
        message += (
            " Inspect the current page with get_content or screenshot, then choose a "
            "different safe strategy; do not repeat the action until its result is verified. "
            "If the browser process stopped, the next request will reopen Playwright with "
            "the same isolated HELIX profile."
        )
        observation = failure["last_observed_page"]
        if observation is not None:
            title = observation.get("title")
            url = observation.get("url")
            page = f"{title} ({url})" if title and url else url or title
            if page:
                message += f" Last observed page: {page}."
        return message
