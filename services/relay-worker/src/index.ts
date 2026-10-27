import { DurableObject } from 'cloudflare:workers'

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/
const MAX_MESSAGE_BYTES = 1024 * 1024
const MAX_MOBILE_TEXT_LENGTH = 50_000
const PAIRING_TTL_SECONDS = 5 * 60
const PENDING_TTL_SECONDS = 5 * 60
const DESKTOP_TO_MOBILE_TYPES = new Set([
  'agent_message',
  'status_update',
  'task_update',
  'error',
])

interface Env {
  ROOMS: DurableObjectNamespace<RelayRoom>
}

interface PendingPairing {
  [key: string]: string | number
  request_id: string
  device_name: string
  created_at: number
  expires_at: number
}

interface Device {
  [key: string]: string | number
  device_id: string
  device_name: string
  created_at: number
}

interface SocketAttachment {
  role: 'desktop' | 'pending' | 'mobile'
  requestId?: string
  deviceId?: string
  deviceName?: string
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function randomToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return bytesToBase64Url(new Uint8Array(hash))
}

function isUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
}

function validMessage(data: unknown): data is string | ArrayBuffer {
  return typeof data === 'string' || data instanceof ArrayBuffer
}

function messageText(data: string | ArrayBuffer): string {
  return typeof data === 'string' ? data : new TextDecoder().decode(data)
}

export function sanitizeMobileMessage(
  message: {
    type?: unknown
    payload?: unknown
    request_id?: unknown
  },
  deviceId: string,
  deviceName = 'HELIX Mobile',
): {
  type: 'USER_TEXT'
  payload: {
    text: string
    conversation_id: string
    conversation_history: []
  }
  source_device_id: string
  source_device_name: string
} | null {
  const payload = message.payload
  if (
    message.type !== 'USER_TEXT'
    || message.request_id !== undefined
    || !DEVICE_ID_PATTERN.test(deviceId)
    || !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
  ) {
    return null
  }
  const text = (payload as Record<string, unknown>).text
  if (
    typeof text !== 'string'
    || text.trim().length === 0
    || text.length > MAX_MOBILE_TEXT_LENGTH
  ) {
    return null
  }
  return {
    type: 'USER_TEXT',
    payload: {
      text,
      conversation_id: `mobile_${deviceId}`,
      conversation_history: [],
    },
    source_device_id: deviceId,
    source_device_name: deviceName,
  }
}

export function sanitizeDesktopMessage(
  message: {
    type?: unknown
    payload?: unknown
    target_device_id?: unknown
  },
): {
  type: string
  payload: Record<string, unknown>
  target_device_id: string
} | null {
  if (
    typeof message.type !== 'string'
    || !DESKTOP_TO_MOBILE_TYPES.has(message.type)
    || typeof message.target_device_id !== 'string'
    || !DEVICE_ID_PATTERN.test(message.target_device_id)
    || !message.payload
    || typeof message.payload !== 'object'
    || Array.isArray(message.payload)
  ) {
    return null
  }
  return {
    type: message.type,
    payload: message.payload as Record<string, unknown>,
    target_device_id: message.target_device_id,
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', service: 'helix-mobile-relay' })
    }

    const match = url.pathname.match(/^\/v1\/rooms\/([^/]+)(\/.*)?$/)
    if (!match || !ROOM_ID_PATTERN.test(match[1])) {
      return jsonResponse({ error: 'Not found' }, 404)
    }

    const id = env.ROOMS.idFromName(match[1])
    return env.ROOMS.get(id).fetch(request)
  },
} satisfies ExportedHandler<Env>

