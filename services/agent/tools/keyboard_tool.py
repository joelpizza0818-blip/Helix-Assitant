import asyncio
import logging
import pyautogui
from typing import Optional

logger = logging.getLogger(__name__)

class KeyboardTool:
    """Tool for controlling the keyboard."""
    
    def __init__(self):
        pyautogui.FAILSAFE = True
        
    async def type_text(self, text: str, interval: float = 0.02) -> None:
        """Types the given text with an optional interval between keystrokes."""
        logger.info(f"Typing text: '{text}' (interval: {interval}s)")
        await asyncio.to_thread(pyautogui.write, text, interval)
        
    async def press_key(self, key: str) -> None:
        """Presses and releases a single key."""
        logger.info(f"Pressing key: '{key}'")
        await asyncio.to_thread(pyautogui.press, key)
        
    async def hotkey(self, *keys: str) -> None:
        """Presses a combination of keys (e.g., 'ctrl', 'c')."""
        logger.info(f"Pressing hotkey: {keys}")
        await asyncio.to_thread(pyautogui.hotkey, *keys)
        
    async def key_down(self, key: str) -> None:
        """Holds a key down."""
        logger.info(f"Key down: '{key}'")
        await asyncio.to_thread(pyautogui.keyDown, key)
        
    async def key_up(self, key: str) -> None:
        """Releases a key."""
        logger.info(f"Key up: '{key}'")
        await asyncio.to_thread(pyautogui.keyUp, key)
        
    async def type_password(self, password: str) -> None:
        """Types a password without logging its value."""
        logger.info("Typing password: ***")
        await asyncio.to_thread(pyautogui.write, password)
