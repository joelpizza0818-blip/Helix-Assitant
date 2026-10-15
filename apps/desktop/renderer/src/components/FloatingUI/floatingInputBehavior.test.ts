import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FLOATING_INPUT_MAX_HEIGHT,
  getFloatingInputKeyAction,
  getFloatingInputSize,
} from './floatingInputBehavior'

test('floating input grows with content, then scrolls at its height limit', () => {
  assert.deepEqual(getFloatingInputSize(74), {
    height: '74px',
    overflowY: 'hidden',
  })
  assert.deepEqual(getFloatingInputSize(320), {
    height: `${FLOATING_INPUT_MAX_HEIGHT}px`,
    overflowY: 'auto',
  })
  assert.equal(getFloatingInputSize(10).height, '38px')
})

test('floating input keyboard actions preserve mentions and multiline entry', () => {
  assert.equal(getFloatingInputKeyAction('ArrowDown', false, true, true), 'move-down')
  assert.equal(getFloatingInputKeyAction('ArrowUp', false, true, true), 'move-up')
  assert.equal(getFloatingInputKeyAction('Tab', false, true, false), 'select-mention')
  assert.equal(getFloatingInputKeyAction('Enter', false, true, true), 'select-mention')
  assert.equal(getFloatingInputKeyAction('Escape', false, true, true), 'dismiss-mentions')
  assert.equal(getFloatingInputKeyAction('Enter', false, true, false), 'send')
  assert.equal(getFloatingInputKeyAction('Enter', true, false, false), 'none')
})
