export const GESTURE_WINDOW_SEQUENCE = ['floating', 'toolbox', 'agents'] as const

export type GestureWindowId = (typeof GESTURE_WINDOW_SEQUENCE)[number]

export function getNextGestureWindowToOpen(
  visibleWindows: ReadonlySet<GestureWindowId>,
): GestureWindowId | null {
  return GESTURE_WINDOW_SEQUENCE.find((windowId) => !visibleWindows.has(windowId)) ?? null
}

export function getLastGestureWindowToClose(
  visibleWindows: ReadonlySet<GestureWindowId>,
): GestureWindowId | null {
  for (let index = GESTURE_WINDOW_SEQUENCE.length - 1; index >= 0; index -= 1) {
    const windowId = GESTURE_WINDOW_SEQUENCE[index]
    if (visibleWindows.has(windowId)) return windowId
  }
  return null
}
