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
  private reconnectAttempts: number = 0
  private wsUrl: string = ''
  private reconnecting: boolean = false

  setupHandlers(mainWindow: BrowserWindow, toolboxWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.toolboxWindow = toolboxWindow

    // Renderer -> Python (fire and forget)
    ipcMain.on('helix:send-message', (_event, text: string) => {
      this._sendToPython({ type: 'USER_TEXT', payload: { text }, timestamp: new Date().toISOString() })
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

    ipcMain.handle('helix:save-settings', async (_event, settings: Record<string, unknown>) => {
      return this._request({ type: 'SAVE_SETTINGS', payload: { settings } })
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

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new (WebSocket as any)(this.wsUrl)
        this.ws = ws

        ws.on('open', () => {
          console.log('[IPCBridge] Connected to Python agent WebSocket')
          this.reconnectAttempts = 0
          this.reconnecting = false
          for (const [requestId, message] of this.queuedRequests) {
            if (!this.pendingRequests.has(requestId)) {
              this.queuedRequests.delete(requestId)
              continue
            }
            ws.send(JSON.stringify(message))
            this.queuedRequests.delete(requestId)
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
          if (!this.reconnecting) reject(err)
        })

        ws.on('close', () => {
          console.warn('[IPCBridge] WebSocket connection closed')
          this.ws = null
          this._scheduleReconnect()
        })
      } catch (err) {
        reject(err)
      }
    })
  }

  private _scheduleReconnect(): void {
    if (this.reconnecting) return
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[IPCBridge] Max reconnect attempts reached.')
      this._sendToAll('helix:error', { message: 'Lost connection to HELIX agent. Please restart.' })
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

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        this.queuedRequests.delete(requestId)
        reject(new Error(`Request timeout: ${message.type}`))
      }, timeoutMs)

      this.pendingRequests.set(requestId, (data, error) => {
        clearTimeout(timeout)
        if (error) reject(new Error(error))
        else resolve(data)
      })

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(messageWithId))
      } else {
        this.queuedRequests.set(requestId, messageWithId)
      }
    })
  }

  private _forwardToRenderer(message: AgentMessage): void {
    const typeMap: Record<string, string> = {
      'agent_message': 'helix:agent-message',
      'task_update': 'helix:task-update',
      'status_update': 'helix:status-update',
      'fallback_event': 'helix:fallback-event',
      'confirmation_request': 'helix:confirmation-request',
      'error': 'helix:error',
      'provider_update': 'helix:provider-update',
      'model_update': 'helix:model-update'
    }

    const channel = typeMap[message.type] ?? `helix:${message.type}`

    // confirmation requests and agent messages go to floating window
    if (['helix:agent-message', 'helix:confirmation-request'].includes(channel)) {
      this.mainWindow?.webContents.send(channel, message.payload)
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
