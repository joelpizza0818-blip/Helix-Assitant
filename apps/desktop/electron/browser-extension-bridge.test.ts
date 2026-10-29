import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BrowserExtensionBridge } from './browser-extension-bridge'

function createBridge() {
  return new BrowserExtensionBridge(
    'unused-token-path',
    'unused-extension-path',
    () => true,
  )
}

test('managed plugin tabs reject non-HTTPS and credential-bearing URLs', async () => {
  const bridge = createBridge()
  await assert.rejects(
    bridge.openManagedTab('javascript:alert(1)'),
    /secure HTTPS/,
  )
  await assert.rejects(
    bridge.openManagedTab('http://outside.example.com/'),
    /secure HTTPS/,
  )
  await assert.rejects(
    bridge.openManagedTab('https://user:password@example.com/'),
    /secure HTTPS/,
  )
})

test('managed plugin tabs require a running local browser bridge', async () => {
  const bridge = createBridge()
  await assert.rejects(
    bridge.openManagedTab('https://example.com/'),
    /bridge is not running/,
  )
})
