from contextlib import contextmanager
from contextvars import ContextVar


_screen_observation_allowed = ContextVar(
    "helix_screen_observation_allowed",
    default=False,
)


def screen_observation_is_allowed() -> bool:
    return _screen_observation_allowed.get()


@contextmanager
def screen_observation_scope(allowed: bool):
    token = _screen_observation_allowed.set(bool(allowed))
    try:
        yield
    finally:
        _screen_observation_allowed.reset(token)
