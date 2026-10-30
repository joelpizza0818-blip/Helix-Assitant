import asyncio
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Script JS inyectado en el DOM con Shadow DOM para aislar el cursor de estilos de la página web
VIRTUAL_CURSOR_INJECTION_JS = """
(() => {
    const install = () => {
        if (document.getElementById('helix-virtual-cursor')) return;
        const host = document.createElement('div');
        host.id = 'helix-virtual-cursor';
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
        const shadow = host.attachShadow({ mode: 'closed' });
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                .frame { position:fixed; inset:0; border:3px solid #ee6018;
                    box-shadow:inset 0 0 14px rgba(238,96,24,.85), 0 0 12px rgba(238,96,24,.75);
                    pointer-events:none; }
                .cursor { position:fixed; left:0; top:0; width:28px; height:36px;
                    opacity:0; transform:translate3d(-100px,-100px,0);
                    transition:transform 20ms linear; will-change:transform; }
                .cursor svg { width:100%; height:100%; overflow:visible;
                    filter:drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
                .pulse { position:fixed; width:28px; height:28px; margin:-14px 0 0 -14px;
                    border:2px solid #ee6018; border-radius:50%; opacity:0;
                    transform:scale(.35); }
                .pulse.active { animation:helix-click 420ms ease-out; }
                @keyframes helix-click {
                    0% { opacity:.9; transform:scale(.35); }
                    100% { opacity:0; transform:scale(1.7); }
                }
            </style>
            <div class="frame"></div>
            <div class="cursor"><svg viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 2v25l6.4-6.1 4.1 9.2 4.1-1.8-4.1-9.1H23L3 2Z"
                    fill="#ee6018" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
            </svg></div>
            <div class="pulse"></div>`;
        (document.documentElement || document).appendChild(host);
        const cursor = shadow.querySelector('.cursor');
        const pulse = shadow.querySelector('.pulse');
        window.__helixMoveCursor = (x, y) => {
            cursor.style.opacity = '1';
            cursor.style.transform = `translate3d(${x}px,${y}px,0)`;
        };
        window.__helixClickCursor = (x, y) => {
            pulse.style.left = `${x}px`;
            pulse.style.top = `${y}px`;
            pulse.classList.remove('active');
            void pulse.offsetWidth;
            pulse.classList.add('active');
        };
        window.__helixHideCursor = () => {
            cursor.style.opacity = '0';
        };
    };
    if (document.documentElement) install();
    else document.addEventListener('DOMContentLoaded', install, { once: true });
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
            await self.page.evaluate(f"window.__helixClickCursor && window.__helixClickCursor({x}, {y})")
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
