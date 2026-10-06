import logging
import os
from typing import Optional, List
import keyring
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

class SecretManager:
    SERVICE_NAME = "helix_agent"

    def __init__(self):
        self._keys: List[str] = []
        self._fallback_key = os.environ.get("SECRET_ENCRYPTION_KEY")
        if self._fallback_key:
            self._cipher = Fernet(self._fallback_key.encode())
        else:
            self._cipher = None

    def store_secret(self, key_name: str, value: str) -> None:
        try:
            if self.is_available():
                keyring.set_password(self.SERVICE_NAME, key_name, value)
            elif self._cipher:
                encrypted = self._cipher.encrypt(value.encode()).decode()
                # In a real scenario, this would be saved to a file or DB
                # Skipping persistence for fallback in this simple implementation
                pass
            if key_name not in self._keys:
                self._keys.append(key_name)
            logger.info(f"Stored secret for key: {key_name}")
        except Exception as e:
            logger.error(f"Failed to store secret {key_name}: {e}")

    def get_secret(self, key_name: str) -> Optional[str]:
        try:
            if self.is_available():
                return keyring.get_password(self.SERVICE_NAME, key_name)
            return None
        except Exception as e:
            logger.error(f"Failed to get secret {key_name}: {e}")
            return None

    def delete_secret(self, key_name: str) -> None:
        try:
            if self.is_available():
                keyring.delete_password(self.SERVICE_NAME, key_name)
            if key_name in self._keys:
                self._keys.remove(key_name)
            logger.info(f"Deleted secret for key: {key_name}")
        except Exception as e:
            logger.error(f"Failed to delete secret {key_name}: {e}")

    def list_secret_keys(self) -> List[str]:
        return self._keys.copy()

    def is_available(self) -> bool:
        try:
            return keyring.get_keyring() is not None
        except Exception:
            return False