export class RelayRoom extends DurableObject<Env> {
  private readonly initialized: Promise<void>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.initialized = ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS invitations (
          token_hash TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL,
          used INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS pairing_requests (
          request_id TEXT PRIMARY KEY,
          device_name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS devices (
          device_id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          device_name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `)
    })
  }

  async fetch(request: Request): Promise<Response> {
    await this.initialized
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/v1\/rooms\/[^/]+/, '')
    if (path === '/register' && request.method === 'POST') return this.register(request)
    if (path === '/invitations' && request.method === 'POST') return this.createInvitation(request)
    if (path === '/pairings' && request.method === 'GET') return this.listPairings(request)
    if (path === '/devices' && request.method === 'GET') return this.listDevices(request)

    const pairingAction = path.match(/^\/pairings\/([A-Za-z0-9_-]{20,64})\/(approve|reject)$/)
    if (pairingAction && request.method === 'POST') {
      return this.resolvePairing(request, pairingAction[1], pairingAction[2])
    }
    const deviceAction = path.match(/^\/devices\/([A-Za-z0-9_-]{20,64})$/)
    if (deviceAction && request.method === 'DELETE') {
      return this.revokeDevice(request, deviceAction[1])
    }
    if (path === '/socket' && isUpgrade(request)) return this.connectSocket(request)
    return jsonResponse({ error: 'Not found' }, 404)
  }

  private async ownerIsAuthorized(request: Request): Promise<boolean> {
    const secret = bearerToken(request)
    if (secret.length < 40) return false
    const stored = this.ctx.storage.sql.exec<{ value: string }>(
      'SELECT value FROM metadata WHERE key = ?',
      'desktop_secret_hash',
    ).toArray()[0]?.value
    if (!stored) return false
    return stored === await digest(secret)
  }

  private async register(request: Request): Promise<Response> {
    const secret = bearerToken(request)
    if (secret.length < 40) return jsonResponse({ error: 'Desktop credential is invalid' }, 401)
    const secretHash = await digest(secret)
    const stored = this.ctx.storage.sql.exec<{ value: string }>(
      'SELECT value FROM metadata WHERE key = ?',
      'desktop_secret_hash',
    ).toArray()[0]?.value
    if (stored && stored !== secretHash) return jsonResponse({ error: 'Room is already registered' }, 409)
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)',
      'desktop_secret_hash',
      secretHash,
    )
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  }

  private async createInvitation(request: Request): Promise<Response> {
    if (!await this.ownerIsAuthorized(request)) return jsonResponse({ error: 'Unauthorized' }, 401)
    let body: { token?: unknown }
    try {
      body = await request.json() as { token?: unknown }
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400)
    }
    if (typeof body.token !== 'string' || body.token.length < 40 || body.token.length > 128) {
      return jsonResponse({ error: 'Invitation token is invalid' }, 400)
    }
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      if (attachment?.role === 'pending') socket.close(4003, 'Invitation rotated')
    }
    this.ctx.storage.sql.exec('DELETE FROM invitations')
    this.ctx.storage.sql.exec('DELETE FROM pairing_requests')
    const expiresAt = Math.floor(Date.now() / 1000) + PAIRING_TTL_SECONDS
    this.ctx.storage.sql.exec(
      'INSERT INTO invitations (token_hash, expires_at, used) VALUES (?, ?, 0)',
      await digest(body.token),
      expiresAt,
    )
    await this.scheduleCleanup()
    return jsonResponse({ expires_at: expiresAt })
  }

  private async listPairings(request: Request): Promise<Response> {
    if (!await this.ownerIsAuthorized(request)) return jsonResponse({ error: 'Unauthorized' }, 401)
    const now = Math.floor(Date.now() / 1000)
    const pairings = this.ctx.storage.sql.exec<PendingPairing>(
      'SELECT request_id, device_name, created_at, expires_at FROM pairing_requests WHERE expires_at > ? ORDER BY created_at',
      now,
    ).toArray()
    return jsonResponse({ pairings })
  }

  private async listDevices(request: Request): Promise<Response> {
    if (!await this.ownerIsAuthorized(request)) return jsonResponse({ error: 'Unauthorized' }, 401)
    const devices = this.ctx.storage.sql.exec<Device>(
      'SELECT device_id, device_name, created_at FROM devices ORDER BY created_at',
    ).toArray()
    return jsonResponse({ devices })
  }

  private async resolvePairing(request: Request, requestId: string, action: string): Promise<Response> {
    if (!await this.ownerIsAuthorized(request)) return jsonResponse({ error: 'Unauthorized' }, 401)
    const pending = this.ctx.storage.sql.exec<PendingPairing>(
      'SELECT request_id, device_name, created_at, expires_at FROM pairing_requests WHERE request_id = ?',
      requestId,
    ).toArray()[0]
    if (!pending || pending.expires_at <= Math.floor(Date.now() / 1000)) {
      return jsonResponse({ error: 'Pairing request expired or no longer exists' }, 404)
    }

    const socket = this.ctx.getWebSockets(`pending:${requestId}`)[0]
    this.ctx.storage.sql.exec('DELETE FROM pairing_requests WHERE request_id = ?', requestId)
    if (action === 'reject') {
      socket?.close(4003, 'Pairing rejected by Desktop')
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    }
    if (!socket) return jsonResponse({ error: 'Mobile connection is no longer active' }, 409)

    const deviceId = crypto.randomUUID().replaceAll('-', '')
    const deviceToken = randomToken()
    const createdAt = Math.floor(Date.now() / 1000)
    this.ctx.storage.sql.exec(
      'INSERT INTO devices (device_id, token_hash, device_name, created_at) VALUES (?, ?, ?, ?)',
      deviceId,
      await digest(deviceToken),
      pending.device_name,
      createdAt,
    )
    const attachment: SocketAttachment = {
      role: 'mobile',
      deviceId,
      deviceName: pending.device_name,
    }
    socket.serializeAttachment(attachment)
    socket.send(JSON.stringify({
      type: 'HELIX_PAIRING_APPROVED',
      payload: { device_id: deviceId, device_token: deviceToken },
    }))
    return jsonResponse({ device_id: deviceId })
  }

  private async revokeDevice(request: Request, deviceId: string): Promise<Response> {
    if (!await this.ownerIsAuthorized(request)) return jsonResponse({ error: 'Unauthorized' }, 401)
    const result = this.ctx.storage.sql.exec('DELETE FROM devices WHERE device_id = ?', deviceId)
    if (result.rowsWritten === 0) return jsonResponse({ error: 'Device not found' }, 404)
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      if (attachment?.role === 'mobile' && attachment.deviceId === deviceId) {
        socket.close(4003, 'Device revoked by Desktop')
      }
    }
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  }

  private async connectSocket(request: Request): Promise<Response> {
    const token = bearerToken(request)
    if (token.length < 40) return jsonResponse({ error: 'Authentication required' }, 401)
    const tokenHash = await digest(token)
    const desktopSecretHash = this.ctx.storage.sql.exec<{ value: string }>(
      'SELECT value FROM metadata WHERE key = ?',
      'desktop_secret_hash',
    ).toArray()[0]?.value
    let attachment: SocketAttachment
    let requestId: string | undefined

    if (desktopSecretHash && desktopSecretHash === tokenHash) {
      for (const socket of this.ctx.getWebSockets('desktop')) socket.close(4002, 'Desktop session replaced')
      attachment = { role: 'desktop' }
    } else {
      const device = this.ctx.storage.sql.exec<{ device_id: string; device_name: string }>(
        'SELECT device_id, device_name FROM devices WHERE token_hash = ?',
        tokenHash,
      ).toArray()[0]
      if (device) {
        for (const socket of this.ctx.getWebSockets()) {
          const current = socket.deserializeAttachment() as SocketAttachment | null
          if (current?.role === 'mobile' && current.deviceId === device.device_id) {
            socket.close(4002, 'Mobile device reconnected')
          }
        }
        attachment = {
          role: 'mobile',
          deviceId: device.device_id,
          deviceName: device.device_name,
        }
      } else {
        const now = Math.floor(Date.now() / 1000)
        const invitation = this.ctx.storage.sql.exec<{ token_hash: string; expires_at: number; used: number }>(
          'SELECT token_hash, expires_at, used FROM invitations WHERE token_hash = ?',
          tokenHash,
        ).toArray()[0]
        if (!invitation || invitation.used || invitation.expires_at <= now) {
          return jsonResponse({ error: 'Invitation is invalid, expired or already used' }, 401)
        }
        if (this.ctx.getWebSockets('desktop').length === 0) {
          return jsonResponse({ error: 'Desktop is offline' }, 409)
        }
        if (this.ctx.storage.sql.exec<{ count: number }>(
          'SELECT COUNT(*) AS count FROM pairing_requests WHERE expires_at > ?',
          now,
        ).toArray()[0]?.count >= 5) {
          return jsonResponse({ error: 'Too many pending pairing requests' }, 429)
        }
        requestId = crypto.randomUUID().replaceAll('-', '')
        const deviceName = (request.headers.get('X-HELIX-Device-Name') ?? 'HELIX Mobile')
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .trim()
          .slice(0, 64) || 'HELIX Mobile'
        this.ctx.storage.sql.exec('UPDATE invitations SET used = 1 WHERE token_hash = ?', tokenHash)
        this.ctx.storage.sql.exec(
          'INSERT INTO pairing_requests (request_id, device_name, created_at, expires_at) VALUES (?, ?, ?, ?)',
          requestId,
          deviceName,
          now,
          now + PENDING_TTL_SECONDS,
        )
        attachment = { role: 'pending', requestId }
        await this.scheduleCleanup()
      }
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const tags = attachment.role === 'pending' && requestId
      ? [`pending:${requestId}`]
      : attachment.role === 'mobile' && attachment.deviceId
        ? ['mobile', `mobile:${attachment.deviceId}`]
        : [attachment.role]
    this.ctx.acceptWebSocket(server, tags)
    server.serializeAttachment(attachment)
    if (attachment.role === 'pending' && requestId) {
      server.send(JSON.stringify({ type: 'HELIX_PAIRING_PENDING', payload: { request_id: requestId } }))
      this.sendToDesktop(JSON.stringify({
        type: 'HELIX_PAIRING_REQUEST',
        payload: {
          request_id: requestId,
          device_name: this.ctx.storage.sql.exec<{ device_name: string }>(
            'SELECT device_name FROM pairing_requests WHERE request_id = ?',
            requestId,
          ).toArray()[0]?.device_name ?? 'HELIX Mobile',
        },
      }))
    } else if (attachment.role === 'mobile' && attachment.deviceId) {
      server.send(JSON.stringify({
        type: 'HELIX_DEVICE_READY',
        payload: { device_id: attachment.deviceId },
      }))
    } else {
      server.send(JSON.stringify({ type: 'HELIX_DESKTOP_READY' }))
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(socket: WebSocket, data: unknown): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null
    if (!attachment || !validMessage(data)) {
      socket.close(4400, 'Invalid WebSocket message')
      return
    }
    const text = messageText(data)
    if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) {
      socket.close(4409, 'Message too large')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      socket.close(4400, 'Invalid JSON message')
      return
    }
    if (
      parsed === null
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
    ) {
      socket.close(4400, 'Invalid message shape')
      return
    }
    const message = parsed as {
      type?: unknown
      payload?: unknown
      request_id?: unknown
      target_device_id?: unknown
    }
    if (attachment.role === 'pending') {
      socket.close(4403, 'Pairing approval required')
      return
    }

    if (attachment.role === 'mobile') {
      const sanitized = attachment.deviceId
        ? sanitizeMobileMessage(message, attachment.deviceId, attachment.deviceName)
        : null
      if (!sanitized) {
        socket.close(4403, 'Mobile permission denied')
        return
      }
      this.sendToDesktop(JSON.stringify(sanitized))
      return
    }

    if (attachment.role === 'desktop') {
      const sanitized = sanitizeDesktopMessage(message)
      if (!sanitized) {
        socket.close(4403, 'Desktop message is not permitted')
        return
      }
      this.sendToMobile(sanitized.target_device_id, JSON.stringify({
        type: sanitized.type,
        payload: sanitized.payload,
      }))
    }
  }

  webSocketClose(socket: WebSocket): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null
    if (attachment?.role === 'pending' && attachment.requestId) {
      this.ctx.storage.sql.exec('DELETE FROM pairing_requests WHERE request_id = ?', attachment.requestId)
    }
  }

  webSocketError(socket: WebSocket): void {
    this.webSocketClose(socket)
  }

  async alarm(): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    this.ctx.storage.sql.exec('DELETE FROM invitations WHERE expires_at <= ?', now)
    const expired = this.ctx.storage.sql.exec<{ request_id: string }>(
      'SELECT request_id FROM pairing_requests WHERE expires_at <= ?',
      now,
    ).toArray()
    for (const request of expired) {
      for (const socket of this.ctx.getWebSockets(`pending:${request.request_id}`)) {
        socket.close(4003, 'Pairing request expired')
      }
      this.ctx.storage.sql.exec('DELETE FROM pairing_requests WHERE request_id = ?', request.request_id)
    }
    await this.scheduleCleanup()
  }

  private sendToDesktop(message: string): void {
    for (const socket of this.ctx.getWebSockets('desktop')) {
      try {
        socket.send(message)
      } catch {
        socket.close(1011, 'Relay send failed')
      }
    }
  }

  private sendToMobile(deviceId: string, message: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      if (attachment?.role !== 'mobile' || attachment.deviceId !== deviceId) continue
      try {
        socket.send(message)
      } catch {
        socket.close(1011, 'Relay send failed')
      }
    }
  }

  private async scheduleCleanup(): Promise<void> {
    const soonest = this.ctx.storage.sql.exec<{ expires_at: number }>(
      `SELECT MIN(expires_at) AS expires_at FROM (
        SELECT expires_at FROM invitations
        UNION ALL
        SELECT expires_at FROM pairing_requests
      )`,
    ).toArray()[0]?.expires_at
    if (typeof soonest === 'number') await this.ctx.storage.setAlarm(soonest * 1000)
    else await this.ctx.storage.deleteAlarm()
  }
}
