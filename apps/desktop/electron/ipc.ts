import { app, BrowserWindow, ipcMain } from 'electron'
import WebSocket from 'ws'
import type { BrowserPageSnapshot } from './browser-extension-bridge'
import { websocketAuthHeaders } from './websocket-auth'
import {
  getLastGestureWindowToClose,
  getNextGestureWindowToOpen,
  type GestureWindowId,
} from './gesture-window-sequence'

interface AgentMessage {
  type: string
  payload: Record<string, unknown>
  timestamp?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Map of request-id -> resolver for two-way request/response over WebSocket
type ResponseResolver = (data: unknown, error?: string) => void

const RECONNECT_DELAY_MS = 3000
const MOBILE_DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/
const CONFIRMATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MOBILE_CONFIRMATION_TTL_MS = 5 * 60 * 1000

export class IPCBridge {
  private ws: WebSocket | null = null
  private mainWindow: BrowserWindow | null = null
  private toolboxWindow: BrowserWindow | null = null
  private confirmationWindow: BrowserWindow | null = null
  private agentsWindow: BrowserWindow | null = null
  private activeConfirmationId: string | null = null
  private activeConfirmation: Record<string, unknown> | null = null
  private pendingRequests: Map<string, ResponseResolver> = new Map()
  private queuedRequests: Map<string, AgentMessage & { request_id: string }> = new Map()
  private requestTimeouts: Map<string, NodeJS.Timeout> = new Map()
  private reconnectAttempts: number = 0
  private wsUrl: string = ''
  private wsTokenProvider: (() => string) | null = null
  private reconnecting: boolean = false
  private settingsAppliedHandler: ((settings: Record<string, unknown>) => void) | null = null
  private gestureWindowSequenceEnabled = true
  private capabilityRequiredHandler: ((payload: Record<string, unknown>) => Promise<void>) | null = null
  private agentEventHandler: ((message: AgentMessage) => void) | null = null
  private readonly pendingMobileConfirmations = new Map<
    string,
    { deviceId: string; expiresAt: number }
  >()

