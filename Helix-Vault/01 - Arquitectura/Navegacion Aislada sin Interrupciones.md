# Control de Navegador en Aislamiento Total (Cursor Virtual y Cero Interrupciones)

## 1. El Reto: Cero Interrupción al Usuario
Cuando un asistente de IA toma control del equipo tradicionalmente (como PyAutoGUI o captura global de OS), secuestra el cursor físico del mouse y el foco del teclado del usuario, impidiéndole trabajar.

Para que **HELIX navegue en tiempo real, con su propio cursor visual y su propio scroll sin interrumpir al usuario mientras este hace cualquier otra cosa en Windows**:
1. **El cursor del mouse físico del usuario nunca se mueve ni se bloquea.**
2. **Las ventanas activas del usuario nunca pierden el foco.**
3. **El usuario ve la acción en vivo** si abre la ventana de HELIX o desde la app móvil (screencast con cursor virtual dibujado).
4. **La navegación ocurre en un Contexto/Ventana dedicada y desvinculada del OS Input Manager.**

---

## 2. Solución Arquitectónica: Virtual Cursor & Isolated Viewport

```
        USUARIO EN WINDOWS (Word, Juegos, VS Code, etc.)
               │
               ▼ Mouse físico y teclado físico (intactos, foco libre)
   ┌─────────────────────────────────────────────────────────────┐
   │                                                             │
   │  HELIX AGENT (Background Process)                           │
   │    │                                                        │
   │    ├─► Playwright / CDP Dedicated Context                   │
   │    │     - Ventana propia independiente (o headless stream) │
   │    │     - DOM Events sintéticos a nivel CDP                │
   │    │       (Input.dispatchMouseEvent / ElementHandle.click) │
   │    │                                                        │
   │    ├─► Virtual Cursor Overlay (Inyección en DOM / Screencast)│
   │    │     - Un puntero visual estilizado (naranja HELIX)     │
   │    │       renderizado dentro del viewport web              │
   │    │     - Muestra trayectorias, clicks y scrolls en vivo   │
   │    │                                                        │
   │    └─► Streaming a Mobile & Desktop Mini-Viewer             │
   │          - En la app móvil se ve la página en vivo con el   │
   │            cursor de HELIX moviéndose y haciendo click      │
   └─────────────────────────────────────────────────────────────┘
```

---

## 3. Implementación de los 3 Pilares

### Pilar A: Eventos Sintéticos CDP (No invasivos al SO)
Playwright y Chrome DevTools Protocol no usan las APIs de Windows `SetCursorPos` o `mouse_event`. En su lugar, despachan eventos directamente a la cola interna del motor de renderizado de Chromium (`Blink`):
* `page.mouse.move(x, y)`: Mueve la posición de puntero dentro del canvas web de Chromium, sin alterar el cursor del sistema operativo.
* `page.mouse.click(x, y)` o `locator.click()`: Genera los eventos `mousedown`, `mouseup` y `click` sobre el nodo DOM específico.
* `page.mouse.wheel(deltaX, deltaY)`: Aplica scroll a nivel compositor del navegador sin requerir que la ventana esté en primer plano ni robe foco.

### Pilar B: Cursor Virtual Visual (Ghost/Virtual Pointer)
Para que el usuario (en Desktop o desde el Móvil) pueda **ver exactamente dónde está apuntando y cliqueando HELIX**:
* Se inyecta un script ligero en la página (`Page.addInitScript` / `page.evaluate`):
  ```javascript
  // Cursor virtual inyectado en el contexto de navegación de HELIX
  const cursor = document.createElement('div');
  cursor.id = 'helix-virtual-cursor';
  cursor.style = 'position:fixed; width:18px; height:18px; border-radius:50%; background:rgba(238,96,24,0.85); border:2px solid white; pointer-events:none; z-index:2147483647; transition:all 0.18s ease-out; transform:translate(-50%, -50%);';
  document.documentElement.appendChild(cursor);

  window.addEventListener('helix:move', (e) => {
    cursor.style.left = e.detail.x + 'px';
    cursor.style.top = e.detail.y + 'px';
  });
  window.addEventListener('helix:click', () => {
    cursor.style.transform = 'translate(-50%, -50%) scale(0.7)';
    setTimeout(() => cursor.style.transform = 'translate(-50%, -50%) scale(1)', 150);
  });
  ```
* Cada vez que HELIX mueve el mouse o clica, el puntero virtual se anima visiblemente sobre la página.

### Pilar C: Live Screencast a la App Móvil
Desde la app móvil, el usuario pide: *"Entra a Amazon y busca precios de X"* o *"Revisa los estilos en Refero Styles"*.
* El agente activa `Page.startScreencast` o envía frames JPEG periódicos vía el túnel WSS Relay (`wss://desktop-7hrsa16.taild4cce1.ts.net`).
* La app móvil muestra en el chat o en una pestaña un visor en vivo donde el usuario ve a HELIX navegando, haciendo scroll suave y pulsando botones de forma autónoma.
* El usuario en la PC física puede seguir jugando, redactando o programando sin que se le mueva una sola ventana.

---

## 4. Estado de Implementación en Código

| Archivo | Rol |
|---|---|
| [`services/agent/browser/browser_session.py`](file:///c:/Users/TG%20computer/Documents/Helix%20Assitant/services/agent/browser/browser_session.py) | Instancia de Chromium aislada con Playwright (`headless=False` o headless virtual frame buffer). Configurada con `accept_downloads` y sandbox seguro. |
| [`services/agent/tools/browser_tool.py`](file:///c:/Users/TG%20computer/Documents/Helix%20Assitant/services/agent/tools/browser_tool.py) | Primitivas `click`, `type_text`, `scroll`, `screenshot` ejecutadas directamente sobre el contexto de la página sin apoderarse del input de Windows. |
| `services/agent/browser/virtual_cursor.py` *(Próxima incorporación)* | Gestor del overlay de cursor visual y despacho de coordenadas animadas. |
