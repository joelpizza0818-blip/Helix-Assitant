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


def has_consequential_action_text(value: object) -> bool:
    if not isinstance(value, str):
        return False
    normalized = value.casefold()
    return any(term in normalized for term in CONSEQUENTIAL_ACTION_TERMS)