  setupHandlers(
    mainWindow: BrowserWindow,
    toolboxWindow: BrowserWindow,
    confirmationWindow: BrowserWindow,
    agentsWindow: BrowserWindow,
  ): void {
    this.mainWindow = mainWindow
    this.toolboxWindow = toolboxWindow
    this.confirmationWindow = confirmationWindow
    this.agentsWindow = agentsWindow
    confirmationWindow.webContents.on('did-finish-load', () => {
      this.sendActiveConfirmation()
    })

    ipcMain.on('helix:dismiss-confirmation-toast', (event, requestId: string) => {
      if (
        event.sender !== this.confirmationWindow?.webContents
        || requestId !== this.activeConfirmationId
      ) return
      this.activeConfirmationId = null
      this.activeConfirmation = null
      if (this.confirmationWindow && !this.confirmationWindow.isDestroyed()) {
        this.confirmationWindow.hide()
      }
    })

    // Renderer -> Python (fire and forget)
    ipcMain.on('helix:send-message', (_event, payload: {
      text: string
      conversation_id: string
      conversation_history: Array<{ role: 'user' | 'assistant'; content: string }>
      attachments?: Array<{ name: string; mime_type: string; size: number; data_base64: string }>
    }) => {
      this._sendToPython({ type: 'USER_TEXT', payload, timestamp: new Date().toISOString() })
    })

    ipcMain.on('helix:cancel-task', (_event, taskId: string) => {
      this._sendToPython({ type: 'TASK_CANCEL', payload: { task_id: taskId }, timestamp: new Date().toISOString() })
    })

    ipcMain.on('helix:emergency-stop', () => {
      this._sendToPython({ type: 'TASK_CANCEL_ALL', payload: {}, timestamp: new Date().toISOString() })
    })

    ipcMain.on('helix:confirm-action', (_event, requestId: string) => {
      this._sendToPython({ type: 'CONFIRMATION_GRANTED', payload: { request_id: requestId }, timestamp: new Date().toISOString() })
    })

    ipcMain.on('helix:reject-action', (_event, requestId: string) => {
      this._sendToPython({ type: 'CONFIRMATION_REJECTED', payload: { request_id: requestId }, timestamp: new Date().toISOString() })
    })

    // Renderer -> Python (request/response via invoke)
    ipcMain.handle('helix:get-tasks', async () => {
      return this._request({ type: 'GET_TASKS', payload: {} })
    })

    ipcMain.handle('helix:get-subagent-profiles', async () => {
      return this._request({ type: 'GET_SUBAGENT_PROFILES', payload: {} })
    })

    ipcMain.handle('helix:get-subagent-status', async () => {
      return this._request({ type: 'GET_SUBAGENT_STATUS', payload: {} })
    })

    ipcMain.handle('helix:get-subagent-routing-options', async () => {
      return this._request({ type: 'GET_SUBAGENT_ROUTING_OPTIONS', payload: {} })
    })

    ipcMain.handle('helix:set-subagent-route', async (_event, route: {
      profile_id: string
      provider: string | null
      model: string | null
      key_slot: number | null
    }) => {
      return this._request({ type: 'SET_SUBAGENT_ROUTE', payload: route })
    })

    ipcMain.handle('helix:create-subagent-profile', async (_event, profile: {
      name: string
      role: string
      description: string
      capabilities: string[]
      color: string
      instructions: string
    }) => this._request({ type: 'CREATE_SUBAGENT_PROFILE', payload: profile }))

    ipcMain.handle('helix:update-subagent-profile', async (_event, profile: {
      profile_id: string
      name: string
      role: string
      description: string
      capabilities: string[]
      color: string
      instructions: string
    }) => this._request({ type: 'UPDATE_SUBAGENT_PROFILE', payload: profile }))

    ipcMain.handle('helix:chat-subagent', async (_event, profileId: string, message: string) => {
      return this._request({
        type: 'CHAT_SUBAGENT',
        payload: { profile_id: profileId, message },
      }, 120000)
    })

    ipcMain.handle('helix:get-subagent-memories', async (_event, profileId: string) => {
      return this._request({
        type: 'GET_SUBAGENT_MEMORIES',
        payload: { profile_id: profileId },
      })
    })

    ipcMain.handle('helix:save-subagent-memory', async (
      _event,
      profileId: string,
      text: string,
      category: string,
    ) => this._request({
      type: 'SAVE_SUBAGENT_MEMORY',
      payload: { profile_id: profileId, text, category },
    }))

    ipcMain.handle('helix:update-subagent-memory', async (
      _event,
      profileId: string,
      memoryId: string,
      text: string,
      category: string,
    ) => this._request({
      type: 'UPDATE_SUBAGENT_MEMORY',
      payload: { profile_id: profileId, memory_id: memoryId, text, category },
    }))

    ipcMain.handle('helix:delete-subagent-memory', async (
      _event,
      profileId: string,
      memoryId: string,
    ) => this._request({
      type: 'DELETE_SUBAGENT_MEMORY',
      payload: { profile_id: profileId, memory_id: memoryId },
    }))

    ipcMain.handle('helix:get-providers', async () => {
      return this._request({ type: 'GET_PROVIDERS', payload: {} })
    })

    ipcMain.handle('helix:get-models', async (_event, requirements?: Record<string, unknown>) => {
      return this._request({ type: 'GET_MODELS', payload: { requirements: requirements ?? {} } })
    })

    ipcMain.handle('helix:get-settings', async () => {
      const settings = await this._request({ type: 'GET_SETTINGS', payload: {} })
      this._updateGestureWindowSequenceSetting(settings)
      return settings
    })

    ipcMain.handle('helix:save-settings', async (event, settings: Record<string, unknown>) => {
      const result = await this._request({ type: 'SAVE_SETTINGS', payload: { settings } })
      this._applyStartupSettings(result)
      this._updateGestureWindowSequenceSetting(result)
      if (result && typeof result === 'object') {
        this.settingsAppliedHandler?.(result as Record<string, unknown>)
      }
      event.sender.send('helix:settings-applied', result)
      return result
    })

    ipcMain.handle('helix:test-tts', async (_event, text?: string) => {
      return this._request({
        type: 'TEST_TTS',
        payload: { text: typeof text === 'string' && text.trim() ? text.trim() : undefined },
      }, 30000)
    })

    ipcMain.handle('helix:get-memory-status', async () => {
      return this._request({ type: 'GET_MEMORY_STATUS', payload: {} })
    })

    ipcMain.handle('helix:clear-memory', async () => {
      return this._request({ type: 'CLEAR_MEMORY', payload: {} })
    })

    ipcMain.handle('helix:get-user-memories', async () => {
      return this._request({ type: 'GET_USER_MEMORIES', payload: {} })
    })

    ipcMain.handle('helix:save-user-memory', async (_event, text: string, category: string) => {
      return this._request({ type: 'SAVE_USER_MEMORY', payload: { text, category } })
    })

    ipcMain.handle('helix:update-user-memory', async (_event, memoryId: string, text: string, category: string) => {
      return this._request({
        type: 'UPDATE_USER_MEMORY',
        payload: { memory_id: memoryId, text, category },
      })
    })

    ipcMain.handle('helix:delete-user-memory', async (_event, memoryId: string) => {
      return this._request({
        type: 'DELETE_USER_MEMORY',
        payload: { memory_id: memoryId },
      })
    })

    ipcMain.handle('helix:validate-key', async (_event, provider: string, slot: number, key: string) => {
      // SECURITY: key goes directly to Python for validation, never stored in main process logs
      return this._request({ type: 'VALIDATE_KEY', payload: { provider, slot, key } })
    })

    ipcMain.handle('helix:get-skills', async () => {
      return this._request({ type: 'GET_SKILLS', payload: {} })
    })

    ipcMain.handle('helix:save-skill', async (_event, skill: Record<string, unknown>) => {
      return this._request({ type: 'SAVE_SKILL', payload: { skill } })
    })

    ipcMain.handle('helix:delete-skill', async (_event, name: string) => {
      return this._request({ type: 'DELETE_SKILL', payload: { name } })
    })

    ipcMain.handle('helix:get-mcp-servers', async () => {
      return this._request({ type: 'GET_MCP_SERVERS', payload: {} })
    })
  }

