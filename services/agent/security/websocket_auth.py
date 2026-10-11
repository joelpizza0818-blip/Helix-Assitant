import hmac
from http import HTTPStatus


_AUTHORIZATION_HEADER = "Authorization"
_BEARER_PREFIX = "Bearer "
_UNAUTHORIZED_BODY = b"Unauthorized\n"


def websocket_token_is_valid(headers, expected_token: str) -> bool:
    authorization = headers.get(_AUTHORIZATION_HEADER)
    if not expected_token or not isinstance(authorization, str):
        return False
    if not authorization.startswith(_BEARER_PREFIX):
        return False

    provided_token = authorization[len(_BEARER_PREFIX):]
    if not provided_token:
        return False
    try:
        return hmac.compare_digest(provided_token, expected_token)
    except TypeError:
        return False


def authenticate_websocket_handshake(connection, request, expected_token: str):
    headers = getattr(request, "headers", request)
    if websocket_token_is_valid(headers, expected_token):
        return None

    if hasattr(connection, "respond"):
        return connection.respond(HTTPStatus.UNAUTHORIZED, "Unauthorized\n")

    return (
        HTTPStatus.UNAUTHORIZED,
        [("Content-Type", "text/plain")],
        _UNAUTHORIZED_BODY,
    )
