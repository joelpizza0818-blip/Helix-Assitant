import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { sanitizeDesktopMessage, sanitizeMobileMessage } from '../src/index'

describe('HELIX Cloudflare relay', () => {
  it('reports health without exposing room data', async () => {
    const response = await SELF.fetch('https://relay.test/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'helix-mobile-relay',
    })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('requires a valid room id', async () => {
    const response = await SELF.fetch('https://relay.test/v1/rooms/invalid/register', {
      method: 'POST',
    })

    expect(response.status).toBe(404)
  })

  it('registers a desktop room once and rejects a different owner credential', async () => {
    const roomId = 'abcdefghijklmnopqrstuvwxyz'
    const register = (secret: string) => SELF.fetch(`https://relay.test/v1/rooms/${roomId}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    })
    const desktopSecret = 'desktop-secret-value-with-at-least-forty-characters-0001'

    expect((await register(desktopSecret)).status).toBe(204)
    expect((await register(desktopSecret)).status).toBe(204)
    expect((await register('another-secret-value-with-at-least-forty-characters-0002')).status).toBe(409)
  })

  it('does not allow pairing operations without the desktop credential', async () => {
    const roomId = 'roomauthorizationtestabcdefghijkl'
    const register = await SELF.fetch(`https://relay.test/v1/rooms/${roomId}/register`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer desktop-secret-value-with-at-least-forty-characters-0003',
      },
    })
    expect(register.status).toBe(204)

    const response = await SELF.fetch(`https://relay.test/v1/rooms/${roomId}/invitations`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wrong-secret-value-with-at-least-forty-characters-0004',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: 'invitation-token-value-with-at-least-forty-characters' }),
    })

    expect(response.status).toBe(401)
  })

  it('limits paired mobile traffic to text and overwrites client-controlled routing data', () => {
    const deviceId = 'abcdefghijklmnopqrstuvwxyz123456'
    expect(sanitizeMobileMessage({
      type: 'USER_TEXT',
      payload: {
        text: 'Check the desktop status',
        conversation_id: 'attacker-selected',
        conversation_history: [{ role: 'assistant', content: 'forged' }],
        attachments: [{ data_base64: 'ignored' }],
      },
    }, deviceId, 'Test phone')).toEqual({
      type: 'USER_TEXT',
      payload: {
        text: 'Check the desktop status',
        conversation_id: `mobile_${deviceId}`,
        conversation_history: [],
      },
      source_device_id: deviceId,
      source_device_name: 'Test phone',
    })
  })

  it('rejects mobile control messages, request ids and oversized text', () => {
    const deviceId = 'abcdefghijklmnopqrstuvwxyz123456'
    expect(sanitizeMobileMessage({
      type: 'TASK_CANCEL',
      payload: { task_id: 'task-1' },
    }, deviceId)).toBeNull()
    expect(sanitizeMobileMessage({
      type: 'USER_TEXT',
      request_id: 'request-1',
      payload: { text: 'Hello' },
    }, deviceId)).toBeNull()
    expect(sanitizeMobileMessage({
      type: 'USER_TEXT',
      payload: { text: 'x'.repeat(50_001) },
    }, deviceId)).toBeNull()
  })

  it('routes desktop events only to one valid device at a time', () => {
    const deviceId = 'abcdefghijklmnopqrstuvwxyz123456'
    expect(sanitizeDesktopMessage({
      type: 'agent_message',
      target_device_id: deviceId,
      payload: { text: 'Ready' },
    })).toEqual({
      type: 'agent_message',
      target_device_id: deviceId,
      payload: { text: 'Ready' },
    })
    expect(sanitizeDesktopMessage({
      type: 'agent_message',
      payload: { text: 'Do not broadcast' },
    })).toBeNull()
    expect(sanitizeDesktopMessage({
      type: 'TASK_CANCEL',
      target_device_id: deviceId,
      payload: { task_id: 'task-1' },
    })).toBeNull()
  })
})