  async connectToPython(wsUrl: string, getToken: () => string): Promise<void> {
    this.wsUrl = wsUrl
    this.wsTokenProvider = getToken
    return this._connect()
  }

  async loadSettings(): Promise<Record<string, unknown>> {
    const settings = await this._request({ type: 'GET_SETTINGS', payload: {} })
    this._applyStartupSettings(settings)
    if (settings && typeof settings === 'object') {
      this.settingsAppliedHandler?.(settings as Record<string, unknown>)
    }
    return (settings && typeof settings === 'object')
      ? settings as Record<string, unknown>
      : {}
  }

  onSettingsApplied(handler: (settings: Record<string, unknown>) => void): void {
    this.settingsAppliedHandler = handler
  }

  onCapabilityRequired(handler: (payload: Record<string, unknown>) => Promise<void>): void {
    this.capabilityRequiredHandler = handler
  }

  onAgentEvent(handler: (message: AgentMessage) => void): void {
    this.agentEventHandler = handler
  }

  sendMobileUserText(deviceId: string, text: string): boolean {
    if (!MOBILE_DEVICE_ID_PATTERN.test(deviceId) || !text.trim() || text.length > 50_000) {
      throw new TypeError('Mobile message is invalid.')
    }
    return this._sendToPython({
      type: 'USER_TEXT',
      payload: {
        text,
        conversation_id: `mobile_${deviceId}`,
        conversation_history: [],
        input_source: 'mobile',
        source_device_id: deviceId,
      },
      timestamp: new Date().toISOString(),
    })
  }

  async getMobileSkillSuggestions(): Promise<Array<{ name: string; description: string }>> {
    const response = await this._request({ type: 'GET_SKILLS', payload: {} })
    if (!Array.isArray(response)) {
      throw new Error('HELIX Desktop returned an invalid skills list.')
    }
    return response.flatMap((skill) => {
      if (!isRecord(skill)) return []
      const { name, description } = skill
      if (
        typeof name !== 'string'
        || !/^[A-Za-z0-9_.-]{1,80}$/.test(name)
        || typeof description !== 'string'
      ) {
        return []
      }
      return [{ name, description: description.slice(0, 500) }]
    }).slice(0, 256)
  }

  registerMobileConfirmation(payload: Record<string, unknown>): void {
    const requestId = payload.id
    const deviceId = payload.source_device_id
    if (
      typeof requestId !== 'string'
      || !CONFIRMATION_ID_PATTERN.test(requestId)
      || typeof deviceId !== 'string'
      || !MOBILE_DEVICE_ID_PATTERN.test(deviceId)
      || payload.conversation_id !== `mobile_${deviceId}`
    ) {
      throw new TypeError('Mobile confirmation request metadata is invalid.')
    }
    this.pendingMobileConfirmations.set(requestId, {
      deviceId,
      expiresAt: Date.now() + MOBILE_CONFIRMATION_TTL_MS,
    })
  }

