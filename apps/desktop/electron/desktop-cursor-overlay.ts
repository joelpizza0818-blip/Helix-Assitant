/**
 * Pure helpers for HELIX's desktop virtual-cursor overlay.
 *
 * The overlay is a transparent, click-through, always-on-top window that is
 * drawn separately from the user's physical pointer. This module contains no
 * Electron imports so its geometry and payload validation can be tested with
 * plain Node.
 */

export interface DesktopScreenBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface DesktopCursorState {
  cursor: {
    x: number
    y: number
    visible: boolean
  }
  action: string | null
  clicked: boolean
  screenBounds: DesktopScreenBounds | null
}

export interface OverlayDisplay {
  id?: number
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  scaleFactor?: number
}

export interface OverlayPoint {
  x: number
  y: number
}

const ACTION_LABELS: Record<string, string> = {
  point: 'Señalando',
  move: 'Moviendo',
  click: 'Clic',
  double_click: 'Doble clic',
  right_click: 'Clic derecho',
  drag: 'Arrastrando',
  type: 'Escribiendo',
  type_into_element: 'Escribiendo',
  key: 'Tecla',
  scroll: 'Desplazando',
  focus: 'Enfocando',
  focus_window: 'Enfocando',
  launch: 'Abriendo',
  observe: 'Observando',
  observe_ui: 'Observando',
  screenshot: 'Capturando',
  windows: 'Ventanas',
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeBounds(value: unknown): DesktopScreenBounds | null {
  if (value === null || typeof value !== 'object') return null
  const bounds = value as Record<string, unknown>
  const left = bounds.left
  const top = bounds.top
  const width = bounds.width
  const height = bounds.height
  if (!isFiniteNumber(left) || !isFiniteNumber(top)) return null
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null
  if (width <= 0 || height <= 0) return null
  return { left, top, width, height }
}

/** Validate one `desktop_cursor` event payload. */
export function parseDesktopCursorEvent(payload: unknown): DesktopCursorState | null {
  if (payload === null || typeof payload !== 'object') return null
  const value = payload as Record<string, unknown>
  const cursor = value.cursor
  if (cursor === null || typeof cursor !== 'object') return null
  const cursorValue = cursor as Record<string, unknown>
  const x = cursorValue.x
  const y = cursorValue.y
  const visible = cursorValue.visible
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  if (typeof visible !== 'boolean') return null
  const action = typeof value.action === 'string' && value.action.trim().length > 0
    ? value.action.trim().slice(0, 48)
    : null
  return {
    cursor: { x, y, visible },
    action,
    clicked: value.clicked === true,
    screenBounds: normalizeBounds(value.screen_bounds),
  }
}

/** Human-readable, bounded label for the overlay. */
export function cursorActionLabel(action: string | null): string {
  if (!action) return ''
  return ACTION_LABELS[action] ?? action.replace(/[_-]+/g, ' ').slice(0, 32)
}

/**
 * Choose the display that best matches the screen bounds reported by the
 * backend. Bounds arrive in native pixels while Electron reports DIP, so the
 * display rectangle is scaled before comparing.
 */
export function matchDisplayForScreenBounds<T extends OverlayDisplay>(
  displays: T[],
  screenBounds: DesktopScreenBounds | null,
): T | null {
  if (!screenBounds || screenBounds.width <= 0 || screenBounds.height <= 0) {
    return null
  }
  let best: T | null = null
  let bestOverlap = 0
  for (const display of displays) {
    const scale = display.scaleFactor && display.scaleFactor > 0
      ? display.scaleFactor
      : 1
    const left = display.bounds.x * scale
    const top = display.bounds.y * scale
    const right = left + display.bounds.width * scale
    const bottom = top + display.bounds.height * scale
    const overlapWidth = Math.max(
      0,
      Math.min(right, screenBounds.left + screenBounds.width) - Math.max(left, screenBounds.left),
    )
    const overlapHeight = Math.max(
      0,
      Math.min(bottom, screenBounds.top + screenBounds.height) - Math.max(top, screenBounds.top),
    )
    const overlap = overlapWidth * overlapHeight
    if (overlap > bestOverlap) {
      best = display
      bestOverlap = overlap
    }
  }
  return best
}

/**
 * Convert a normalized cursor position into window-local DIP coordinates.
 *
 * The normalized position is relative to the captured screen bounds when the
 * backend provides them, and to the target display otherwise.
 */
export function cursorPointInDisplay(
  display: OverlayDisplay,
  screenBounds: DesktopScreenBounds | null,
  cursor: { x: number; y: number },
): OverlayPoint {
  const scale = display.scaleFactor && display.scaleFactor > 0
    ? display.scaleFactor
    : 1
  const bounds = screenBounds ?? {
    left: display.bounds.x * scale,
    top: display.bounds.y * scale,
    width: Math.max(1, display.bounds.width * scale),
    height: Math.max(1, display.bounds.height * scale),
  }
  const normalizedX = Math.min(1, Math.max(0, cursor.x))
  const normalizedY = Math.min(1, Math.max(0, cursor.y))
  const nativeX = bounds.left + normalizedX * bounds.width
  const nativeY = bounds.top + normalizedY * bounds.height
  const localX = (nativeX - display.bounds.x * scale) / scale
  const localY = (nativeY - display.bounds.y * scale) / scale
  return {
    x: Math.min(Math.max(0, localX), Math.max(0, display.bounds.width)),
    y: Math.min(Math.max(0, localY), Math.max(0, display.bounds.height)),
  }
}

/** Static overlay page. The arrow tip is anchored at the cursor point. */
export function buildDesktopCursorHtml(): string {
  return `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HELIX cursor</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent;
    pointer-events: none;
    user-select: none;
    font: 600 12px "Segoe UI", system-ui, sans-serif;
  }
  #helix-cursor {
    --x: -200px;
    --y: -200px;
    position: fixed;
    left: 0;
    top: 0;
    transform: translate3d(var(--x), var(--y), 0);
    transition: transform 140ms ease-out;
    will-change: transform;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.45));
  }
  #helix-cursor-ring {
    position: absolute;
    left: 2px;
    top: 2px;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    border: 2px solid #ee6018;
    opacity: 0;
    transform: scale(0.5);
  }
  #helix-cursor-label {
    position: absolute;
    left: 24px;
    top: 30px;
    max-width: 220px;
    padding: 5px 9px;
    border-radius: 999px;
    color: #fff;
    background: rgba(20, 18, 16, 0.94);
    border: 1px solid #ee6018;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #helix-cursor-label[hidden] { display: none; }
</style>
<body>
  <div id="helix-cursor" aria-hidden="true">
    <span id="helix-cursor-ring"></span>
    <svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true">
      <path
        d="M3 2.2 L3 27.4 L10.1 20.9 L14.8 32.6 L20.2 30.2 L15.5 18.8 L24.6 18.8 Z"
        fill="#0b0b0b"
        stroke="#ffffff"
        stroke-width="2.2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
    <span id="helix-cursor-label" hidden></span>
  </div>
</body>
</html>`
}

/**
 * Build the isolated script that moves the existing overlay page. Only numeric
 * geometry is interpolated; the action text travels through JSON.stringify and
 * is assigned with `textContent`.
 */
export function buildCursorUpdateScript(
  state: DesktopCursorState,
  point: OverlayPoint,
): string {
  const x = Number.isFinite(point.x) ? point.x.toFixed(2) : '0'
  const y = Number.isFinite(point.y) ? point.y.toFixed(2) : '0'
  const label = JSON.stringify(cursorActionLabel(state.action))
  return `(() => {
  const cursor = document.getElementById('helix-cursor')
  const label = document.getElementById('helix-cursor-label')
  const ring = document.getElementById('helix-cursor-ring')
  if (!cursor || !label || !ring) return false
  cursor.style.setProperty('--x', '${x}px')
  cursor.style.setProperty('--y', '${y}px')
  label.textContent = ${label}
  label.hidden = ${label === '""'}
  if (${state.clicked ? 'true' : 'false'} && typeof ring.animate === 'function') {
    ring.animate(
      [
        { transform: 'scale(0.4)', opacity: 0.9 },
        { transform: 'scale(2.2)', opacity: 0 }
      ],
      { duration: 460, easing: 'ease-out' }
    )
  }
  return true
})()`
}
