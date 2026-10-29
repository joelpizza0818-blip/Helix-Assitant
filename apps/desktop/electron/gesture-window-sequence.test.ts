import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getLastGestureWindowToClose,
  getNextGestureWindowToOpen,
} from './gesture-window-sequence'

test('gesture open selects each window in chat, settings, subagents order', () => {
  const visible = new Set<'floating' | 'toolbox' | 'agents'>()

  assert.equal(getNextGestureWindowToOpen(visible), 'floating')
  visible.add('floating')
  assert.equal(getNextGestureWindowToOpen(visible), 'toolbox')
  visible.add('toolbox')
  assert.equal(getNextGestureWindowToOpen(visible), 'agents')
  visible.add('agents')
  assert.equal(getNextGestureWindowToOpen(visible), null)
})

test('gesture close selects visible windows in reverse order', () => {
  const visible = new Set(['floating', 'toolbox', 'agents'] as const)

  assert.equal(getLastGestureWindowToClose(visible), 'agents')
  visible.delete('agents')
  assert.equal(getLastGestureWindowToClose(visible), 'toolbox')
  visible.delete('toolbox')
  assert.equal(getLastGestureWindowToClose(visible), 'floating')
  visible.delete('floating')
  assert.equal(getLastGestureWindowToClose(visible), null)
})

test('gesture sequence skips windows already visible', () => {
  assert.equal(
    getNextGestureWindowToOpen(new Set(['floating', 'agents'] as const)),
    'toolbox',
  )
  assert.equal(
    getLastGestureWindowToClose(new Set(['floating', 'agents'] as const)),
    'agents',
  )
})
