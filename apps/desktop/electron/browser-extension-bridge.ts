import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

export const BROWSER_EXTENSION_PORT = 47831
const MAX_BODY_BYTES = 500_000
const MAX_PAGE_TEXT_LENGTH = 80_000
const CONTROL_TIMEOUT_MS = 75_000
const EXTENSION_STALE_MS = 90_000

export interface BrowserPageSnapshot {
  title: string
  url: string
  text: string
  links: Array<{ text: string; url: string }>
  forms: Array<{ label: string; type: string }>
  controls?: Array<{ label: string; tag: string; selector: string }>
  captured_at: string
}

export interface BrowserExtensionInfo {
  token: string
  port: number
  extensionPath: string
  listening: boolean
  extensionConnected: boolean
  lastPage: { title: string; url: string; captured_at: string } | null
  error: string | null
}

export interface BrowserControlRequest {
  action:
    | 'open_session'
    | 'navigate'
    | 'click'
    | 'click_at'
    | 'double_click_at'
    | 'move_mouse'
    | 'type'
    | 'scroll'
    | 'scroll_at'
    | 'press_key'
    | 'go_back'
    | 'refresh'
    | 'snapshot'
    | 'screenshot'
    | 'close'
  session_id?: string
  url?: string
  selector?: string
  text?: string
  x?: number
  y?: number
  button?: 'left' | 'right' | 'middle'
  key?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
  submit?: boolean
}

function isExtensionOrigin(origin: string | undefined): origin is string {
  return Boolean(origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin))
}

function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function isLocalAgentRequest(origin: string | undefined): boolean {
  return !origin || origin === 'null'
}

function validPageSnapshot(value: unknown): value is BrowserPageSnapshot {
  if (!value || typeof value !== 'object') return false
  const page = value as Record<string, unknown>
  if (
    typeof page.title !== 'string'
    || typeof page.url !== 'string'
    || typeof page.text !== 'string'
    || typeof page.captured_at !== 'string'
    || page.title.length > 500
    || page.url.length > 4096
    || page.text.length > MAX_PAGE_TEXT_LENGTH
    || !Array.isArray(page.links)
    || !Array.isArray(page.forms)
    || (page.controls !== undefined && !Array.isArray(page.controls))
    || page.links.length > 120
    || page.forms.length > 80
    || (Array.isArray(page.controls) && page.controls.length > 100)
  ) return false

  try {
    const url = new URL(page.url)
    if (!['http:', 'https:'].includes(url.protocol)) return false
  } catch {
    return false
  }

  const validLink = (link: unknown): boolean => {
    if (!link || typeof link !== 'object') return false
    const item = link as Record<string, unknown>
    if (
      typeof item.text !== 'string'
      || typeof item.url !== 'string'
      || item.text.length > 300
      || item.url.length > 4096
    ) return false
    try {
      const linkUrl = new URL(item.url)
      return ['http:', 'https:'].includes(linkUrl.protocol)
    } catch {
      return false
    }
  }
  const validForm = (form: unknown): boolean => {
    if (!form || typeof form !== 'object') return false
    const item = form as Record<string, unknown>
    return typeof item.label === 'string'
      && item.label.length <= 300
      && typeof item.type === 'string'
      && item.type.length <= 40
  }
  const validControl = (control: unknown): boolean => {
    if (!control || typeof control !== 'object') return false
    const item = control as Record<string, unknown>
    return typeof item.label === 'string'
      && item.label.length <= 300
      && typeof item.tag === 'string'
      && item.tag.length <= 20
      && typeof item.selector === 'string'
      && item.selector.length <= 100
  }

  return page.links.every(validLink)
    && page.forms.every(validForm)
    && (page.controls === undefined || page.controls.every(validControl))
}

