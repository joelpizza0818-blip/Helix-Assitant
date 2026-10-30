import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import { getDomain } from 'tldts'
import { BrowserExtensionBridge } from './browser-extension-bridge'

const siteMatching = require('../browser-extension/site-matching.js') as {
  hasSameOrigin: (left: string, right: string) => boolean
  findMatchingTab: (
    tabs: Array<{ id: number; url: string; active?: boolean; lastAccessed?: number }>,
    targetUrl: string,
    siteKey: string,
  ) => { id: number; url: string; active?: boolean; lastAccessed?: number } | null
}
const pageContextQueue = require('../browser-extension/page-context-queue.js') as {
  createPageContextQueue: () => {
    enqueue: <T>(operation: () => Promise<T> | T) => Promise<T>
  }
}
const browserDebugger = require('../browser-extension/browser-debugger.js') as {
  runAction: (
    debuggerApi: {
      attach: (target: { tabId: number }, version: string) => Promise<void>
      detach: (target: { tabId: number }) => Promise<void>
      sendCommand: (
        target: { tabId: number },
        method: string,
        parameters?: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>
    },
    tabId: number,
    action: string,
    input?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
}

function createBridge() {
  return new BrowserExtensionBridge(
    'unused-token-path',
    'unused-extension-path',
    () => true,
  )
}

test('browser debugger sends page input through CDP and detaches from the managed tab', async () => {
  const calls: Array<{ method: string; parameters?: Record<string, unknown> }> = []
  const debuggerApi = {
    attach: async (target: { tabId: number }, version: string) => {
      calls.push({ method: `attach:${target.tabId}:${version}` })
    },
    detach: async (target: { tabId: number }) => {
      calls.push({ method: `detach:${target.tabId}` })
    },
    sendCommand: async (
      _target: { tabId: number },
      method: string,
      parameters?: Record<string, unknown>,
    ) => {
      calls.push({ method, parameters })
      if (method === 'Page.captureScreenshot') return { data: 'c2NyZWVuc2hvdA==' }
    },
  }

  const clickResult = await browserDebugger.runAction(
    debuggerApi,
    42,
    'click_at',
    { x: 120, y: 80 },
  )
  const typeResult = await browserDebugger.runAction(
    debuggerApi,
    42,
    'type',
    { text: 'HELIX', selectAllKey: 'Control' },
  )
  const selectResult = await browserDebugger.runAction(
    debuggerApi,
    42,
    'select',
    { x: 20, y: 30, optionIndex: 2 },
  )

  assert.deepEqual(clickResult, { clicked: true })
  assert.deepEqual(typeResult, { typed: true })
  assert.deepEqual(selectResult, { selected: true })
  assert.equal(calls.filter(({ method }) => method === 'Input.insertText').length, 1)
  assert.equal(calls.filter(({ method }) => method === 'Input.dispatchMouseEvent').length, 6)
  assert.equal(calls.filter(({ method }) => method === 'Input.dispatchKeyEvent').length, 12)
  const typeKeyEvents = calls.filter(({ method, parameters }) => (
    method === 'Input.dispatchKeyEvent'
    && ['ControlLeft', 'KeyA'].includes(String(parameters?.code))
  )).slice(0, 4)
  assert.deepEqual(typeKeyEvents.map(({ parameters }) => (
    [parameters?.type, parameters?.code, parameters?.modifiers]
  )), [
    ['keyDown', 'ControlLeft', 2],
    ['keyDown', 'KeyA', 2],
    ['keyUp', 'KeyA', 2],
    ['keyUp', 'ControlLeft', 0],
  ])
  assert.ok(calls.findIndex(({ method }) => method === 'Input.insertText') > calls.findIndex(
    ({ method, parameters }) => method === 'Input.dispatchKeyEvent' && parameters?.code === 'KeyA' && parameters?.type === 'keyUp',
  ))
  assert.equal(calls.filter(({ method }) => method === 'attach:42:1.3').length, 3)
  assert.equal(calls.filter(({ method }) => method === 'detach:42').length, 3)

  await browserDebugger.runAction(
    debuggerApi,
    42,
    'drag',
    { x: 10, y: 20, end_x: 30, end_y: 40, button: 'right' },
  )
  const dragMoves = calls.filter(({ method, parameters }) => (
    method === 'Input.dispatchMouseEvent' && parameters?.type === 'mouseMoved'
  )).slice(-8)
  assert.equal(dragMoves.length, 8)
  assert.ok(dragMoves.every(({ parameters }) => (
    parameters?.button === 'right' && parameters?.buttons === 2
  )))
})

test('browser debugger releases a mouse button and detaches after a failed click', async () => {
  let releaseAttempts = 0
  let detached = false
  const debuggerApi = {
    attach: async () => {},
    detach: async () => { detached = true },
    sendCommand: async (
      _target: { tabId: number },
      method: string,
      parameters?: Record<string, unknown>,
    ) => {
      if (
        method === 'Input.dispatchMouseEvent'
        && parameters?.type === 'mouseReleased'
      ) {
        releaseAttempts += 1
        if (releaseAttempts === 1) throw new Error('simulated release failure')
      }
    },
  }

  await assert.rejects(
    browserDebugger.runAction(debuggerApi, 42, 'click_at', { x: 10, y: 20 }),
    /simulated release failure/,
  )
  assert.equal(releaseAttempts, 2)
  assert.equal(detached, true)
})

test('browser debugger selects existing text before typing on macOS', async () => {
  const calls: Array<{ method: string; parameters?: Record<string, unknown> }> = []
  await browserDebugger.runAction({
    attach: async () => {},
    detach: async () => {},
    sendCommand: async (_target, method, parameters) => {
      calls.push({ method, parameters })
    },
  }, 42, 'type', { text: 'replacement', selectAllKey: 'Meta' })

  const keyEvents = calls.filter(({ method }) => method === 'Input.dispatchKeyEvent')
  assert.deepEqual(keyEvents.map(({ parameters }) => (
    [parameters?.type, parameters?.code, parameters?.modifiers]
  )), [
    ['keyDown', 'MetaLeft', 4],
    ['keyDown', 'KeyA', 4],
    ['keyUp', 'KeyA', 4],
    ['keyUp', 'MetaLeft', 0],
  ])
  assert.equal(calls.at(-1)?.method, 'Input.insertText')
})

test('browser page snapshots and clears are applied in enqueue order', async () => {
  const queue = pageContextQueue.createPageContextQueue()
  const events: string[] = []
  let releaseSnapshot: () => void = () => {}
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve
  })

  const snapshot = queue.enqueue(async () => {
    events.push('snapshot-start')
    await snapshotGate
    events.push('snapshot-complete')
  })
  const clear = queue.enqueue(() => {
    events.push('clear')
  })

  await Promise.resolve()
  assert.deepEqual(events, ['snapshot-start'])
  releaseSnapshot()
  await Promise.all([snapshot, clear])
  assert.deepEqual(events, ['snapshot-start', 'snapshot-complete', 'clear'])
})

