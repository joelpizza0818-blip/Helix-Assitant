import re


CONSEQUENTIAL_ACTION_TERMS = (
    "delete",
    "remove",
    "trash",
    "purchase",
    "buy",
    "pay",
    "checkout",
    "send",
    "publish",
    "post",
    "transfer",
    "confirm",
    "submit",
    "unsubscribe",
)

SENSITIVE_INPUT_TARGET = re.compile(
    r"(?i)(?:password|passwd|passcode|one[\s_-]?time[\s_-]?code|"
    r"\botp\b|verification[\s_-]?code|security[\s_-]?code|"
    r"credit[\s_-]?card|card[\s_-]?number|\bcvv\b|\bcvc\b|"
    r"social[\s_-]?security|\bssn\b|bank[\s_-]?account)"
)


def has_consequential_action_text(value: object) -> bool:
    if not isinstance(value, str):
        return False
    normalized = value.casefold()
    return any(term in normalized for term in CONSEQUENTIAL_ACTION_TERMS)


def has_sensitive_input_target_text(value: object) -> bool:
    return isinstance(value, str) and bool(SENSITIVE_INPUT_TARGET.search(value))


def is_search_input_target(value: object) -> bool:
    return isinstance(value, str) and bool(
        re.search(
            r"(?i)(?:search|query|find|busqueda|búsqueda|"
            r"(?:name|id|aria-label|placeholder|title)\s*=\s*['\"]?q\b)",
            value,
        )
    )
