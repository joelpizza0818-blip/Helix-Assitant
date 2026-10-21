import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createWebSocketToken,
  websocketAuthHeaders,
  websocketTokenEnvironment,
} from './websocket-auth'

test('creates a cryptographically random token for the agent process', () => {
  const token = createWebSocketToken()

  assert.match(token, /^[a-f0-9]{64}$/)
  assert.notEqual(createWebSocketToken(), token)
})

test('sends the token in the WebSocket authorization handshake header', () => {
  assert.deepEqual(websocketAuthHeaders('agent-token'), {
    Authorization: 'Bearer agent-token',
  })
})

test('passes the token to the agent only through its process environment', () => {
  assert.deepEqual(websocketTokenEnvironment('agent-token'), {
    HELIX_WS_TOKEN: 'agent-token',
  })
})