test('browser companion matches open tabs by registrable site and prefers the plugin host', () => {
  assert.equal(siteMatching.hasSameOrigin('http://localhost:5173/', 'http://localhost:5173/other'), true)
  assert.equal(siteMatching.hasSameOrigin('http://localhost:5173/', 'http://localhost:3000/'), false)
  assert.equal(siteMatching.hasSameOrigin('http://localhost:5173/', 'https://localhost:5173/'), false)

  const siteDomain = (hostname: string) =>
    getDomain(hostname, { allowPrivateDomains: true }) ?? hostname
  assert.equal(
    siteDomain('mail.google.com'),
    siteDomain('docs.google.com'),
  )
  assert.notEqual(
    siteDomain('alice.github.io'),
    siteDomain('bob.github.io'),
  )
  assert.notEqual(
    siteDomain('alice.co.uk'),
    siteDomain('bob.co.uk'),
  )

  const targetSiteKey = `https://${siteDomain('mail.google.com')}`
  const match = siteMatching.findMatchingTab([
    { id: 1, url: 'https://docs.google.com/document', active: true, lastAccessed: 50 },
    { id: 2, url: 'https://mail.google.com/inbox', active: false, lastAccessed: 10 },
    { id: 3, url: 'https://example.com/', active: true, lastAccessed: 100 },
  ], 'https://mail.google.com/', targetSiteKey)
  assert.equal(match?.id, 2)

  const sameSiteMatch = siteMatching.findMatchingTab([
    { id: 4, url: 'https://docs.google.com/document', active: true, lastAccessed: 20 },
    { id: 5, url: 'https://drive.google.com/', active: false, lastAccessed: 10 },
  ], 'https://mail.google.com/', targetSiteKey)
  assert.equal(sameSiteMatch?.id, 4)

  assert.equal(
    siteMatching.findMatchingTab([
      { id: 7, url: 'https://bob.github.io/' },
    ], 'https://alice.github.io/', 'https://alice.github.io'),
    null,
  )

  assert.equal(
    siteMatching.findMatchingTab([
      { id: 6, url: 'https://example.com/' },
    ], 'https://mail.google.com/', targetSiteKey),
    null,
  )
})

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

