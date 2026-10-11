import keyring
import pytest
from keyring.backends.Windows import WinVaultKeyring

from services.agent.security.secret_manager import SecretManager


def _use_windows_credential_backend(monkeypatch):
    backend = WinVaultKeyring()
    monkeypatch.setattr(keyring, "get_keyring", lambda: backend)
    return backend


def test_secret_manager_uses_keyring_and_tracks_keys_for_instance(monkeypatch):
    stored = {}
    backend = _use_windows_credential_backend(monkeypatch)
    monkeypatch.setattr(
        keyring,
        "set_password",
        lambda service, key, value: stored.__setitem__((service, key), value),
    )
    monkeypatch.setattr(
        keyring, "get_password", lambda service, key: stored.get((service, key))
    )
    monkeypatch.setattr(
        keyring, "delete_password", lambda service, key: stored.pop((service, key))
    )
    manager = SecretManager()

    assert manager.is_available()
    assert type(backend) is WinVaultKeyring
    manager.store_secret("api-token", "secret-value")

    assert manager.get_secret("api-token") == "secret-value"
    assert manager.list_secret_keys() == ["api-token"]
    manager.delete_secret("api-token")
    assert manager.get_secret("api-token") is None
    assert manager.list_secret_keys() == []


@pytest.mark.parametrize(
    "operation",
    [
        lambda manager: manager.store_secret("api-token", "secret-value"),
        lambda manager: manager.get_secret("api-token"),
        lambda manager: manager.delete_secret("api-token"),
    ],
)
def test_secret_manager_fails_closed_without_usable_keyring(monkeypatch, operation):
    monkeypatch.setattr(keyring, "get_keyring", lambda: None)

    with pytest.raises(RuntimeError, match="credential store is unavailable"):
        operation(SecretManager())


@pytest.mark.parametrize(
    "operation",
    [
        lambda manager: manager.store_secret("api-token", "secret-value"),
        lambda manager: manager.get_secret("api-token"),
        lambda manager: manager.delete_secret("api-token"),
    ],
)
def test_secret_manager_rejects_unapproved_positive_priority_backend(
    monkeypatch, operation
):
    monkeypatch.setattr(
        keyring, "get_keyring", lambda: type("FileKeyring", (), {"priority": 1})()
    )

    with pytest.raises(RuntimeError, match="credential store is unavailable"):
        operation(SecretManager())


def test_secret_manager_does_not_hide_a_missing_previously_stored_secret(monkeypatch):
    _use_windows_credential_backend(monkeypatch)
    monkeypatch.setattr(keyring, "set_password", lambda *_args: None)
    monkeypatch.setattr(keyring, "get_password", lambda *_args: None)
    manager = SecretManager()
    sensitive_key_name = "customer-account-secret-identifier"
    manager.store_secret(sensitive_key_name, "secret-value")

    with pytest.raises(RuntimeError, match="previously stored") as raised:
        manager.get_secret(sensitive_key_name)

    assert sensitive_key_name not in str(raised.value)


def test_secret_manager_does_not_log_secret_data(monkeypatch, caplog):
    stored = {}
    _use_windows_credential_backend(monkeypatch)
    monkeypatch.setattr(
        keyring,
        "set_password",
        lambda service, key, value: stored.__setitem__((service, key), value),
    )
    monkeypatch.setattr(
        keyring, "delete_password", lambda service, key: stored.pop((service, key))
    )
    sensitive_key_name = "customer-account-secret-identifier"
    manager = SecretManager()

    manager.store_secret(sensitive_key_name, "secret-value")
    manager.delete_secret(sensitive_key_name)

    assert sensitive_key_name not in caplog.text
    assert "secret-value" not in caplog.text


def test_secret_manager_propagates_delete_failure_without_forgetting_key(monkeypatch):
    _use_windows_credential_backend(monkeypatch)
    monkeypatch.setattr(keyring, "set_password", lambda *_args: None)
    missing_error = keyring.errors.PasswordDeleteError("entry does not exist")

    def delete_missing_secret(*_args):
        raise missing_error

    monkeypatch.setattr(keyring, "delete_password", delete_missing_secret)
    manager = SecretManager()
    manager.store_secret("api-token", "secret-value")

    with pytest.raises(keyring.errors.PasswordDeleteError) as raised:
        manager.delete_secret("api-token")

    assert raised.value is missing_error
    assert manager.list_secret_keys() == ["api-token"]
