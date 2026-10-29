import { randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'
import WebSocket from 'ws'

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/
const PAIRING_TTL_MS = 5 * 60 * 1000
const SOCKET_CONNECT_TIMEOUT_MS = 12_000
const RECONNECT_DELAY_MS = 3_000

interface RelayCredentials {
  workerApiUrl: string
  roomId: string
  desktopCredential: string
}

interface CredentialProtector {
  encrypt: (value: string) => string
  decrypt: (value: string) => string
}

interface PairingInvitation {
  version: 2
  host: string
  sshPort: number
  remoteWsPort: number
  token: string
  expiresAt: string
  relayWssUrl: string
  requiresDeviceApproval: true
}

export interface PairedMobileDevice {
  device_id: string
  device_name: string
  created_at: number
}

interface RelayClientHandlers {
  approvePairing: (deviceName: string) => Promise<boolean>
  receiveMobileText: (deviceId: string, deviceName: string, text: string) => Promise<boolean>
  getMobileSkillSuggestions: () => Promise<Array<{ name: string; description: string }>>
  receiveMobileConfirmation: (
    deviceId: string,
    requestId: string,
    approved: boolean,
  ) => Promise<boolean>
  queryMobileSubagent: (
    action: 'list_profiles' | 'get_status' | 'chat',
    payload: { profile_id?: string; message?: string },
  ) => Promise<Record<string, unknown>>
}

interface RelayMessage {
  type?: unknown
  payload?: unknown
  source_device_id?: unknown
  source_device_name?: unknown
}

function randomCredential(): string {
  return randomBytes(32).toString('base64url')
}

function normalizeWorkerUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new TypeError('Worker URL is invalid.')
  }
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (
    (url.protocol !== 'https:' && !(localHost && url.protocol === 'http:'))
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new TypeError('Worker URL must be an HTTPS origin.')
  }
  return url.origin
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class MobileRelayClient {
  private credentials: RelayCredentials | null = null
  private socket: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private closing = false
  private readonly pausedBrowserDevices = new Set<string>()

  constructor(
    private readonly configPath: string,
    private readonly handlers: RelayClientHandlers,
    private readonly credentialProtector: CredentialProtector,
  ) {}

  get workerApiUrl(): string {
    return this.credentials?.workerApiUrl ?? ''
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  async initialize(defaultWorkerApiUrl = ''): Promise<void> {
    const stored = this.readCredentials()
    if (stored) {
      this.credentials = stored
    } else if (defaultWorkerApiUrl.trim()) {
      const credentials = this.createCredentials(defaultWorkerApiUrl)
      this.writeCredentials(credentials)
      this.credentials = credentials
    } else {
      return
    }

    await this.registerRoom()
    await this.openSocket()
  }

  async setWorkerApiUrl(value: string): Promise<string> {
    if (!value.trim()) {
      this.close()
      this.credentials = null
      fs.rmSync(this.configPath, { force: true })
      return ''
    }
    const workerApiUrl = normalizeWorkerUrl(value)
    if (workerApiUrl === this.credentials?.workerApiUrl) {
      if (!this.connected) {
        await this.registerRoom()
        await this.openSocket()
      }
      return workerApiUrl
    }

    this.disconnectSocket()
    this.closing = false
    const credentials = this.createCredentials(workerApiUrl)
    this.writeCredentials(credentials)
    this.credentials = credentials
    await this.registerRoom()
    await this.openSocket()
    return workerApiUrl
  }

  async createInvitation(): Promise<PairingInvitation> {
    const credentials = this.requireCredentials()
    if (!this.connected) throw new Error('The mobile relay is not connected.')

    const token = randomCredential()
    const response = await this.request('POST', '/invitations', { token })
    if (!isRecord(response) || typeof response.expires_at !== 'number') {
      throw new Error('The relay returned an invalid invitation expiry.')
    }
    const relayWssUrl = this.socketUrl(credentials)
    return {
      version: 2,
      host: relayWssUrl,
      sshPort: 22,
      remoteWsPort: 0,
      token,
      expiresAt: new Date(response.expires_at * 1000).toISOString(),
      relayWssUrl,
      requiresDeviceApproval: true,
    }
  }

  async listDevices(): Promise<PairedMobileDevice[]> {
    const response = await this.request('GET', '/devices')
    if (!isRecord(response) || !Array.isArray(response.devices)) {
      throw new Error('The relay returned an invalid device list.')
    }
    return response.devices.map((value) => {
      if (
        !isRecord(value)
        || typeof value.device_id !== 'string'
        || !DEVICE_ID_PATTERN.test(value.device_id)
        || typeof value.device_name !== 'string'
        || typeof value.created_at !== 'number'
      ) {
        throw new Error('The relay returned an invalid device entry.')
      }
      return {
        device_id: value.device_id,
        device_name: value.device_name,
        created_at: value.created_at,
      }
    })
  }

  async revokeDevice(deviceId: string): Promise<void> {
    if (!DEVICE_ID_PATTERN.test(deviceId)) throw new TypeError('Device ID is invalid.')
    await this.request('DELETE', `/devices/${deviceId}`)
  }

  sendAgentEvent(message: { type: string; payload: Record<string, unknown> }): void {
    if (!this.connected || !this.socket) return
    if (![
      'agent_message',
      'status_update',
      'task_update',
      'confirmation_request',
      'confirmation_resolved',
      'error',
      'browser_frame',
    ].includes(message.type)) return
    const conversationId = message.payload.conversation_id
    if (typeof conversationId !== 'string') return
    const match = conversationId.match(/^mobile_([A-Za-z0-9_-]{20,64})$/)
    if (!match) return
    if (message.type === 'browser_frame' && this.pausedBrowserDevices.has(match[1])) {
      return
    }
    this.sendDeviceEvent(match[1], message.type, message.payload)
  }

  close(): void {
    this.closing = true
    this.disconnectSocket()
  }

  private createCredentials(workerApiUrl: string): RelayCredentials {
    return {
      workerApiUrl: normalizeWorkerUrl(workerApiUrl),
      roomId: randomCredential(),
      desktopCredential: randomCredential(),
    }
  }

  private readCredentials(): RelayCredentials | null {
    let raw: string
    try {
      raw = fs.readFileSync(this.configPath, 'utf8')
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return null
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('The saved mobile relay configuration is invalid JSON.')
    }
    if (
      !isRecord(parsed)
      || typeof parsed.workerApiUrl !== 'string'
      || typeof parsed.roomId !== 'string'
      || !ROOM_ID_PATTERN.test(parsed.roomId)
      || typeof parsed.desktopCredentialCiphertext !== 'string'
    ) {
      throw new Error('The saved mobile relay credentials are invalid.')
    }
    const desktopCredential = this.credentialProtector.decrypt(parsed.desktopCredentialCiphertext)
    if (!TOKEN_PATTERN.test(desktopCredential)) {
      throw new Error('The saved mobile relay credential could not be decrypted.')
    }
    return {
      workerApiUrl: normalizeWorkerUrl(parsed.workerApiUrl),
      roomId: parsed.roomId,
      desktopCredential,
    }
  }

  private writeCredentials(credentials: RelayCredentials): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true })
    fs.writeFileSync(this.configPath, JSON.stringify({
      workerApiUrl: credentials.workerApiUrl,
      roomId: credentials.roomId,
      desktopCredentialCiphertext: this.credentialProtector.encrypt(credentials.desktopCredential),
    }, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    })
  }

  private requireCredentials(): RelayCredentials {
    if (!this.credentials) throw new Error('The mobile relay Worker URL is not configured.')
    return this.credentials
  }

  private roomPath(pathname: string): string {
    const credentials = this.requireCredentials()
    return `/v1/rooms/${credentials.roomId}${pathname}`
  }

  private socketUrl(credentials: RelayCredentials): string {
    const url = new URL(this.roomPath('/socket'), credentials.workerApiUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
  }

  private async request(method: string, pathname: string, body?: unknown): Promise<unknown> {
    const credentials = this.requireCredentials()
    const response = await fetch(new URL(this.roomPath(pathname), credentials.workerApiUrl), {
      method,
      headers: {
        Authorization: `Bearer ${credentials.desktopCredential}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 204) return undefined
    const responseText = await response.text()
    let result: unknown
    try {
      result = JSON.parse(responseText)
    } catch {
      result = null
    }
    if (!response.ok) {
      const errorMessage = isRecord(result) && typeof result.error === 'string'
        ? result.error
        : `Relay request failed with status ${response.status}.`
      throw new Error(errorMessage)
    }
    return result
  }

  private async registerRoom(): Promise<void> {
    await this.request('POST', '/register')
  }

  private openSocket(): Promise<void> {
    const credentials = this.requireCredentials()
    if (this.socket) return Promise.resolve()
    this.closing = false
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.socketUrl(credentials), {
        headers: { Authorization: `Bearer ${credentials.desktopCredential}` },
      })
      this.socket = socket
      let settled = false
      const timeout = setTimeout(() => {
        socket.terminate()
        if (!settled) {
          settled = true
          reject(new Error('Timed out connecting to the mobile relay.'))
        }
      }, SOCKET_CONNECT_TIMEOUT_MS)

      socket.once('open', () => {
        clearTimeout(timeout)
        settled = true
        resolve()
      })
      socket.on('message', (data) => {
        void this.handleSocketMessage(data.toString()).catch((error: unknown) => {
          console.error('[MobileRelay] Could not process relay message:', error)
        })
      })
      socket.on('error', (error) => {
        console.error('[MobileRelay] WebSocket error:', error.message)
        if (!settled) {
          clearTimeout(timeout)
          settled = true
          reject(error)
        }
      })
      socket.on('close', () => {
        clearTimeout(timeout)
        const wasCurrent = this.socket === socket
        if (wasCurrent) this.socket = null
        if (!settled) {
          settled = true
          reject(new Error('Mobile relay closed before connecting.'))
        }
        if (!this.closing && wasCurrent) this.scheduleReconnect()
      })
    })
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.openSocket().catch((error: unknown) => {
        console.error('[MobileRelay] Reconnection failed:', error)
        this.scheduleReconnect()
      })
    }, RECONNECT_DELAY_MS)
  }

  private disconnectSocket(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    socket?.close(1000, 'Desktop relay configuration changed')
  }

  private async handleSocketMessage(raw: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Relay sent invalid JSON.')
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      throw new Error('Relay sent an invalid message.')
    }
    const message = parsed as RelayMessage
    if (message.type === 'HELIX_PAIRING_REQUEST') {
      if (!isRecord(message.payload)) throw new Error('Relay pairing request is invalid.')
      const requestId = message.payload.request_id
      const deviceName = message.payload.device_name
      if (
        typeof requestId !== 'string'
        || !ROOM_ID_PATTERN.test(requestId)
        || typeof deviceName !== 'string'
      ) {
        throw new Error('Relay pairing request is invalid.')
      }
      const approved = await this.handlers.approvePairing(deviceName)
      await this.request('POST', `/pairings/${requestId}/${approved ? 'approve' : 'reject'}`)
      return
    }
    if (message.type === 'USER_TEXT') {
      if (
        !DEVICE_ID_PATTERN.test(String(message.source_device_id ?? ''))
        || typeof message.source_device_name !== 'string'
        || !isRecord(message.payload)
        || typeof message.payload.text !== 'string'
      ) {
        throw new Error('Relay mobile message is invalid.')
      }
      const accepted = await this.handlers.receiveMobileText(
        message.source_device_id as string,
        message.source_device_name,
        message.payload.text,
      )
      if (!accepted) {
        this.sendDeviceEvent(
          message.source_device_id as string,
          'error',
          {
            conversation_id: `mobile_${message.source_device_id}`,
            message: 'The request was denied on the Desktop.',
          },
        )
      }
      return
    }
    if (message.type === 'SKILLS_REQUEST') {
      if (
        !DEVICE_ID_PATTERN.test(String(message.source_device_id ?? ''))
        || !isRecord(message.payload)
      ) {
        throw new Error('Relay mobile skills request is invalid.')
      }
      const skills = await this.handlers.getMobileSkillSuggestions()
      this.sendDeviceEvent(
        message.source_device_id as string,
        'skills_response',
        { skills },
      )
      return
    }
    if (message.type === 'BROWSER_LIVE_CONTROL') {
      const deviceId = message.source_device_id
      if (
        typeof deviceId !== 'string'
        || !DEVICE_ID_PATTERN.test(deviceId)
        || !isRecord(message.payload)
        || typeof message.payload.paused !== 'boolean'
      ) {
        throw new Error('Relay browser live-view control is invalid.')
      }
      if (message.payload.paused) this.pausedBrowserDevices.add(deviceId)
      else this.pausedBrowserDevices.delete(deviceId)
      return
    }
    if (message.type === 'SUBAGENT_QUERY') {
      const deviceId = message.source_device_id
      const payload = message.payload
      if (
        typeof deviceId !== 'string'
        || !DEVICE_ID_PATTERN.test(deviceId)
        || !isRecord(payload)
        || typeof payload.action !== 'string'
        || !['list_profiles', 'get_status', 'chat'].includes(payload.action)
        || typeof payload.correlation_id !== 'string'
        || !/^[A-Za-z0-9-]{10,64}$/.test(payload.correlation_id)
        || (payload.profile_id !== undefined
          && (typeof payload.profile_id !== 'string'
            || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(payload.profile_id)))
        || (payload.action === 'chat'
          && (typeof payload.profile_id !== 'string'
            || typeof payload.message !== 'string'
            || payload.message.trim().length === 0
            || payload.message.length > 4000))
      ) {
        throw new Error('Relay mobile subagent request is invalid.')
      }
      const action = payload.action as 'list_profiles' | 'get_status' | 'chat'
      const query = {
        ...(typeof payload.profile_id === 'string'
          ? { profile_id: payload.profile_id }
          : {}),
        ...(typeof payload.message === 'string'
          ? { message: payload.message }
          : {}),
      }
      try {
        const result = await this.handlers.queryMobileSubagent(action, query)
        this.sendDeviceEvent(deviceId, 'subagent_response', {
          correlation_id: payload.correlation_id,
          result,
        })
      } catch (error) {
        this.sendDeviceEvent(deviceId, 'subagent_response', {
          correlation_id: payload.correlation_id,
          error: error instanceof Error ? error.message.slice(0, 500) : 'Subagent request failed.',
        })
      }
      return
    }
    if (message.type === 'CONFIRMATION_RESPONSE') {
      if (
        !DEVICE_ID_PATTERN.test(String(message.source_device_id ?? ''))
        || !isRecord(message.payload)
        || typeof message.payload.request_id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.payload.request_id)
        || typeof message.payload.approved !== 'boolean'
      ) {
        throw new Error('Relay mobile confirmation response is invalid.')
      }
      const accepted = await this.handlers.receiveMobileConfirmation(
        message.source_device_id as string,
        message.payload.request_id,
        message.payload.approved,
      )
      if (!accepted) {
        this.sendDeviceEvent(message.source_device_id as string, 'error', {
          message: 'This confirmation is no longer pending for this device.',
        })
      }
    }
  }

  private sendDeviceEvent(
    deviceId: string,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.connected || !this.socket) return
    this.socket.send(JSON.stringify({
      type,
      target_device_id: deviceId,
      payload,
    }))
  }
}