test('browser companion heartbeat reports rejected and valid pairing tokens', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'helix-browser-bridge-'))
  const bridge = new BrowserExtensionBridge(
    path.join(directory, 'pairing-token'),
    directory,
    () => true,
    0,
  )

  try {
    await bridge.start()
    const { port, token } = bridge.getInfo()
    const validAuthorization = ['Bearer', token].join(' ')
    const headers = {
      Origin: `chrome-extension://${'a'.repeat(32)}`,
      Authorization: 'Bearer invalid-token',
    }

    const waitForQueuedCommand = async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/commands`, {
          headers: { Origin: headers.Origin, Authorization: validAuthorization },
        })
        const body = await response.json() as {
          commands: Array<{ id: string; request: Record<string, unknown> }>
        }
        if (body.commands.length > 0) return body.commands
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('Timed out waiting for a browser command to be queued.')
    }

    const rejected = await fetch(`http://127.0.0.1:${port}/heartbeat`, { headers })
    assert.equal(rejected.status, 401)
    assert.equal(bridge.getInfo().connectionIssue, 'invalid_token')

    const originlessRejectedToken = await fetch(`http://127.0.0.1:${port}/heartbeat`, {
      headers: { Authorization: 'Bearer invalid' },
    })
    assert.equal(originlessRejectedToken.status, 401)
    assert.equal(bridge.getInfo().connectionIssue, 'invalid_token')

    const accepted = await fetch(`http://127.0.0.1:${port}/heartbeat`, {
      headers: { ...headers, Authorization: `Bearer ${token}` },
    })
    assert.equal(accepted.status, 200)
    assert.deepEqual(await accepted.json(), { connected: true })
    assert.equal(bridge.getInfo().extensionConnected, true)
    assert.equal(bridge.getInfo().connectionIssue, null)

    const originlessHeartbeat = await fetch(`http://127.0.0.1:${port}/heartbeat`, {
      headers: { Authorization: validAuthorization },
    })
    assert.equal(originlessHeartbeat.status, 200)
    assert.deepEqual(await originlessHeartbeat.json(), { connected: true })

    const nullOriginHeartbeat = await fetch(`http://127.0.0.1:${port}/heartbeat`, {
      headers: {
        Origin: 'null',
        Authorization: validAuthorization,
      },
    })
    assert.equal(nullOriginHeartbeat.status, 200)
    assert.deepEqual(await nullOriginHeartbeat.json(), { connected: true })

    const originlessCommands = await fetch(`http://127.0.0.1:${port}/commands`, {
      headers: { Authorization: validAuthorization },
    })
    assert.equal(originlessCommands.status, 200)
    assert.deepEqual(await originlessCommands.json(), { commands: [] })

    const nullOriginCommandResult = await fetch(
      `http://127.0.0.1:${port}/commands/unknown`,
      {
        method: 'POST',
        headers: {
          Origin: 'null',
          Authorization: validAuthorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ok: true }),
      },
    )
    assert.equal(nullOriginCommandResult.status, 404)

    const rejectedCommandOrigin = await fetch(`http://127.0.0.1:${port}/commands`, {
      headers: {
        Origin: 'https://example.com',
        Authorization: validAuthorization,
      },
    })
    assert.equal(rejectedCommandOrigin.status, 403)

    const openingPlugin = bridge.openManagedTab('https://mail.google.com/')
    const commands = await waitForQueuedCommand()
    assert.equal(commands.length, 1)
    assert.equal(commands[0].request.site_key, 'https://google.com')

    const commandResult = await fetch(
      `http://127.0.0.1:${port}/commands/${commands[0].id}`,
      {
        method: 'POST',
        headers: {
          Origin: 'null',
          Authorization: validAuthorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ok: true,
          result: { session_id: '9', url: 'https://mail.google.com/' },
        }),
      },
    )
    assert.equal(commandResult.status, 200)
    await openingPlugin

    const snapshotRequest = fetch(`http://127.0.0.1:${port}/control`, {
      method: 'POST',
      headers: {
        Authorization: validAuthorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'snapshot', session_id: '9' }),
    })
    const snapshotCommands = await waitForQueuedCommand()
    assert.equal(snapshotCommands.length, 1)
    assert.equal(snapshotCommands[0].request.action, 'snapshot')
    await fetch(`http://127.0.0.1:${port}/commands/${snapshotCommands[0].id}`, {
      method: 'POST',
      headers: {
        Authorization: validAuthorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ok: true,
        result: { title: 'Inbox', url: 'https://mail.google.com/inbox', text: 'Mail' },
      }),
    })
    const snapshotResponse = await snapshotRequest
    assert.equal(snapshotResponse.status, 200)
    assert.deepEqual(await snapshotResponse.json(), {
      ok: true,
      result: { title: 'Inbox', url: 'https://mail.google.com/inbox', text: 'Mail' },
    })

    const queuedFirst = fetch(`http://127.0.0.1:${port}/control`, {
      method: 'POST',
      headers: {
        Authorization: validAuthorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'snapshot', session_id: '9' }),
    })
    const queuedSecond = fetch(`http://127.0.0.1:${port}/control`, {
      method: 'POST',
      headers: {
        Authorization: validAuthorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'snapshot', session_id: '9' }),
    })
    const firstCommands = await waitForQueuedCommand()
    assert.equal(firstCommands.length, 1)
    await fetch(`http://127.0.0.1:${port}/commands/${firstCommands[0].id}`, {
      method: 'POST',
      headers: {
        Authorization: validAuthorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ok: true, result: { url: 'https://mail.google.com/inbox' } }),
    })
    await queuedFirst
    const secondCommands = await waitForQueuedCommand()
    assert.equal(secondCommands.length, 1)
    await fetch(`http://127.0.0.1:${port}/commands/${secondCommands[0].id}`, {
      method: 'POST',
      headers: {
        Authorization: validAuthorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ok: true, result: { url: 'https://mail.google.com/inbox' } }),
    })
    await queuedSecond

    const invalidSiteKey = await fetch(`http://127.0.0.1:${port}/control`, {
      method: 'POST',
      headers: {
        Authorization: validAuthorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'open_session',
        url: 'https://mail.google.com/',
        site_key: 'https://example.com',
      }),
    })
    assert.equal(invalidSiteKey.status, 400)

    const preflight = await fetch(`http://127.0.0.1:${port}/heartbeat`, {
      method: 'OPTIONS',
      headers: {
        Origin: headers.Origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    assert.equal(preflight.status, 204)

    const rejectedOrigin = await fetch(`http://127.0.0.1:${port}/heartbeat`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
      },
    })
    assert.equal(rejectedOrigin.status, 403)
    assert.deepEqual(await rejectedOrigin.json(), {
      error: 'Only a Chrome or Edge extension can use this endpoint.',
    })
  } finally {
    await bridge.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('browser companion clears cached page context when the selected tab changes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'helix-browser-clear-'))
  let updated = false
  let cleared = false
  const bridge = new BrowserExtensionBridge(
    path.join(directory, 'pairing-token'),
    directory,
    (snapshot) => {
      if (snapshot === null) {
        cleared = true
      } else {
        updated = true
      }
      return true
    },
    0,
  )

  try {
    await bridge.start()
    const { port, token } = bridge.getInfo()
    const headers = {
      Origin: `chrome-extension://${'a'.repeat(32)}`,
      Authorization: ['Bearer', token].join(' '),
      'Content-Type': 'application/json',
    }
    const unauthenticatedClear = await fetch(`http://127.0.0.1:${port}/page/clear`, {
      method: 'POST',
      headers: { Origin: headers.Origin },
    })
    assert.equal(unauthenticatedClear.status, 401)
    const rejectedOriginClear = await fetch(`http://127.0.0.1:${port}/page/clear`, {
      method: 'POST',
      headers: { ...headers, Origin: 'https://example.com' },
    })
    assert.equal(rejectedOriginClear.status, 403)
    assert.equal(updated, false)
    assert.equal(cleared, false)

    const pageResponse = await fetch(`http://127.0.0.1:${port}/page`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Inbox',
        url: 'https://mail.example.com/',
        text: 'Previous page contents',
        links: [],
        forms: [],
        captured_at: new Date().toISOString(),
      }),
    })
    assert.equal(pageResponse.status, 200)
    assert.equal(updated, true)
    assert.equal(bridge.getInfo().lastPage?.url, 'https://mail.example.com/')

    const response = await fetch(`http://127.0.0.1:${port}/page/clear`, {
      method: 'POST',
      headers,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { accepted: true })
    assert.equal(cleared, true)
    assert.equal(bridge.getInfo().lastPage, null)
  } finally {
    await bridge.close()
    await rm(directory, { recursive: true, force: true })
  }
})
