import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deleteConversation, type StoredConversation } from './conversationHistory'

const history: StoredConversation[] = [
  { id: 'current', title: 'Current', updatedAt: '2026-01-02', messages: [] },
  { id: 'older', title: 'Older', updatedAt: '2026-01-01', messages: [] },
]

test('deleteConversation removes the matching saved conversation and persists the rest', () => {
  let persisted = ''
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem: (_key: string, value: string) => { persisted = value } },
  })

  const next = deleteConversation(history, 'current')

  assert.deepEqual(next.map(({ id }) => id), ['older'])
  assert.deepEqual(JSON.parse(persisted), next)
  assert.deepEqual(history.map(({ id }) => id), ['current', 'older'])
})

test('deleteConversation safely persists unchanged history for an unknown id', () => {
  let persisted = ''
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem: (_key: string, value: string) => { persisted = value } },
  })

  assert.deepEqual(deleteConversation(history, 'missing'), history)
  assert.deepEqual(JSON.parse(persisted), history)
})

test('deleteConversation propagates storage failures so the caller can preserve the active chat', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem: () => { throw new Error('storage unavailable') } },
  })

  assert.throws(() => deleteConversation(history, 'current'), /storage unavailable/)
  assert.deepEqual(history.map(({ id }) => id), ['current', 'older'])
})