  resolveMobileConfirmation(payload: Record<string, unknown>): void {
    if (typeof payload.request_id === 'string') {
      this.pendingMobileConfirmations.delete(payload.request_id)
    }
  }

  sendMobileConfirmation(
    deviceId: string,
    requestId: string,
    approved: boolean,
  ): boolean {
    if (
      !MOBILE_DEVICE_ID_PATTERN.test(deviceId)
      || !CONFIRMATION_ID_PATTERN.test(requestId)
      || typeof approved !== 'boolean'
    ) {
      throw new TypeError('Mobile confirmation response is invalid.')
    }
    const pending = this.pendingMobileConfirmations.get(requestId)
    if (
      !pending
      || pending.deviceId !== deviceId
      || pending.expiresAt <= Date.now()
    ) {
      this.pendingMobileConfirmations.delete(requestId)
      return false
    }
    this.pendingMobileConfirmations.delete(requestId)
    return this._sendToPython({
      type: approved ? 'CONFIRMATION_GRANTED' : 'CONFIRMATION_REJECTED',
      payload: { request_id: requestId, source_device_id: deviceId },
      timestamp: new Date().toISOString(),
    })
  }

  sendCapabilityResolved(payload: Record<string, unknown>): void {
    this._sendToPython({ type: 'CAPABILITY_RESOLVED', payload, timestamp: new Date().toISOString() })
  }

  async loadCapabilityPack(manifest: {
    id: string
    version: string
    sha256: string
  }): Promise<void> {
    await this._request({
      type: 'LOAD_CAPABILITY_PACK',
      payload: manifest,
    }, 30000)
  }

  sendEmergencyStop(): void {
    this._sendToPython({ type: 'TASK_CANCEL_ALL', payload: {}, timestamp: new Date().toISOString() })
  }

  sendBrowserPageUpdate(snapshot: BrowserPageSnapshot): boolean {
    return this._sendToPython({
      type: 'BROWSER_PAGE_UPDATE',
      payload: { ...snapshot },
      timestamp: new Date().toISOString(),
    })
  }

