import { BrowserWindow, ipcMain } from 'electron'
import WebSocket from 'ws'

interface AgentMessage {
  type: string
  payload: Record<string, unknown>
  timestamp?: string
}

// Map of request-id -> resolver for two-way request/response over WebSocket
type ResponseResolver = (data: unknown, error?: string) => void

const RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT_ATTEMPTS = 10

export class IPCBridge {
  private ws: WebSocket | null = null
  private mainWindow: BrowserWindow | null = null
  private toolboxWindow: BrowserWindow | null = null
  private pendingRequests: Map<string, ResponseResolver> = new Map()
  private queuedRequests: Map<string, AgentMessage & { request_id: string }> = new Map()
  private requestTimeouts: Map<string, NodeJS.Timeout> = new Map()
  private reconnectAttempts: number = 0
  private wsUrl: string = ''
  private reconnecting: boolean = false

  setupHandlers(mainWindow: BrowserWindow, toolboxWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.toolboxWindow = toolboxWindow

    // Renderer -> Python (fire and forget)
    ipcMain.on('helix:send-message', (_event, payload: {
      text: string
      conversation_id: string
      conversation_history: Array<{ role: 'user' | 'assistant'; content: string }>
    }) => {
      this._sendToPython({ type: 'USER_TEXT', payload, timestamp: new Date().toISOString() })
    })

    ipcMain.on('helix:cancel-task', (_event, taskId: string) => {
      this._sendToPython({ type: 'TASK_CANCEL', payload: { task_id: taskId }, timestamp: new Date().toISOString() })
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

    ipcMain.handle('helix:get-providers', async () => {
      return this._request({ type: 'GET_PROVIDERS', payload: {} })
    })

    ipcMain.handle('helix:get-models', async (_event, requirements?: Record<string, unknown>) => {
      return this._request({ type: 'GET_MODELS', payload: { requirements: requirements ?? {} } })
    })

    ipcMain.handle('helix:get-settings', async () => {
      return this._request({ type: 'GET_SETTINGS', payload: {} })
    })

    ipcMain.handle('helix:save-settings', async (event, settings: Record<string, unknown>) => {
      const result = await this._request({ type: 'SAVE_SETTINGS', payload: { settings } })
      event.sender.send('helix:settings-applied', result)
      return result
    })

    ipcMain.handle('helix:validate-key', async (_event, provider: string, slot: number, key: string) => {
      // SECURITY: key goes directly to Python for validation, never stored in main process logs
      return this._request({ type: 'VALIDATE_KEY', payload: { provider, slot, key } })
    })
  }

  async connectToPython(wsUrl: string): Promise<void> {
    this.wsUrl = wsUrl
    return this._connect()
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
        const ws = new (WebSocket as any)(this.wsUrl)
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
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[IPCBridge] Max reconnect attempts reached.')
      this._sendToAll('helix:error', { message: 'Lost connection to HELIX agent. Please restart.' })
      for (const [requestId] of this.queuedRequests) {
        const resolver = this.pendingRequests.get(requestId)
        this.queuedRequests.delete(requestId)
        this.pendingRequests.delete(requestId)
        resolver?.(undefined, 'Lost connection to HELIX agent. Please restart.')
      }
      return
    }

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

  private _sendToPython(message: AgentMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      console.warn('[IPCBridge] Cannot send: WebSocket not connected')
    }
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
      'model_update': 'helix:model-update'
    }

    const channel = typeMap[message.type] ?? `helix:${message.type}`

    // Confirmation requests and agent messages are sent once to each window.
    if (['helix:agent-message', 'helix:confirmation-request'].includes(channel)) {
      this.mainWindow?.webContents.send(channel, message.payload)
      if (this.toolboxWindow && !this.toolboxWindow.isDestroyed()) {
        this.toolboxWindow.webContents.send(channel, message.payload)
      }
      return
    }

    // Everything else goes to both windows
    this._sendToAll(channel, message.payload)
  }

  private _sendToAll(channel: string, data: unknown): void {
    this.mainWindow?.webContents.send(channel, data)
    if (this.toolboxWindow && !this.toolboxWindow.isDestroyed()) {
      this.toolboxWindow.webContents.send(channel, data)
    }
  }
}
