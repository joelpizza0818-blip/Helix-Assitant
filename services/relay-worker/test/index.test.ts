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

  it('limits paired mobile traffic to text and confirmation responses', () => {
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

  it('accepts only a well-formed response to an agent confirmation request', () => {
    const deviceId = 'abcdefghijklmnopqrstuvwxyz123456'
    const requestId = '7d1c9a50-cc15-4f4a-9ddb-0afc61fd9b83'
    expect(sanitizeMobileMessage({
      type: 'CONFIRMATION_RESPONSE',
      payload: { request_id: requestId, approved: true },
    }, deviceId, 'Test phone')).toEqual({
      type: 'CONFIRMATION_RESPONSE',
      payload: { request_id: requestId, approved: true },
      source_device_id: deviceId,
      source_device_name: 'Test phone',
    })

    expect(sanitizeMobileMessage({
      type: 'CONFIRMATION_RESPONSE',
      payload: { request_id: requestId, approved: true, task_id: 'forged' },
    }, deviceId)).toEqual({
      type: 'CONFIRMATION_RESPONSE',
      payload: { request_id: requestId, approved: true },
      source_device_id: deviceId,
      source_device_name: 'HELIX Mobile',
    })
    expect(sanitizeMobileMessage({
      type: 'CONFIRMATION_RESPONSE',
      payload: { request_id: 'not-a-uuid', approved: true },
    }, deviceId)).toBeNull()
  })

  it('allows paired devices to request skill names and descriptions only', () => {
    const deviceId = 'abcdefghijklmnopqrstuvwxyz123456'
    expect(sanitizeMobileMessage({
      type: 'SKILLS_REQUEST',
      payload: {},
    }, deviceId)).toEqual({
      type: 'SKILLS_REQUEST',
      payload: {},
      source_device_id: deviceId,
      source_device_name: 'HELIX Mobile',
    })
    expect(sanitizeMobileMessage({
      type: 'SKILLS_REQUEST',
      request_id: 'forged',
      payload: {},
    }, deviceId)).toBeNull()
    expect(sanitizeDesktopMessage({
      type: 'skills_response',
      target_device_id: deviceId,
      payload: {
        skills: [{ name: 'research', description: 'Research a topic.' }],
      },
    })?.payload).toEqual({
      skills: [{ name: 'research', description: 'Research a topic.' }],
    })
    expect(sanitizeDesktopMessage({
      type: 'skills_response',
      target_device_id: deviceId,
      payload: {
        skills: [{ name: 'research', description: 'Research a topic.', instructions: 'private' }],
      },
    })?.payload).toEqual({
      skills: [{ name: 'research', description: 'Research a topic.' }],
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
    const requestId = '7d1c9a50-cc15-4f4a-9ddb-0afc61fd9b83'
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
    expect(sanitizeDesktopMessage({
      type: 'confirmation_request',
      target_device_id: deviceId,
      payload: {
        id: requestId,
        conversation_id: `mobile_${deviceId}`,
        action: 'open_file',
      },
    })?.type).toBe('confirmation_request')
    expect(sanitizeDesktopMessage({
      type: 'confirmation_request',
      target_device_id: deviceId,
      payload: {
        id: requestId,
        conversation_id: 'mobile_another-device',
      },
    })).toBeNull()
  })

  it('validates correlated subagent queries and responses', () => {
    const deviceId = 'abcdefghijklmnopqrstuvwxyz123456'
    const correlationId = '1720000000000000-123456789'
    expect(sanitizeMobileMessage({
      type: 'SUBAGENT_QUERY',
      payload: {
        action: 'chat',
        correlation_id: correlationId,
        profile_id: 'research',
        message: 'Summarize this',
        private_context: 'discarded',
      },
    }, deviceId)).toEqual({
      type: 'SUBAGENT_QUERY',
      payload: {
        action: 'chat',
        correlation_id: correlationId,
        profile_id: 'research',
        message: 'Summarize this',
      },
      source_device_id: deviceId,
      source_device_name: 'HELIX Mobile',
    })
    expect(sanitizeMobileMessage({
      type: 'SUBAGENT_QUERY',
      payload: { action: 'chat', correlation_id: correlationId, message: 'Missing profile' },
    }, deviceId)).toBeNull()
    expect(sanitizeMobileMessage({
      type: 'SUBAGENT_QUERY',
      payload: { action: 'other', correlation_id: correlationId },
    }, deviceId)).toBeNull()
    expect(sanitizeDesktopMessage({
      type: 'subagent_response',
      target_device_id: deviceId,
      payload: {
        correlation_id: correlationId,
        result: { response: 'Ready' },
        private_context: 'discarded',
      },
    })).toEqual({
      type: 'subagent_response',
      target_device_id: deviceId,
      payload: {
        correlation_id: correlationId,
        result: { response: 'Ready' },
      },
    })
    expect(sanitizeDesktopMessage({
      type: 'subagent_response',
      target_device_id: deviceId,
      payload: { correlation_id: 'invalid id', result: {} },
    })).toBeNull()
  })

  it('relays only local voice capture and never grants Desktop microphone access', () => {
    const deviceId = 'abcdefghijklmnopqrstuvwxyz123456'
    const sessionId = 'mobile_voice_session_0001'
    expect(sanitizeMobileMessage({
      type: 'VOICE_MESSAGE',
      payload: {
        voice_type: 'VOICE_SESSION_START',
        voice_payload: {
          session_id: sessionId,
          mode: 'live',
          server_audio: true,
          language: 'es',
          silence_ms: 600,
          extra: 'discarded',
        },
      },
    }, deviceId, 'Test phone')).toEqual({
      type: 'VOICE_MESSAGE',
      payload: {
        voice_type: 'VOICE_SESSION_START',
        voice_payload: {
          session_id: sessionId,
          mode: 'live',
          server_audio: false,
          language: 'es',
          silence_ms: 600,
        },
      },
      source_device_id: deviceId,
      source_device_name: 'Test phone',
    })
    expect(sanitizeMobileMessage({
      type: 'VOICE_MESSAGE',
      payload: {
        voice_type: 'VOICE_AUDIO_CHUNK',
        voice_payload: {
          session_id: sessionId,
          audio_base64: 'AAAAAA==',
          sample_rate: 16000,
          channels: 1,
          extra: 'discarded',
        },
      },
    }, deviceId)?.payload.voice_payload).toEqual({
      session_id: sessionId,
      audio_base64: 'AAAAAA==',
      sample_rate: 16000,
      channels: 1,
    })
    expect(sanitizeMobileMessage({
      type: 'VOICE_MESSAGE',
      payload: {
        voice_type: 'VOICE_AUDIO_CHUNK',
        voice_payload: {
          session_id: sessionId,
          audio_base64: 'AAAAAA==',
          sample_rate: 44100,
          channels: 2,
        },
      },
    }, deviceId)).toBeNull()
    expect(sanitizeMobileMessage({
      type: 'VOICE_MESSAGE',
      payload: {
        voice_type: 'VOICE_SERVER_AUDIO_START',
        voice_payload: { session_id: sessionId },
      },
    }, deviceId)).toBeNull()
  })

  it('routes voice events back only to the owning device', () => {
    const deviceId = 'abcdefghijklmnopqrstuvwxyz123456'
    const sessionId = 'relay_voice_session_0001'
    expect(sanitizeDesktopMessage({
      type: 'VOICE_MESSAGE',
      target_device_id: deviceId,
      payload: {
        voice_type: 'VOICE_TRANSCRIPT',
        voice_payload: {
          session_id: sessionId,
          text: 'Hola',
          final: true,
          private_context: 'discarded by the relay',
        },
      },
    })).toEqual({
      type: 'VOICE_MESSAGE',
      target_device_id: deviceId,
      payload: {
        voice_type: 'VOICE_TRANSCRIPT',
        voice_payload: {
          session_id: sessionId,
          text: 'Hola',
          final: true,
        },
      },
    })
    expect(sanitizeDesktopMessage({
      type: 'VOICE_MESSAGE',
      target_device_id: deviceId,
      payload: {
        voice_type: 'VOICE_AUDIO_SEGMENT',
        voice_payload: {
          session_id: sessionId,
          index: 0,
          audio_base64: 'UklGRg==',
          mime_type: 'audio/wav',
        },
      },
    })?.payload.voice_payload).toEqual({
      session_id: sessionId,
      index: 0,
      audio_base64: 'UklGRg==',
      mime_type: 'audio/wav',
    })
    expect(sanitizeDesktopMessage({
      type: 'VOICE_MESSAGE',
      target_device_id: deviceId,
      payload: {
        voice_type: 'VOICE_SERVER_AUDIO_START',
        voice_payload: { session_id: sessionId },
      },
    })).toBeNull()
    expect(sanitizeDesktopMessage({
      type: 'VOICE_MESSAGE',
      target_device_id: deviceId,
      payload: {
        voice_type: 'VOICE_AUDIO_SEGMENT',
        voice_payload: { session_id: sessionId, audio_base64: '<script>' },
      },
    })).toBeNull()
  })

  it('validates browser frames and per-device live-view controls', () => {
    const deviceId = 'abcdefghijklmnopqrstuvwxyz123456'
    expect(sanitizeMobileMessage({
      type: 'BROWSER_LIVE_CONTROL',
      payload: { paused: true, extra: 'discarded' },
    }, deviceId)).toEqual({
      type: 'BROWSER_LIVE_CONTROL',
      payload: { paused: true },
      source_device_id: deviceId,
      source_device_name: 'HELIX Mobile',
    })
    expect(sanitizeMobileMessage({
      type: 'BROWSER_LIVE_CONTROL',
      payload: { paused: 'true' },
    }, deviceId)).toBeNull()
    expect(sanitizeDesktopMessage({
      type: 'browser_frame',
      target_device_id: deviceId,
      payload: {
        conversation_id: `mobile_${deviceId}`,
        mime_type: 'image/jpeg',
        image_base64: 'aGVsbG8=',
        extra: 'discarded',
      },
    })).toEqual({
      type: 'browser_frame',
      target_device_id: deviceId,
      payload: {
        conversation_id: `mobile_${deviceId}`,
        mime_type: 'image/jpeg',
        image_base64: 'aGVsbG8=',
      },
    })
    expect(sanitizeDesktopMessage({
      type: 'browser_frame',
      target_device_id: deviceId,
      payload: {
        conversation_id: 'mobile_another-device',
        mime_type: 'image/jpeg',
        image_base64: 'aGVsbG8=',
      },
    })).toBeNull()
  })
})