  close(): void {
    for (const timeout of this.requestTimeouts.values()) clearTimeout(timeout)
    this.requestTimeouts.clear()

    for (const [requestId, resolver] of this.pendingRequests) {
      resolver(undefined, 'HELIX is shutting down.')
      this.pendingRequests.delete(requestId)
    }
    this.queuedRequests.clear()

    const ws = this.ws
    this.ws = null
    ws?.removeAllListeners()
    ws?.close()
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let connected = false
      let settled = false
      try {
        if (!this.wsTokenProvider) {
          throw new Error('Python agent WebSocket token provider is not configured')
        }
        const ws = new WebSocket(this.wsUrl, {
          headers: websocketAuthHeaders(this.wsTokenProvider()),
        })
        this.ws = ws

        ws.on('open', () => {
          connected = true
          settled = true
          console.log('[IPCBridge] Connected to Python agent WebSocket')
          this.reconnectAttempts = 0
          this.reconnecting = false
          for (const [requestId, message] of this.queuedRequests) {
            if (!this.pendingRequests.has(requestId)) {
              this.queuedRequests.delete(requestId)
              continue
            }
            this.queuedRequests.delete(requestId)
            this._sendRequest(ws, message)
          }
          resolve()
        })

        ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString()) as AgentMessage & {
              request_id?: string
              error?: string
            }

            // Handle request/response pairing
            if (message.request_id && this.pendingRequests.has(message.request_id)) {
              const resolver = this.pendingRequests.get(message.request_id)!
              const timeout = this.requestTimeouts.get(message.request_id)
              if (timeout) clearTimeout(timeout)
              this.requestTimeouts.delete(message.request_id)
              this.pendingRequests.delete(message.request_id)
              resolver(message.payload, message.error)
              return
            }

            if (message.type === 'window_action') {
              this._handleWindowAction(message.payload)
              return
            }

            this.agentEventHandler?.(message)

            // Forward event messages to renderer windows
            this._forwardToRenderer(message)
          } catch (err) {
            console.error('[IPCBridge] Failed to parse message from Python:', err)
          }
        })

        ws.on('error', (err: Error) => {
          console.error('[IPCBridge] WebSocket error:', err.message)
          if (!connected && !settled) {
            settled = true
            reject(err)
          }
        })

        ws.on('close', () => {
          console.warn('[IPCBridge] WebSocket connection closed')
          if (this.ws === ws) this.ws = null
          if (connected) {
            this._scheduleReconnect()
          } else if (!settled) {
            settled = true
            reject(new Error('Python agent WebSocket closed before connecting'))
          }
        })
      } catch (err) {
        settled = true
        reject(err)
      }
    })
  }

  private _scheduleReconnect(): void {
    if (this.reconnecting) return
    this.reconnecting = true
    this.reconnectAttempts++
    console.log(`[IPCBridge] Reconnecting in ${RECONNECT_DELAY_MS}ms (attempt ${this.reconnectAttempts})...`)

    setTimeout(async () => {
      try {
        await this._connect()
      } catch {
        this.reconnecting = false
        this._scheduleReconnect()
      }
    }, RECONNECT_DELAY_MS)
  }

  private _sendToPython(message: AgentMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
      return true
    } else {
      console.warn('[IPCBridge] Cannot send: WebSocket not connected')
      return false
    }
  }

  private sendActiveConfirmation(): void {
    if (!this.activeConfirmation || !this.confirmationWindow || this.confirmationWindow.isDestroyed()) return
    this.confirmationWindow.webContents.send('helix:confirmation-request', this.activeConfirmation)
  }

  private _applyStartupSettings(settings: unknown): void {
    if (!app.isPackaged || !settings || typeof settings !== 'object') return
    const values = settings as Record<string, unknown>
    if (typeof values.start_with_windows !== 'boolean') return
    app.setLoginItemSettings({
      openAtLogin: values.start_with_windows,
      path: process.execPath,
    })
  }

  private _request(message: AgentMessage, timeoutMs: number = 10000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`
      const messageWithId = { ...message, request_id: requestId }

      this.pendingRequests.set(requestId, (data, error) => {
        if (error) reject(new Error(error))
        else resolve(data)
      })

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this._sendRequest(this.ws, messageWithId, timeoutMs)
      } else {
        this.queuedRequests.set(requestId, messageWithId)
      }
    })
  }

  private _sendRequest(
    ws: WebSocket,
    message: AgentMessage & { request_id: string },
    timeoutMs: number = 10000
  ): void {
    const timeout = setTimeout(() => {
      this.requestTimeouts.delete(message.request_id)
      const resolver = this.pendingRequests.get(message.request_id)
      this.pendingRequests.delete(message.request_id)
      this.queuedRequests.delete(message.request_id)
      resolver?.(undefined, `Request timeout: ${message.type}`)
    }, timeoutMs)
    this.requestTimeouts.set(message.request_id, timeout)
    ws.send(JSON.stringify(message))
  }

  private _forwardToRenderer(message: AgentMessage): void {
    const typeMap: Record<string, string> = {
      'agent_message': 'helix:agent-message',
      'task_update': 'helix:task-update',
      'status_update': 'helix:status-update',
      'fallback_event': 'helix:fallback-event',
      'confirmation_request': 'helix:confirmation-request',
      'confirmation_resolved': 'helix:confirmation-resolved',
      'error': 'helix:error',
      'provider_update': 'helix:provider-update',
      'model_update': 'helix:model-update',
      'hand_landmarks': 'helix:hand-landmarks'
    }

    const channel = typeMap[message.type] ?? `helix:${message.type}`

    if (channel === 'helix:capability-required') {
      void this.capabilityRequiredHandler?.(message.payload)
      this._sendToAll(channel, message.payload)
      return
    }

    if (channel === 'helix:confirmation-request') {
      if (message.payload.source_device_id !== undefined) {
        const requestId = message.payload.id
        const deviceId = message.payload.source_device_id
        if (
          typeof requestId !== 'string'
          || typeof deviceId !== 'string'
          || this.pendingMobileConfirmations.get(requestId)?.deviceId !== deviceId
        ) {
          console.error('[IPCBridge] Ignoring an unregistered mobile confirmation request.')
        }
        return
      }
      this.activeConfirmation = message.payload
      this.activeConfirmationId = typeof message.payload.id === 'string' ? message.payload.id : null
      this._sendToAll(channel, message.payload)
      this.sendActiveConfirmation()
      const floatingWindowVisible = this.mainWindow
        && !this.mainWindow.isDestroyed()
        && this.mainWindow.isVisible()
      const toolboxWindowVisible = this.toolboxWindow
        && !this.toolboxWindow.isDestroyed()
        && this.toolboxWindow.isVisible()
      if (
        !floatingWindowVisible
        && this.confirmationWindow
        && !this.confirmationWindow.isDestroyed()
      ) {
        this.confirmationWindow.showInactive()
      } else if (
        toolboxWindowVisible
        && this.confirmationWindow
        && !this.confirmationWindow.isDestroyed()
      ) {
        this.confirmationWindow.showInactive()
      }
      return
    }

    if (channel === 'helix:confirmation-resolved') {
      if (message.payload.source_device_id !== undefined) return
      this._sendToAll(channel, message.payload)
      if (
        this.activeConfirmationId
        && message.payload.request_id === this.activeConfirmationId
        && this.confirmationWindow
        && !this.confirmationWindow.isDestroyed()
      ) {
        this.confirmationWindow.webContents.send(channel, message.payload)
      }
      return
    }

    // Agent messages are sent once to each window.
    if (channel === 'helix:agent-message') {
      this.mainWindow?.webContents.send(channel, message.payload)
      if (this.toolboxWindow && !this.toolboxWindow.isDestroyed()) {
        this.toolboxWindow.webContents.send(channel, message.payload)
      }
      if (this.agentsWindow && !this.agentsWindow.isDestroyed()) {
        this.agentsWindow.webContents.send(channel, message.payload)
      }
      return
    }

    // Everything else goes to both windows
    this._sendToAll(channel, message.payload)
  }

  private _handleWindowAction(payload: Record<string, unknown>): void {
    const floatingWindow = this.mainWindow
    const toolboxWindow = this.toolboxWindow
    const floatingVisible = floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible()
    const toolboxVisible = toolboxWindow && !toolboxWindow.isDestroyed() && toolboxWindow.isVisible()

    if (this.gestureWindowSequenceEnabled) {
      const windows: Record<GestureWindowId, BrowserWindow | null> = {
        floating: floatingWindow,
        toolbox: toolboxWindow,
        agents: this.agentsWindow,
      }
      const visibleWindows = new Set<GestureWindowId>(
        (Object.entries(windows) as [GestureWindowId, BrowserWindow | null][])
          .filter((entry): entry is [GestureWindowId, BrowserWindow] =>
            Boolean(entry[1] && !entry[1].isDestroyed() && entry[1].isVisible()),
          )
          .map(([windowId]) => windowId),
      )

      if (payload.action === 'HIDE_FLOATING_OR_TOOLBOX') {
        const windowId = getLastGestureWindowToClose(visibleWindows)
        const windowToHide = windowId ? windows[windowId] : null
        windowToHide?.hide()
        return
      }

      if (payload.action === 'SHOW_FLOATING_OR_TOOLBOX') {
        const windowId = getNextGestureWindowToOpen(visibleWindows)
        const windowToShow = windowId ? windows[windowId] : null
        if (!windowToShow || windowToShow.isDestroyed()) return
        if (windowToShow.isMinimized()) windowToShow.restore()
        windowToShow.show()
        windowToShow.focus()
        return
      }
    }

    if (payload.action === 'HIDE_FLOATING_OR_TOOLBOX') {
      const windowToHide = floatingVisible ? floatingWindow : toolboxVisible ? toolboxWindow : null
      windowToHide?.hide()
      return
    }

    if (payload.action === 'SHOW_FLOATING_OR_TOOLBOX') {
      const windowToShow = floatingVisible ? toolboxWindow : floatingWindow
      if (!windowToShow || windowToShow.isDestroyed()) return
      if (windowToShow.isMinimized()) windowToShow.restore()
      windowToShow.show()
      windowToShow.focus()
    }
  }

  private _updateGestureWindowSequenceSetting(settings: unknown): void {
    if (!isRecord(settings) || typeof settings.gesture_window_sequence_enabled !== 'boolean') return
    this.gestureWindowSequenceEnabled = settings.gesture_window_sequence_enabled
  }

  private _sendToAll(channel: string, data: unknown): void {
    this.mainWindow?.webContents.send(channel, data)
    if (this.toolboxWindow && !this.toolboxWindow.isDestroyed()) {
      this.toolboxWindow.webContents.send(channel, data)
    }
    if (this.agentsWindow && !this.agentsWindow.isDestroyed()) {
      this.agentsWindow.webContents.send(channel, data)
    }
  }
}
