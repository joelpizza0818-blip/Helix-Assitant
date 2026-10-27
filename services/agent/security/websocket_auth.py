import hmac
import json
import time
from http import HTTPStatus
from pathlib import Path


_AUTHORIZATION_HEADER = "Authorization"
_BEARER_PREFIX = "Bearer "
_UNAUTHORIZED_BODY = b"Unauthorized\n"


def _pairing_token_is_valid(provided_token: str, pairing_file: str | Path | None) -> bool:
    if not pairing_file:
        return False
    try:
        payload = json.loads(Path(pairing_file).read_text(encoding="utf-8"))
        pairing_token = payload.get("token")
        expires_at = payload.get("expires_at")
        if not isinstance(pairing_token, str) or not pairing_token:
            return False
        if not isinstance(expires_at, (int, float)) or expires_at <= time.time():
            return False
        return hmac.compare_digest(provided_token, pairing_token)
    except (OSError, ValueError, TypeError):
        return False


def websocket_token_is_valid(
    headers,
    expected_token: str,
    pairing_file: str | Path | None = None,
) -> bool:
    authorization = headers.get(_AUTHORIZATION_HEADER)
    if not expected_token or not isinstance(authorization, str):
        return False
    if not authorization.startswith(_BEARER_PREFIX):
        return False

    provided_token = authorization[len(_BEARER_PREFIX):]
    if not provided_token:
        return False
    try:
        if hmac.compare_digest(provided_token, expected_token):
            return True
    except TypeError:
        pass
    return _pairing_token_is_valid(provided_token, pairing_file)


def authenticate_websocket_handshake(
    connection,
    request,
    expected_token: str,
    pairing_file: str | Path | None = None,
):
    headers = getattr(request, "headers", request)
    if websocket_token_is_valid(headers, expected_token, pairing_file):
        return None

    if hasattr(connection, "respond"):
        return connection.respond(HTTPStatus.UNAUTHORIZED, "Unauthorized\n")

    return (
        HTTPStatus.UNAUTHORIZED,
        [("Content-Type", "text/plain")],
        _UNAUTHORIZED_BODY,
    )
