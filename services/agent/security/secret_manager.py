import logging
from typing import Optional, List
import keyring
from keyring.backends.Windows import WinVaultKeyring

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
            return type(backend) is WinVaultKeyring and backend.priority > 0
        except Exception:
            return False

    def _require_keyring(self) -> None:
        if not self.is_available():
            raise RuntimeError(
                "The OS credential store is unavailable; SecretManager has no fallback"
            )
