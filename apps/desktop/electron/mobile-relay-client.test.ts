import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import WebSocket, { WebSocketServer, type RawData } from 'ws'

import { MobileRelayClient } from './mobile-relay-client'

function respond(response: ServerResponse, status: number, body?: unknown): void {
  response.statusCode = status
  if (body === undefined) {
    response.end()
    return
  }
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

test('registers the Desktop, approves pairing, and routes messages to one device', async () => {
  const configDirectory = mkdtempSync(path.join(tmpdir(), 'helix-mobile-relay-'))
  const configPath = path.join(configDirectory, 'relay.json')
  const requests: string[] = []
  let resolveDesktopSocket!: (socket: WebSocket) => void
  const desktopSocketPromise = new Promise<WebSocket>((resolve) => {
    resolveDesktopSocket = resolve
  })
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    requests.push(`${request.method} ${url.pathname}`)
    if (url.pathname.endsWith('/register') && request.method === 'POST') {
      respond(response, 204)
      return
    }
    if (url.pathname.endsWith('/invitations') && request.method === 'POST') {
      respond(response, 200, { expires_at: Math.floor(Date.now() / 1000) + 300 })
      return
    }
    if (url.pathname.endsWith('/pairings/abcdefghijklmnopqrstuvwxyz123456/approve')) {
      respond(response, 204)
      return
    }
    if (url.pathname.endsWith('/devices') && request.method === 'GET') {
      respond(response, 200, { devices: [] })
      return
    }
    respond(response, 404, { error: 'Not found' })
  })
  const webSocketServer = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      resolveDesktopSocket(webSocket)
      webSocket.send(JSON.stringify({ type: 'HELIX_DESKTOP_READY' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  let approvedDeviceName = ''
  let receivedMobileMessage: { deviceId: string; text: string } | null = null
  let receivedMobileConfirmation: {
    deviceId: string
    requestId: string
    approved: boolean
  } | null = null
  let receivedMobileSubagentQuery: {
    action: string
    profileId?: string
    message?: string
  } | null = null
  const client = new MobileRelayClient(configPath, {
    approvePairing: async (deviceName) => {
      approvedDeviceName = deviceName
      return true
    },
    receiveMobileText: async (deviceId, _deviceName, text) => {
      receivedMobileMessage = { deviceId, text }
      return true
    },
    getMobileSkillSuggestions: async () => [
      { name: 'research', description: 'Research a topic.' },
    ],
    receiveMobileConfirmation: async (deviceId, requestId, approved) => {
      receivedMobileConfirmation = { deviceId, requestId, approved }
      return true
    },
    queryMobileSubagent: async (action, payload) => {
      receivedMobileSubagentQuery = { action, ...payload }
      return { response: 'Subagent ready' }
    },
  }, {
    encrypt: (value) => Buffer.from(value).toString('base64'),
    decrypt: (value) => Buffer.from(value, 'base64').toString('utf8'),
  })
  let desktopSocket: WebSocket | null = null

  try {
    await client.setWorkerApiUrl(`http://127.0.0.1:${port}`)
    assert.equal(client.connected, true)
    const savedConfig = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    assert.equal('desktopCredential' in savedConfig, false)
    assert.equal(typeof savedConfig.desktopCredentialCiphertext, 'string')
    desktopSocket = await desktopSocketPromise
    assert.equal(requests[0].split(' ')[0], 'POST')
    const invitation = await client.createInvitation()
    assert.equal(invitation.version, 2)
    assert.equal(invitation.requiresDeviceApproval, true)
    assert.match(invitation.relayWssUrl, /^ws:\/\/127\.0\.0\.1:/)
    assert.equal((await client.listDevices()).length, 0)
    const roomId = new URL(invitation.relayWssUrl).pathname.split('/')[3]

    const socket = desktopSocket
    assert.ok(socket)
    socket.send(JSON.stringify({
      type: 'HELIX_PAIRING_REQUEST',
      payload: {
        request_id: 'abcdefghijklmnopqrstuvwxyz123456',
        device_name: 'Test phone',
      },
    }))
    for (let attempt = 0; attempt < 20 && !approvedDeviceName; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(approvedDeviceName, 'Test phone')
    const approvalRequest = `POST /v1/rooms/${roomId}/pairings/abcdefghijklmnopqrstuvwxyz123456/approve`
    for (let attempt = 0; attempt < 20 && !requests.includes(approvalRequest); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.ok(requests.includes(approvalRequest))

    socket.send(JSON.stringify({
      type: 'USER_TEXT',
      source_device_id: 'abcdefghijklmnopqrstuvwxyz123456',
      source_device_name: 'Test phone',
      payload: { text: 'Read my desktop status' },
    }))
    for (let attempt = 0; attempt < 20 && !receivedMobileMessage; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.deepEqual(receivedMobileMessage, {
      deviceId: 'abcdefghijklmnopqrstuvwxyz123456',
      text: 'Read my desktop status',
    })
    let skillsResponse: Record<string, unknown> | null = null
    const skillsResponseListener = (raw: RawData) => {
      const routed = JSON.parse(raw.toString()) as Record<string, unknown>
      if (routed.type === 'skills_response') skillsResponse = routed
    }
    socket.on('message', skillsResponseListener)
    socket.send(JSON.stringify({
      type: 'SKILLS_REQUEST',
      source_device_id: 'abcdefghijklmnopqrstuvwxyz123456',
      source_device_name: 'Test phone',
      payload: {},
    }))
    for (let attempt = 0; attempt < 20 && !skillsResponse; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    socket.off('message', skillsResponseListener)
    assert.deepEqual(skillsResponse, {
      type: 'skills_response',
      target_device_id: 'abcdefghijklmnopqrstuvwxyz123456',
      payload: {
        skills: [{ name: 'research', description: 'Research a topic.' }],
      },
    })
    const requestId = '7d1c9a50-cc15-4f4a-9ddb-0afc61fd9b83'
    socket.send(JSON.stringify({
      type: 'CONFIRMATION_RESPONSE',
      source_device_id: 'abcdefghijklmnopqrstuvwxyz123456',
      payload: { request_id: requestId, approved: true },
    }))
    for (let attempt = 0; attempt < 20 && !receivedMobileConfirmation; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.deepEqual(receivedMobileConfirmation, {
      deviceId: 'abcdefghijklmnopqrstuvwxyz123456',
      requestId,
      approved: true,
    })

    let subagentResponse: Record<string, unknown> | null = null
    const subagentResponseListener = (raw: RawData) => {
      const routed = JSON.parse(raw.toString()) as Record<string, unknown>
      if (routed.type === 'subagent_response') subagentResponse = routed
    }
    socket.on('message', subagentResponseListener)
    const correlationId = '1720000000000000-123456789'
    socket.send(JSON.stringify({
      type: 'SUBAGENT_QUERY',
      source_device_id: 'abcdefghijklmnopqrstuvwxyz123456',
      source_device_name: 'Test phone',
      payload: {
        action: 'chat',
        correlation_id: correlationId,
        profile_id: 'research',
        message: 'Summarize this',
      },
    }))
    for (let attempt = 0; attempt < 20 && !subagentResponse; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    socket.off('message', subagentResponseListener)
    assert.deepEqual(receivedMobileSubagentQuery, {
      action: 'chat',
      profile_id: 'research',
      message: 'Summarize this',
    })
    assert.deepEqual(subagentResponse, {
      type: 'subagent_response',
      target_device_id: 'abcdefghijklmnopqrstuvwxyz123456',
      payload: {
        correlation_id: correlationId,
        result: { response: 'Subagent ready' },
      },
    })

    const routedMessage = once(socket, 'message')
    client.sendAgentEvent({
      type: 'agent_message',
      payload: {
        conversation_id: 'mobile_abcdefghijklmnopqrstuvwxyz123456',
        text: 'Approved response',
      },
    })
    const [routedRaw] = await routedMessage
    assert.deepEqual(JSON.parse(routedRaw.toString()), {
      type: 'agent_message',
      target_device_id: 'abcdefghijklmnopqrstuvwxyz123456',
      payload: {
        conversation_id: 'mobile_abcdefghijklmnopqrstuvwxyz123456',
        text: 'Approved response',
      },
    })

    socket.send(JSON.stringify({
      type: 'BROWSER_LIVE_CONTROL',
      source_device_id: 'abcdefghijklmnopqrstuvwxyz123456',
      payload: { paused: true },
    }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    let receivedPausedFrame = false
    const pausedFrameListener = () => {
      receivedPausedFrame = true
    }
    socket.on('message', pausedFrameListener)
    client.sendAgentEvent({
      type: 'browser_frame',
      payload: {
        conversation_id: 'mobile_abcdefghijklmnopqrstuvwxyz123456',
        mime_type: 'image/jpeg',
        image_base64: 'aGVsbG8=',
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    socket.off('message', pausedFrameListener)
    assert.equal(receivedPausedFrame, false)

    socket.send(JSON.stringify({
      type: 'BROWSER_LIVE_CONTROL',
      source_device_id: 'abcdefghijklmnopqrstuvwxyz123456',
      payload: { paused: false },
    }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    const browserFrameMessage = once(socket, 'message')
    client.sendAgentEvent({
      type: 'browser_frame',
      payload: {
        conversation_id: 'mobile_abcdefghijklmnopqrstuvwxyz123456',
        mime_type: 'image/jpeg',
        image_base64: 'aGVsbG8=',
      },
    })
    const [frameRaw] = await browserFrameMessage
    assert.deepEqual(JSON.parse(frameRaw.toString()), {
      type: 'browser_frame',
      target_device_id: 'abcdefghijklmnopqrstuvwxyz123456',
      payload: {
        conversation_id: 'mobile_abcdefghijklmnopqrstuvwxyz123456',
        mime_type: 'image/jpeg',
        image_base64: 'aGVsbG8=',
      },
    })
  } finally {
    client.close()
    desktopSocket?.close()
    await new Promise<void>((resolve) => webSocketServer.close(() => resolve()))
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(configDirectory, { recursive: true, force: true })
  }
})
