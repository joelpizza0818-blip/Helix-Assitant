import logging
import platform
from typing import List, Optional

import keyring

try:
    from keyring.backends.Windows import WinVaultKeyring
except (ImportError, AttributeError):
    WinVaultKeyring = None

try:
    from keyring.backends.macOS import Keyring as MacOSKeyring
except (ImportError, AttributeError):
    MacOSKeyring = None

try:
    from keyring.backends.SecretService import Keyring as SecretServiceKeyring
except (ImportError, AttributeError):
    SecretServiceKeyring = None

try:
    from keyring.backends.kwallet import DBusKeyring as KWalletDBusKeyring
except (ImportError, AttributeError):
    KWalletDBusKeyring = None

try:
    from keyring.backends.kwallet import DBusKeyringKWallet4 as KWallet4DBusKeyring
except (ImportError, AttributeError):
    KWallet4DBusKeyring = None

logger = logging.getLogger(__name__)


class SecretManager:
    SERVICE_NAME = "helix_agent"

    def __init__(self):
        self._keys: List[str] = []

    def store_secret(self, key_name: str, value: str) -> None:
        self._require_keyring()
        keyring.set_password(self.SERVICE_NAME, key_name, value)
        if key_name not in self._keys:
            self._keys.append(key_name)
        logger.info("Stored secret")

    def get_secret(self, key_name: str) -> Optional[str]:
        self._require_keyring()
        value = keyring.get_password(self.SERVICE_NAME, key_name)
        if value is None and key_name in self._keys:
            raise RuntimeError(
                "A secret previously stored by this manager is no longer available"
            )
        return value

    def delete_secret(self, key_name: str) -> None:
        self._require_keyring()
        keyring.delete_password(self.SERVICE_NAME, key_name)
        if key_name in self._keys:
            self._keys.remove(key_name)
        logger.info("Deleted secret")

    def list_secret_keys(self) -> List[str]:
        return self._keys.copy()

    def is_available(self) -> bool:
        try:
            backend = keyring.get_keyring()
            if backend is None:
                return False
            priority = getattr(backend, "priority", 0)
            if priority <= 0:
                return False

            system = platform.system()
            if system == "Windows":
                return WinVaultKeyring is not None and type(backend) is WinVaultKeyring
            elif system == "Darwin":
                if MacOSKeyring is not None and (type(backend) is MacOSKeyring or isinstance(backend, MacOSKeyring)):
                    return True
                backend_module = getattr(type(backend), "__module__", "")
                backend_name = getattr(type(backend), "__name__", "")
                full_name = f"{backend_module}.{backend_name}"
                return "macOS" in full_name or "macOS" in backend_module
            elif system == "Linux":
                approved_types = tuple(
                    cls
                    for cls in (
                        SecretServiceKeyring,
                        KWalletDBusKeyring,
                        KWallet4DBusKeyring,
                    )
                    if cls is not None
                )
                if approved_types and isinstance(backend, approved_types):
                    return True
                backend_module = getattr(type(backend), "__module__", "")
                backend_name = getattr(type(backend), "__name__", "")
                full_name = f"{backend_module}.{backend_name}"
                return any(
                    approved in full_name
                    for approved in ("SecretService", "kwallet", "KWallet")
                )
            return False
        except Exception:
            return False

    def _require_keyring(self) -> None:
        if not self.is_available():
            raise RuntimeError(
                "The OS credential store is unavailable; SecretManager has no fallback"
            )
