xport const FLOATING_INPUT_MIN_HEIGHT = 38
export const FLOATING_INPUT_MAX_HEIGHT = 160

export function getFloatingInputSize(scrollHeight: number) {
  const height = Math.max(
    FLOATING_INPUT_MIN_HEIGHT,
    Math.min(scrollHeight, FLOATING_INPUT_MAX_HEIGHT),
  )
  return {
    height: `${height}px`,
    overflowY: scrollHeight > FLOATING_INPUT_MAX_HEIGHT ? 'auto' : 'hidden',
  } as const
}

export type FloatingInputKeyAction =
  | 'move-down'
  | 'move-up'
  | 'select-mention'
  | 'dismiss-mentions'
  | 'send'
  | 'none'

export function getFloatingInputKeyAction(
  key: string,
  shiftKey: boolean,
  hasMentionOptions: boolean,
  hasActiveMention: boolean,
): FloatingInputKeyAction {
  if (hasMentionOptions) {
    if (key === 'ArrowDown') return 'move-down'
    if (key === 'ArrowUp') return 'move-up'
    if (key === 'Tab' || (key === 'Enter' && hasActiveMention)) {
      return 'select-mention'
    }
    if (key === 'Escape') return 'dismiss-mentions'
  }
  if (key === 'Enter' && !shiftKey) return 'send'
  return 'none'
}