export class BrowserExtensionBridge {
  private server: Server | null = null
  private token = ''
  private startupError: string | null = null
  private lastPage: BrowserExtensionInfo['lastPage'] = null
  private lastExtensionPollAt = 0
  private readonly pendingCommands = new Map<string, {
    request: BrowserControlRequest
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()
  private readonly commandQueue: Array<{ id: string; request: BrowserControlRequest }> = []

  constructor(
    private readonly tokenPath: string,
    private readonly extensionPath: string,
    private readonly onPageSnapshot: (snapshot: BrowserPageSnapshot) => boolean,
  ) {}

  async start(): Promise<void> {
    try {
      await fs.promises.mkdir(path.dirname(this.tokenPath), { recursive: true })
      try {
        this.token = (await fs.promises.readFile(this.tokenPath, 'utf8')).trim()
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
          throw error
        }
      }
      if (!/^[a-f0-9]{64}$/.test(this.token)) {
        this.token = randomBytes(32).toString('hex')
        await fs.promises.writeFile(this.tokenPath, this.token, { mode: 0o600 })
      }
    } catch (error) {
      this.startupError = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not initialize browser extension pairing: ${this.startupError}`)
    }

    await new Promise<void>((resolve) => {
      const server = createServer((request, response) => {
        void this.handleRequest(request, response)
      })
      this.server = server
      server.on('error', (error) => {
        this.startupError = error.message
        console.error('[BrowserExtensionBridge] Local browser bridge failed to start:', error)
        resolve()
      })
      server.listen(BROWSER_EXTENSION_PORT, '127.0.0.1', () => {
        this.startupError = null
        console.log(`[BrowserExtensionBridge] Listening on 127.0.0.1:${BROWSER_EXTENSION_PORT}`)
        resolve()
      })
    })
  }

  getInfo(): BrowserExtensionInfo {
    return {
      token: this.token,
      port: BROWSER_EXTENSION_PORT,
      extensionPath: this.extensionPath,
      listening: Boolean(this.server?.listening),
      extensionConnected: Date.now() - this.lastExtensionPollAt <= EXTENSION_STALE_MS,
      lastPage: this.lastPage,
      error: this.startupError,
    }
  }

  async openManagedTab(input: string): Promise<void> {
    if (typeof input !== 'string' || input.length > 2048) {
      throw new TypeError('The plugin URL is invalid.')
    }
    let url: URL
    try {
      url = new URL(input)
    } catch {
      throw new TypeError('The plugin URL is invalid.')
    }
    const localHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (
      (url.protocol !== 'https:' && !localHttp)
      || url.username
      || url.password
    ) {
      throw new TypeError('Plugins can only open secure HTTPS sites.')
    }
    const info = this.getInfo()
    if (!info.listening) {
      throw new Error('The HELIX browser bridge is not running.')
    }
    if (!info.extensionConnected) {
      throw new Error('Connect the HELIX browser companion before opening a plugin.')
    }
    await this.enqueueControl({
      action: 'open_session',
      url: url.toString(),
    })
  }

  async close(): Promise<void> {
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Browser companion is shutting down.'))
    }
    this.pendingCommands.clear()
    this.commandQueue.length = 0
    if (!this.server?.listening) return
    const server = this.server
    this.server = null
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin
    if (!isExtensionOrigin(origin) && !isLocalAgentRequest(origin)) {
      sendJson(response, 403, { error: 'Only a Chrome or Edge extension can use this endpoint.' })
      return
    }

    response.setHeader('Access-Control-Allow-Origin', origin ?? 'null')
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const authorization = request.headers.authorization
    const suppliedToken = typeof authorization === 'string'
      ? authorization.replace(/^Bearer\s+/i, '')
      : ''
    const expected = Buffer.from(this.token)
    const supplied = Buffer.from(suppliedToken)
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      sendJson(response, 401, { error: 'Invalid extension pairing token.' })
      return
    }

    if (request.method === 'GET' && request.url === '/commands') {
      if (!isExtensionOrigin(origin)) {
        sendJson(response, 403, { error: 'Only the paired browser extension can poll commands.' })
        return
      }
      this.lastExtensionPollAt = Date.now()
      sendJson(response, 200, { commands: this.commandQueue.splice(0, 20) })
      return
    }

    if (request.method === 'GET' && request.url === '/status') {
      if (!isLocalAgentRequest(origin)) {
        sendJson(response, 403, { error: 'Only the local HELIX agent can check browser status.' })
        return
      }
      sendJson(response, 200, {
        connected: Date.now() - this.lastExtensionPollAt <= EXTENSION_STALE_MS,
      })
      return
    }

    const commandResultMatch = request.url?.match(/^\/commands\/([a-zA-Z0-9_-]+)$/)
    if (request.method === 'POST' && commandResultMatch) {
      if (!isExtensionOrigin(origin)) {
        sendJson(response, 403, { error: 'Only the paired browser extension can submit command results.' })
        return
      }
      try {
        const body = await this.readJson(request, 2_000_000)
        const pending = this.pendingCommands.get(commandResultMatch[1])
        if (!pending) {
          sendJson(response, 404, { error: 'Command is no longer pending.' })
          return
        }
        clearTimeout(pending.timeout)
        this.pendingCommands.delete(commandResultMatch[1])
        const resultBody = body && typeof body === 'object'
          ? body as Record<string, unknown>
          : null
        if (resultBody?.ok === false) {
          pending.reject(new Error(typeof resultBody.error === 'string' ? resultBody.error : 'Browser command failed.'))
        } else {
          pending.resolve(resultBody && 'result' in resultBody ? resultBody.result : body)
        }
        sendJson(response, 200, { accepted: true })
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (request.method !== 'POST' || request.url !== '/page' && request.url !== '/control') {
      sendJson(response, 404, { error: 'Not found.' })
      return
    }

    try {
      const body = await this.readJson(request, MAX_BODY_BYTES)
      if (request.url === '/control') {
        if (!isLocalAgentRequest(origin)) {
          sendJson(response, 403, { error: 'Only the local HELIX agent can submit control commands.' })
          return
        }
        const control = body as BrowserControlRequest
        if (!this.validControlRequest(control)) {
          sendJson(response, 400, { error: 'Invalid browser control request.' })
          return
        }
        const result = await this.enqueueControl(control)
        sendJson(response, 200, { ok: true, result })
        return
      }

      const snapshot: unknown = body
      if (!validPageSnapshot(snapshot)) {
        sendJson(response, 400, { error: 'Invalid browser page snapshot.' })
        return
      }
      if (!this.onPageSnapshot(snapshot)) {
        sendJson(response, 503, { error: 'HELIX agent is not connected yet.' })
        return
      }

      this.lastPage = {
        title: snapshot.title,
        url: snapshot.url,
        captured_at: snapshot.captured_at,
      }
      sendJson(response, 200, { accepted: true })
    } catch (error) {
      if (response.headersSent || response.destroyed) return
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 400, { error: `Could not process browser page snapshot: ${message}` })
    }
  }

  private async readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
    const chunks: Buffer[] = []
    let receivedBytes = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      receivedBytes += buffer.length
      if (receivedBytes > maxBytes) throw new Error('Request body exceeds the size limit.')
      chunks.push(buffer)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  private validControlRequest(value: unknown): value is BrowserControlRequest {
    if (!value || typeof value !== 'object') return false
    const request = value as Record<string, unknown>
    const actions = [
      'open_session', 'navigate', 'click', 'click_at', 'double_click_at',
      'move_mouse', 'type', 'scroll', 'scroll_at', 'press_key', 'go_back',
      'refresh', 'snapshot', 'screenshot', 'close',
    ]
    if (!actions.includes(String(request.action))) return false
    if (request.session_id !== undefined && (typeof request.session_id !== 'string' || request.session_id.length > 80)) return false
    if (request.url !== undefined) {
      if (typeof request.url !== 'string' || request.url.length > 4096) return false
      try { if (!['http:', 'https:'].includes(new URL(request.url).protocol)) return false } catch { return false }
    }
    for (const key of ['selector', 'text']) {
      if (request[key] !== undefined && (typeof request[key] !== 'string' || request[key].length > 2000)) return false
    }
    if (request.key !== undefined && (typeof request.key !== 'string' || request.key.length > 64)) return false
    for (const key of ['x', 'y']) {
      if (request[key] !== undefined && (
        typeof request[key] !== 'number'
        || !Number.isInteger(request[key])
        || request[key] < 0
        || request[key] > 10000
      )) return false
    }
    if (
      ['click_at', 'double_click_at', 'move_mouse', 'scroll_at'].includes(String(request.action))
      && (request.x === undefined || request.y === undefined)
    ) return false
    if (request.button !== undefined && !['left', 'right', 'middle'].includes(String(request.button))) return false
    if (request.direction !== undefined && !['up', 'down', 'left', 'right'].includes(String(request.direction))) return false
    if (request.amount !== undefined && (
      typeof request.amount !== 'number'
      || !Number.isInteger(request.amount)
      || request.amount <= 0
      || request.amount > 5000
    )) return false
    return request.submit === undefined || typeof request.submit === 'boolean'
  }

  private enqueueControl(request: BrowserControlRequest): Promise<unknown> {
    const id = `cmd_${Date.now()}_${randomBytes(6).toString('hex')}`
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id)
        reject(new Error('Timed out waiting for the browser extension.'))
      }, CONTROL_TIMEOUT_MS)
      this.pendingCommands.set(id, { request, resolve, reject, timeout })
      this.commandQueue.push({ id, request })
    })
  }
}
