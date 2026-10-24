import asyncio
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Script JS ligero inyectado en el DOM del navegador para dibujar el cursor virtual de HELIX
VIRTUAL_CURSOR_INJECTION_JS = """
(function() {
  if (document.getElementById('helix-virtual-cursor')) return;

  const cursor = document.createElement('div');
  cursor.id = 'helix-virtual-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.style.cssText = `
    position: fixed;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: rgba(238, 96, 24, 0.88);
    border: 2px solid #ffffff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    pointer-events: none !important;
    z-index: 2147483647 !important;
    transition: transform 0.15s ease-out, opacity 0.2s ease;
    transform: translate(-50%, -50%) scale(1);
    top: -100px;
    left: -100px;
    opacity: 0;
  `;

  const dot = document.createElement('div');
  dot.style.cssText = `
    width: 6px;
    height: 6px;
    background: #ffffff;
    border-radius: 50%;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  `;
  cursor.appendChild(dot);
  document.documentElement.appendChild(cursor);

  window.__helixMoveCursor = function(x, y) {
    cursor.style.opacity = '1';
    cursor.style.left = x + 'px';
    cursor.style.top = y + 'px';
  };

  window.__helixClickCursor = function() {
    cursor.style.transform = 'translate(-50%, -50%) scale(0.65)';
    setTimeout(() => {
      cursor.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 140);
  };

  window.__helixHideCursor = function() {
    cursor.style.opacity = '0';
  };
})();
"""

class VirtualCursorManager:
    """Gestiona el cursor fantasma/virtual para navegación sin robar foco ni mouse físico."""

    def __init__(self, page):
        self.page = page
        self._injected = False
        self.current_x = 0
        self.current_y = 0

    async def ensure_injected(self) -> None:
        if not self.page:
            return
        try:
            await self.page.evaluate(VIRTUAL_CURSOR_INJECTION_JS)
            self._injected = True
        except Exception as e:
            logger.debug(f"Cursor injection wait or skip: {e}")

    async def move_to(self, x: int, y: int, steps: int = 5) -> None:
        """Desplaza el cursor virtual de manera suave hacia las coordenadas (x, y)."""
        await self.ensure_injected()
        start_x, start_y = self.current_x, self.current_y

        for i in range(1, steps + 1):
            curr_x = start_x + (x - start_x) * (i / steps)
            curr_y = start_y + (y - start_y) * (i / steps)
            try:
                await self.page.evaluate(f"window.__helixMoveCursor && window.__helixMoveCursor({curr_x}, {curr_y})")
            except Exception:
                pass
            await asyncio.sleep(0.015)

        self.current_x = x
        self.current_y = y

    async def click_at(self, x: int, y: int) -> None:
        """Mueve el cursor hacia la posición y simula la pulsación visual y el click sintético."""
        await self.move_to(x, y, steps=6)
        try:
            await self.page.evaluate("window.__helixClickCursor && window.__helixClickCursor()")
        except Exception:
            pass
        # Despacho de click a nivel CDP en Chromium (no mueve el ratón del usuario)
        await self.page.mouse.click(x, y)

    async def click_element(self, selector: str) -> None:
        """Obtiene la caja delimitadora (bounding box) de un elemento y hace clic virtual."""
        await self.ensure_injected()
        locator = self.page.locator(selector).first
        box = await locator.bounding_box()
        if box:
            center_x = int(box["x"] + box["width"] / 2)
            center_y = int(box["y"] + box["height"] / 2)
            await self.click_at(center_x, center_y)
        else:
            # Fallback al click sintético directo del locator
            await locator.click()

    async def scroll(self, delta_y: int, smooth_steps: int = 6) -> None:
        """Aplica scroll suave en la ventana independiente sin alterar el foco del SO."""
        step_amount = delta_y // smooth_steps
        for _ in range(smooth_steps):
            try:
                await self.page.evaluate(f"window.scrollBy({{ top: {step_amount}, behavior: 'smooth' }});")
            except Exception:
                pass
            await asyncio.sleep(0.02)
