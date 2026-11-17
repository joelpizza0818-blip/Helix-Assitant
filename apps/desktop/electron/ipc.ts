import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import WebSocket from 'ws'
import type { BrowserPageSnapshot } from './browser-extension-bridge'
import {
  getAvailableDeveloperTerminalShells,
  startDeveloperTerminalProcess,
  type DeveloperTerminalShell,
} from './developer-terminal'
import { websocketAuthHeaders } from './websocket-auth'
import {
  getLastGestureWindowToClose,
  getNextGestureWindowToOpen,
  type GestureWindowId,
} from './gesture-window-sequence'
import {
  detectDesktopApps,
  getApprovedDesktopAppPackages,
  getDesktopAppNames,
} from './desktop-app-catalog'
import {
  DockerDesktopManager,
  type DockerDesktopProgress,
} from './docker-desktop-manager'

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
const VOICE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const MOBILE_VOICE_TYPES = new Set([
  'VOICE_SESSION_START',
  'VOICE_SESSION_STOP',
  'VOICE_AUDIO_CHUNK',
  'VOICE_RECORDING_START',
  'VOICE_RECORDING_STOP',
  'VOICE_INTERRUPT',
  'VOICE_CONFIRMATION',
  'VOICE_CONFIRMATION_TEXT',
  'VOICE_MUTE',
  'VOICE_UNMUTE',
  'VOICE_PLAYBACK_PROGRESS',
  'VOICE_PLAYBACK_DONE',
  'VOICE_PING',
])
const DEVELOPER_TERMINAL_SHELLS: DeveloperTerminalShell[] = ['powershell', 'cmd', 'bash']
const MAX_TERMINAL_INPUT_BYTES = 64 * 1024

interface DeveloperTerminalSession {
  id: string
  owner: Electron.WebContents
  process: ChildProcessWithoutNullStreams
}

export interface ComputerUseStatus {
  mode: 'auto' | 'isolated' | 'host'
  hostConsent: boolean
  isolatedSupported: boolean
  isolatedReady: boolean
  installationComplete: boolean
  guestRunning: boolean
  preparing: boolean
  progressPhase: DockerDesktopProgress['phase'] | null
  lastError: string | null
}

export interface ComputerUseSetupResult {
  status: 'in_progress' | 'unsupported' | 'unavailable'
  message: string
}

function isDeveloperTerminalShell(value: unknown): value is DeveloperTerminalShell {
  return typeof value === 'string'
    && DEVELOPER_TERMINAL_SHELLS.includes(value as DeveloperTerminalShell)
}

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
  private requestDeadlines: Map<string, number> = new Map()
  private sentRequestIds = new Set<string>()
  private browserSessionUpdate: { session_id: string; url: string } | null = null
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
  private readonly developerTerminalSessions = new Map<string, DeveloperTerminalSession>()
  private dockerDesktopManager: DockerDesktopManager | null = null
  private computerUseSetupPromise: Promise<void> | null = null
  private computerUseSetupError: string | null = null
  private computerUseProgress: DockerDesktopProgress | null = null

  setToolboxWindow(window: BrowserWindow | null): void {
    this.toolboxWindow = window
  }

  setAgentsWindow(window: BrowserWindow | null): void {
    this.agentsWindow = window
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

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
    const agentDirectory = app.isPackaged
      ? path.join(process.resourcesPath, 'services', 'agent')
      : path.resolve(app.getAppPath(), '..', '..', 'services', 'agent')
    const computerUseImageDirectory = app.isPackaged
      ? path.join(process.resourcesPath, 'computer-use-image')
      : path.resolve(app.getAppPath(), 'computer-use-image')
    this.dockerDesktopManager = new DockerDesktopManager(
      path.join(app.getPath('userData'), 'docker-desktop-session.json'),
      computerUseImageDirectory,
      path.join(agentDirectory, 'desktop_control', 'guest', 'guest_agent.py'),
      undefined,
      (progress: DockerDesktopProgress) => {
        this.computerUseProgress = progress
        if (this.toolboxWindow && !this.toolboxWindow.isDestroyed()) {
          this.toolboxWindow.webContents.send(
            'helix:docker-desktop-progress',
            progress,
          )
        }
      },
      process.env.HELIX_STORAGE_DIR ?? path.join(app.getPath('desktop'), 'helix-storage'),
    )
    this.dockerDesktopManager.startIdleMonitor()
    toolboxWindow.webContents.once('destroyed', () => {
      this._closeDeveloperTerminalsForOwner(toolboxWindow.webContents)
    })
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
    ipcMain.handle('helix:send-message', async (_event, payload: {
      text: string
      conversation_id: string
      conversation_history: Array<{ role: 'user' | 'assistant'; content: string }>
      attachments?: Array<{ name: string; mime_type: string; size: number; data_base64: string }>
    }) => {
      await this._request(
        { type: 'USER_TEXT', payload, timestamp: new Date().toISOString() },
        10000,
      )
    })

    ipcMain.handle('helix:developer-terminal-status', (event) => {
      this._assertToolboxSender(event.sender)
      const shells = getAvailableDeveloperTerminalShells()
      return {
        supported: shells.length > 0,
        shells,
        ...(shells.length > 0 ? {} : { reason: 'No supported local shell was found on PATH.' }),
      }
    })

    ipcMain.handle('helix:get-computer-use-status', async (event) => {
      this._assertToolboxSender(event.sender)
      return this._getComputerUseStatus()
    })

    ipcMain.handle('helix:start-computer-use-setup', async (event) => {
      this._assertToolboxSender(event.sender)
      return this.ensureComputerUseSetup()
    })

    ipcMain.handle('helix:request-host-desktop-consent', async (event) => {
      this._assertToolboxSender(event.sender)
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: 'Let HELIX work on this Windows desktop?',
        message: 'HELIX will show its own virtual cursor on your real desktop.',
        detail: 'HELIX can see the screen and open apps, click, type, scroll, and use shortcuts while working on tasks you ask for. It uses Windows accessibility first and keeps your physical cursor where it is. If an app blocks accessibility, HELIX may briefly use your real mouse or keyboard and then restore the pointer; that fallback is covered by this one-time permission. You can switch back to the private desktop at any time.',
        buttons: ['Allow computer use', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      }
      const confirmation = owner
        ? await dialog.showMessageBox(owner, options)
        : await dialog.showMessageBox(options)
      return { accepted: confirmation.response === 0 }
    })

    ipcMain.handle('helix:start-docker-desktop', (event) => {
      this._assertToolboxSender(event.sender)
      return this._requireDockerDesktopManager().start()
    })

    ipcMain.handle('helix:stop-docker-desktop', (event) => {
      this._assertToolboxSender(event.sender)
      return this._requireDockerDesktopManager().stop()
    })

    ipcMain.handle('helix:detect-desktop-apps', async (event) => {
      this._assertToolboxSender(event.sender)
      return detectDesktopApps()
    })

    ipcMain.handle('helix:install-desktop-apps', async (event, ids: unknown) => {
      this._assertToolboxSender(event.sender)
      const packages = getApprovedDesktopAppPackages(ids)
      const appNames = getDesktopAppNames(
        Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === 'string')
          : [],
      )
      const manager = this._requireDockerDesktopManager()
      if (!(await manager.getStatus()).ready) {
        throw new Error('Start the Docker desktop before installing Linux apps.')
      }
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: 'Install Linux app equivalents?',
        message: `Install ${appNames.join(', ')} in the isolated Docker desktop?`,
        detail: 'Only these selected Linux packages will be installed in the container. Windows apps and their data are not copied.',
        buttons: ['Install selected apps', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      }
      const confirmation = owner
        ? await dialog.showMessageBox(owner, options)
        : await dialog.showMessageBox(options)
      if (confirmation.response !== 0) return { installed: false }
      await manager.installApps(packages)
      return { installed: true }
    })

    ipcMain.handle('helix:developer-terminal-start', async (event, incoming: unknown) => {
      this._assertToolboxSender(event.sender)
      if (!isRecord(incoming) || typeof incoming.project_id !== 'string' || !isDeveloperTerminalShell(incoming.shell)) {
        throw new TypeError('Terminal startup options are invalid.')
      }
      const cols = this._clampTerminalDimension(incoming.cols, 20, 500, 'columns')
      const rows = this._clampTerminalDimension(incoming.rows, 5, 200, 'rows')

      const settings = await this._request({ type: 'GET_SETTINGS', payload: {} })
      if (!isRecord(settings) || settings.developer_mode_enabled !== true) {
        throw new Error('Enable Developer Mode before starting its terminal.')
      }
      const registry = await this._request({ type: 'GET_PROJECTS', payload: {} })
      if (
        !isRecord(registry)
        || registry.active_project_id !== incoming.project_id
        || !Array.isArray(registry.projects)
      ) {
        throw new Error('Select the project before starting its terminal.')
      }
      const project = registry.projects.find((item) => (
        isRecord(item)
        && item.project_id === incoming.project_id
        && typeof item.root_path === 'string'
      ))
      if (!isRecord(project) || typeof project.root_path !== 'string') {
        throw new Error('The active project is not registered.')
      }
      const rootPath = await fs.realpath(project.root_path)
      const rootStat = await fs.stat(rootPath)
      if (!rootStat.isDirectory()) throw new Error('The active project root is not a directory.')
      const ownerSessionCount = [...this.developerTerminalSessions.values()]
        .filter((session) => session.owner === event.sender)
        .length
      if (ownerSessionCount >= 4) throw new Error('Too many local terminal sessions are already open.')

      const homePath = await fs.realpath(os.homedir())
      const homeStat = await fs.stat(homePath)
      if (!homeStat.isDirectory()) throw new Error('The current user home directory is not available.')
      const terminal = startDeveloperTerminalProcess(incoming.shell, homePath, cols, rows)
      const sessionId = randomUUID()
      const session: DeveloperTerminalSession = {
        id: sessionId,
        owner: event.sender,
        process: terminal,
      }
      this.developerTerminalSessions.set(sessionId, session)
      let exited = false
      const sendExit = (exitCode: number | null, signal: string | null) => {
        if (exited) return
        exited = true
        if (this.developerTerminalSessions.get(sessionId) !== session) return
        this.developerTerminalSessions.delete(sessionId)
        if (!session.owner.isDestroyed()) {
          session.owner.send('helix:developer-terminal-exit', {
            session_id: sessionId,
            exit_code: exitCode,
            signal,
          })
        }
      }
      const sendData = (data: string) => {
        if (this.developerTerminalSessions.get(sessionId) !== session || session.owner.isDestroyed()) return
        session.owner.send('helix:developer-terminal-data', { session_id: sessionId, data })
      }
      terminal.stdout.setEncoding('utf8')
      terminal.stderr.setEncoding('utf8')
      terminal.stdout.on('data', sendData)
      terminal.stderr.on('data', sendData)
      terminal.once('error', (error) => {
        console.error('[DeveloperTerminal] Process failed:', error)
        sendData('\r\nNo se pudo iniciar la terminal. Revisa la configuración e inténtalo de nuevo.\r\n')
        sendExit(null, null)
      })
      terminal.once('exit', (code, signal) => sendExit(code, signal))
      return { session_id: sessionId }
    })

    ipcMain.handle('helix:developer-terminal-write', (event, sessionId: unknown, data: unknown) => {
      const session = this._getDeveloperTerminalSession(event.sender, sessionId)
      if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_TERMINAL_INPUT_BYTES) {
        throw new TypeError('Terminal input must be text no larger than 64 KiB.')
      }
      if (!session.process.stdin.writable) throw new Error('The local shell input stream is closed.')
      session.process.stdin.write(data)
    })

    ipcMain.handle('helix:developer-terminal-close', (event, sessionId: unknown) => {
      const session = this._getDeveloperTerminalSession(event.sender, sessionId)
      this.developerTerminalSessions.delete(session.id)
      session.process.kill()
    })

    ipcMain.on('helix:cancel-task', (_event, taskId: string) => {
      this._sendToPython({ type: 'TASK_CANCEL', payload: { task_id: taskId }, timestamp: new Date().toISOString() })
    })

    ipcMain.on('helix:pause-task', (_event, taskId: string) => {
      this._sendToPython({ type: 'TASK_PAUSE', payload: { task_id: taskId }, timestamp: new Date().toISOString() })
    })

    ipcMain.on('helix:resume-task', (_event, taskId: string) => {
      this._sendToPython({
        type: 'TASK_RESUME',
        payload: { task_id: taskId, repeat_interrupted: false, force: false },
        timestamp: new Date().toISOString(),
      })
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

    ipcMain.handle('helix:install-playwright-chromium', async () => {
      return this._request({
        type: 'INSTALL_PLAYWRIGHT_CHROMIUM',
        payload: { confirmed: true },
      }, 900_000)
    })

    ipcMain.handle('helix:get-subagent-profiles', async () => {
      return this._request({ type: 'GET_SUBAGENT_PROFILES', payload: {} }, 30000)
    })

    ipcMain.handle('helix:get-subagent-status', async () => {
      return this._request({ type: 'GET_SUBAGENT_STATUS', payload: {} }, 30000)
    })

    ipcMain.handle('helix:get-subagent-routing-options', async () => {
      return this._request({ type: 'GET_SUBAGENT_ROUTING_OPTIONS', payload: {} }, 30000)
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
      }, 1200000)
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

    ipcMain.handle('helix:get-llama-status', async () => {
      return this._request({ type: 'GET_LLAMA_SERVER_STATUS', payload: {} })
    })

    ipcMain.handle('helix:start-llama-server', async (_event, model?: string) => {
      return this._request({ type: 'START_LLAMA_SERVER', payload: { model } })
    })

    ipcMain.handle('helix:stop-llama-server', async () => {
      return this._request({ type: 'STOP_LLAMA_SERVER', payload: {} })
    })

    ipcMain.handle('helix:download-llama-server', async () => {
      return this._request({ type: 'DOWNLOAD_LLAMA_SERVER', payload: {} }, 180_000)
    })

    ipcMain.handle('helix:download-gguf-model', async (_event, modelId: string) => {
      return this._request({ type: 'DOWNLOAD_GGUF_MODEL', payload: { model_id: modelId } }, 600_000)
    })

    ipcMain.handle('helix:get-providers', async () => {
      return this._request({ type: 'GET_PROVIDERS', payload: {} })
    })

    ipcMain.handle('helix:get-models', async (_event, requirements?: Record<string, unknown>) => {
      return this._request({ type: 'GET_MODELS', payload: { requirements: requirements ?? {} } })
    })

    ipcMain.handle('helix:get-model-catalog', async () => {
      return this._request({ type: 'GET_MODEL_CATALOG', payload: {} })
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

    ipcMain.handle('helix:test-tts', async (_event, payload?: string | { text?: string; provider?: string; voice_id?: string }) => {
      const payloadObj = typeof payload === 'string'
        ? { text: payload.trim() || undefined }
        : typeof payload === 'object' && payload !== null
        ? payload
        : {}
      return this._request({
        type: 'TEST_TTS',
        payload: payloadObj,
      }, 30000)
    })

    ipcMain.handle('helix:get-memory-status', async () => {
      return this._request({ type: 'GET_MEMORY_STATUS', payload: {} })
    })

    ipcMain.handle('helix:get-projects', async () => {
      return this._request({ type: 'GET_PROJECTS', payload: {} })
    })

    ipcMain.handle('helix:import-project-folder', async (_event, folderPath: string) => {
      return this._request({
        type: 'IMPORT_PROJECT_FOLDER',
        payload: { folder_path: folderPath },
      })
    })

    ipcMain.handle('helix:get-project-files', async (_event, projectId: string) => {
      return this._request({
        type: 'GET_PROJECT_FILES',
        payload: { project_id: projectId },
      })
    })

    ipcMain.handle('helix:read-project-file', async (_event, projectId: string, relativePath: string) => {
      return this._request({
        type: 'READ_PROJECT_FILE',
        payload: { project_id: projectId, relative_path: relativePath },
      })
    })

    ipcMain.handle('helix:write-project-file', async (
      _event,
      projectId: string,
      relativePath: string,
      content: string,
    ) => {
      return this._request({
        type: 'WRITE_PROJECT_FILE',
        payload: { project_id: projectId, relative_path: relativePath, content },
      })
    })

    ipcMain.handle('helix:create-project-entry', async (
      _event,
      projectId: string,
      relativePath: string,
      entryType: 'file' | 'folder',
    ) => {
      return this._request({
        type: 'CREATE_PROJECT_ENTRY',
        payload: {
          project_id: projectId,
          relative_path: relativePath,
          entry_type: entryType,
        },
      })
    })

    ipcMain.handle('helix:import-project-files', async (event, projectId: string, targetDirectory: string) => {
      const parent = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: 'Import files into project',
        properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled) return { canceled: true }
      return this._request({
        type: 'IMPORT_PROJECT_FILES',
        payload: {
          project_id: projectId,
          source_paths: result.filePaths,
          target_directory: targetDirectory,
        },
      })
    })

    ipcMain.handle('helix:set-active-project', async (_event, projectId: string | null) => {
      return this._request({
        type: 'SET_ACTIVE_PROJECT',
        payload: { project_id: projectId },
      })
    })

    ipcMain.handle('helix:get-project-graph', async (_event, projectId: string) => {
      return this._request({
        type: 'GET_PROJECT_GRAPH',
        payload: { project_id: projectId },
      })
    })

    ipcMain.handle('helix:save-project-graph', async (
      _event,
      projectId: string,
      graph: { nodes: unknown[]; edges: unknown[] },
    ) => {
      return this._request({
        type: 'SAVE_PROJECT_GRAPH',
        payload: { project_id: projectId, graph },
      })
    })

    ipcMain.handle('helix:get-general-memory-graph', async () => {
      return this._request({ type: 'GET_GENERAL_MEMORY_GRAPH', payload: {} })
    })

    ipcMain.handle('helix:save-general-memory-graph', async (
      _event,
      graph: { nodes: unknown[]; edges: unknown[] },
    ) => {
      return this._request({
        type: 'SAVE_GENERAL_MEMORY_GRAPH',
        payload: { graph },
      })
    })

    ipcMain.handle('helix:clear-memory', async () => {
      return this._request({ type: 'CLEAR_MEMORY', payload: {} })
    })

    ipcMain.handle('helix:get-user-memories', async () => {
      return this._request({ type: 'GET_USER_MEMORIES', payload: {} })
    })

    ipcMain.handle('helix:get-user-memory-profile', async () => {
      return this._request({ type: 'GET_USER_MEMORY_PROFILE', payload: {} })
    })

    ipcMain.handle('helix:update-user-memory-summary', async (_event, summary: string) => {
      return this._request({ type: 'UPDATE_USER_MEMORY_SUMMARY', payload: { summary } })
    })

    ipcMain.handle('helix:update-user-notes', async (_event, notes: string) => {
      return this._request({ type: 'UPDATE_USER_NOTES', payload: { notes } })
    })

    ipcMain.handle('helix:clear-user-memory', async () => {
      return this._request({ type: 'CLEAR_USER_MEMORY', payload: {} })
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

    ipcMain.handle('helix:get-workflows', async () => {
      return this._request({ type: 'GET_WORKFLOWS', payload: {} })
    })

    ipcMain.handle('helix:get-workflow-tools', async () => {
      return this._request({ type: 'GET_WORKFLOW_TOOLS', payload: {} })
    })

    ipcMain.handle('helix:get-workflow-agents', async () => {
      return this._request({ type: 'GET_WORKFLOW_AGENTS', payload: {} }, 30000)
    })

    ipcMain.handle('helix:get-workflow-capabilities', async () => {
      return this._request({ type: 'GET_WORKFLOW_CAPABILITIES', payload: {} })
    })

    ipcMain.handle('helix:save-workflow', async (_event, workflow: object) => {
      return this._request({ type: 'SAVE_WORKFLOW', payload: { workflow } })
    })

    ipcMain.handle('helix:save-workflow-skill', async (_event, id: string, triggers?: string[]) => {
      return this._request({ type: 'SAVE_WORKFLOW_SKILL', payload: { id, triggers } })
    })

    ipcMain.handle('helix:delete-workflow', async (_event, id: string) => {
      return this._request({ type: 'DELETE_WORKFLOW', payload: { id } })
    })

    ipcMain.handle('helix:run-workflow', async (_event, id: string, input: string) => {
      return this._request({ type: 'RUN_WORKFLOW', payload: { id, input } })
    })

    ipcMain.handle('helix:voice-send', (_event, message: { type: string; payload: Record<string, unknown> }) => {
      if (!message || typeof message.type !== 'string') return false
      return this._sendToPython({
        type: message.type,
        payload: message.payload || {},
        timestamp: new Date().toISOString(),
      })
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

  sendMobileVoiceMessage(
    deviceId: string,
    voiceType: string,
    payload: Record<string, unknown>,
  ): boolean {
    if (
      !MOBILE_DEVICE_ID_PATTERN.test(deviceId)
      || !MOBILE_VOICE_TYPES.has(voiceType)
      || !isRecord(payload)
      || typeof payload.session_id !== 'string'
      || !VOICE_SESSION_ID_PATTERN.test(payload.session_id)
    ) {
      throw new TypeError('Mobile voice message is invalid.')
    }
    return this._sendToPython({
      type: voiceType,
      payload: {
        ...payload,
        source_device_id: deviceId,
        input_source: 'mobile',
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

  async queryMobileSubagent(
    action: 'list_profiles' | 'get_status' | 'chat',
    payload: { profile_id?: string; message?: string },
  ): Promise<Record<string, unknown>> {
    const request = action === 'list_profiles'
      ? { type: 'GET_SUBAGENT_PROFILES', payload: {} }
      : action === 'get_status'
        ? { type: 'GET_SUBAGENT_STATUS', payload: {} }
        : {
            type: 'CHAT_SUBAGENT',
            payload: { profile_id: payload.profile_id, message: payload.message },
          }
    const response = await this._request(
      request,
      action === 'chat'
        ? 120000
        : action === 'list_profiles'
          ? 30000
          : 10000,
    )
    if (action === 'chat') {
      if (!isRecord(response)) throw new Error('Desktop returned an invalid subagent reply.')
      const { profile_id, name, color, response: text } = response
      if (
        typeof profile_id !== 'string'
        || typeof name !== 'string'
        || typeof color !== 'string'
        || typeof text !== 'string'
      ) {
        throw new Error('Desktop returned an invalid subagent reply.')
      }
      return {
        profile_id,
        name,
        color,
        response: text.slice(0, 50000),
      }
    }
    if (!Array.isArray(response)) {
      throw new Error('Desktop returned an invalid subagent list.')
    }
    const items = response.filter(isRecord).map((item) => {
      if (action === 'list_profiles') {
        const { profile_id, name, role, description, capabilities, color } = item
        if (
          typeof profile_id !== 'string'
          || typeof name !== 'string'
          || typeof role !== 'string'
          || typeof description !== 'string'
          || !Array.isArray(capabilities)
          || !capabilities.every((value) => typeof value === 'string')
          || typeof color !== 'string'
        ) {
          throw new Error('Desktop returned an invalid subagent profile.')
        }
        return { profile_id, name, role, description, capabilities, color }
      }
      const fields = [
        'agent_id',
        'parent_id',
        'profile_id',
        'name',
        'color',
        'role',
        'status',
        'created_at',
        'started_at',
        'completed_at',
        'progress',
        'current_action',
      ]
      return Object.fromEntries(
        fields.filter((field) => item[field] !== undefined)
          .map((field) => [field, item[field]]),
      )
    })
    return { items }
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

  cancelTask(taskId: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(taskId)) {
      throw new TypeError('Desktop task identifier is invalid.')
    }
    this._sendToPython({
      type: 'TASK_CANCEL',
      payload: { task_id: taskId },
      timestamp: new Date().toISOString(),
    })
  }

  sendBrowserPageUpdate(snapshot: BrowserPageSnapshot): boolean {
    return this._sendToPython({
      type: 'BROWSER_PAGE_UPDATE',
      payload: { ...snapshot },
      timestamp: new Date().toISOString(),
    })
  }

  clearBrowserPageSnapshot(): boolean {
    return this._sendToPython({
      type: 'BROWSER_PAGE_CLEAR',
      payload: {},
      timestamp: new Date().toISOString(),
    })
  }

  sendBrowserSessionUpdate(session: { session_id: string; url: string }): boolean {
    this.browserSessionUpdate = { ...session }
    return this._sendToPython({
      type: 'BROWSER_SESSION_UPDATE',
      payload: { ...session },
      timestamp: new Date().toISOString(),
    })
  }

  async close(): Promise<void> {
    const dockerDesktopManager = this.dockerDesktopManager
    dockerDesktopManager?.dispose()
    this.dockerDesktopManager = null
    for (const session of this.developerTerminalSessions.values()) {
      this.developerTerminalSessions.delete(session.id)
      session.process.kill()
    }
    for (const timeout of this.requestTimeouts.values()) clearTimeout(timeout)
    this.requestTimeouts.clear()
    if (dockerDesktopManager) {
      try {
        await dockerDesktopManager.stop()
      } catch (error) {
        console.error('[ComputerUse] Could not stop the Docker desktop during shutdown:', error)
      }
    }
    this.requestDeadlines.clear()
    this.sentRequestIds.clear()

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

  private _assertToolboxSender(sender: Electron.WebContents): void {
    if (sender !== this.toolboxWindow?.webContents || sender.isDestroyed()) {
      throw new Error('This operation is only available from the HELIX Toolbox.')
    }
  }

  async startComputerUseIfNeeded(settings: Record<string, unknown>): Promise<void> {
    const mode = settings.computer_use_mode
    const manager = this._requireDockerDesktopManager()
    const hostConsent = settings.computer_use_host_consent === true
    if (hostConsent && (mode === undefined || mode === 'auto' || mode === 'host')) return

    const status = await manager.getStatus()
    if (status.ready) {
      await manager.start()
      return
    }

    const setup = await this.ensureComputerUseSetup()
    if (setup.status !== 'in_progress') {
      throw new Error(setup.message)
    }
  }

  async ensureComputerUseSetup(): Promise<ComputerUseSetupResult> {
    if (this.computerUseSetupPromise) {
      return {
        status: 'in_progress',
        message: 'The Docker desktop is still being prepared.',
      }
    }
    const manager = this._requireDockerDesktopManager()
    const current = await manager.getStatus()
    if (!current.supported) {
      return {
        status: 'unsupported',
        message: 'Docker desktop is not supported on this operating system.',
      }
    }
    if (!current.engineAvailable) {
      this.computerUseSetupError = current.lastError
      return {
        status: 'unavailable',
        message: current.lastError ?? 'Start Docker Desktop and retry.',
      }
    }
    if (current.resourceConflict) {
      this.computerUseSetupError = current.lastError
      return {
        status: 'unavailable',
        message: current.lastError ?? 'A container name conflict prevents setup.',
      }
    }
    this.computerUseSetupError = null
    this.computerUseProgress = null
    const setup = this._runComputerUseSetup()
    this.computerUseSetupPromise = setup
    void setup.finally(() => {
      if (this.computerUseSetupPromise === setup) {
        this.computerUseSetupPromise = null
      }
    })
    return {
      status: 'in_progress',
      message: 'The Debian XFCE Docker desktop is being prepared. The first setup downloads and builds its image.',
    }
  }

  private async _runComputerUseSetup(): Promise<void> {
    try {
      await this._requireDockerDesktopManager().prepare()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.computerUseSetupError = detail
      console.error('[ComputerUse] Could not prepare the Docker desktop:', detail)
    }
  }

  private async _getComputerUseStatus(): Promise<ComputerUseStatus> {
    let settings: Record<string, unknown> = {}
    try {
      const loaded = await this._request({ type: 'GET_SETTINGS', payload: {} })
      if (isRecord(loaded)) settings = loaded
    } catch (error) {
      console.error('[ComputerUse] Could not load settings:', error)
    }
    const rawMode = settings.computer_use_mode
    const mode: ComputerUseStatus['mode'] = rawMode === 'isolated' || rawMode === 'host'
      ? rawMode
      : 'auto'
    const status: ComputerUseStatus = {
      mode,
      hostConsent: settings.computer_use_host_consent === true,
      isolatedSupported: false,
      isolatedReady: false,
      installationComplete: false,
      guestRunning: false,
      preparing: this.computerUseSetupPromise !== null,
      progressPhase: this.computerUseSetupPromise
        ? this.computerUseProgress?.phase ?? null
        : null,
      lastError: this.computerUseSetupError,
    }
    try {
      const session = await this._requireDockerDesktopManager().getStatus()
      status.isolatedSupported = session.supported
      status.isolatedReady = session.ready
      status.installationComplete = session.imageReady && session.containerExists
      status.guestRunning = session.running
      status.preparing = status.preparing || session.provisioning
      status.lastError = session.ready
        ? null
        : this.computerUseSetupError ?? session.lastError
    } catch (error) {
      console.error('[ComputerUse] Could not read Docker desktop status:', error)
      status.lastError = 'HELIX could not read Docker desktop status.'
    }
    return status
  }

  private _requireDockerDesktopManager(): DockerDesktopManager {
    if (!this.dockerDesktopManager) {
      throw new Error('The Docker desktop session manager is unavailable.')
    }
    return this.dockerDesktopManager
  }

  private _getDeveloperTerminalSession(sender: Electron.WebContents, sessionId: unknown): DeveloperTerminalSession {
    this._assertToolboxSender(sender)
    if (typeof sessionId !== 'string') throw new TypeError('Terminal session ID is invalid.')
    const session = this.developerTerminalSessions.get(sessionId)
    if (!session || session.owner !== sender) throw new Error('Terminal session is unavailable.')
    return session
  }

  private _clampTerminalDimension(value: unknown, minimum: number, maximum: number, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`Terminal ${label} must be a finite number.`)
    }
    return Math.max(minimum, Math.min(maximum, Math.floor(value)))
  }

  private _closeDeveloperTerminalsForOwner(owner: Electron.WebContents): void {
    for (const session of this.developerTerminalSessions.values()) {
      if (session.owner !== owner) continue
      this.developerTerminalSessions.delete(session.id)
      session.process.kill()
    }
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
          if (this.browserSessionUpdate) {
            this._sendToPython({
              type: 'BROWSER_SESSION_UPDATE',
              payload: { ...this.browserSessionUpdate },
              timestamp: new Date().toISOString(),
            })
          }
          for (const [requestId, message] of this.queuedRequests) {
            if (!this.pendingRequests.has(requestId)) {
              this.queuedRequests.delete(requestId)
              continue
            }
            const remainingMs = (this.requestDeadlines.get(requestId) ?? 0) - Date.now()
            if (remainingMs <= 0) {
              this._expireRequest(requestId, `Request timeout: ${message.type}`)
            } else {
              this._sendRequest(ws, message)
            }
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
              this.requestDeadlines.delete(message.request_id)
              this.sentRequestIds.delete(message.request_id)
              this.queuedRequests.delete(message.request_id)
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
            this._sendToAll('helix:error', {
              source: 'agent_connection',
              message: 'The HELIX agent connection was lost. Reconnecting now.',
            })
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
      this.requestDeadlines.set(requestId, Date.now() + timeoutMs)
      this.requestTimeouts.set(requestId, setTimeout(
        () => this._expireRequest(requestId, `Request timeout: ${message.type}`),
        timeoutMs,
      ))

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this._sendRequest(this.ws, messageWithId)
      } else {
        this.queuedRequests.set(requestId, messageWithId)
      }
    })
  }

  private _sendRequest(
    ws: WebSocket,
    message: AgentMessage & { request_id: string },
  ): void {
    if (!this.pendingRequests.has(message.request_id)) return
    if ((this.requestDeadlines.get(message.request_id) ?? 0) <= Date.now()) {
      this._expireRequest(message.request_id, `Request timeout: ${message.type}`)
      return
    }
    this.queuedRequests.delete(message.request_id)
    this.sentRequestIds.add(message.request_id)
    try {
      ws.send(JSON.stringify(message))
    } catch (error) {
      this._expireRequest(
        message.request_id,
        error instanceof Error ? error.message : 'Could not send request to the agent.',
      )
    }
  }

  private _expireRequest(requestId: string, reason: string): void {
    const timeout = this.requestTimeouts.get(requestId)
    if (timeout) clearTimeout(timeout)
    this.requestTimeouts.delete(requestId)
    this.requestDeadlines.delete(requestId)
    this.queuedRequests.delete(requestId)
    if (this.sentRequestIds.delete(requestId)) {
      try {
        this._sendToPython({
          type: 'CANCEL_REQUEST',
          payload: { request_id: requestId },
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        console.warn(
          '[IPCBridge] Could not send cancellation for an expired request:',
          error,
        )
      }
    }
    const resolver = this.pendingRequests.get(requestId)
    this.pendingRequests.delete(requestId)
    resolver?.(undefined, reason)
  }

  private _forwardToRenderer(message: AgentMessage): void {
    if (typeof message.type === 'string' && message.type.startsWith('VOICE_')) {
      this._sendToAll('helix:voice-event', message)
      return
    }

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
      'hand_landmarks': 'helix:hand-landmarks',
      'desktop_frame': 'helix:desktop-frame',
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
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, message.payload)
      }
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
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
    if (this.toolboxWindow && !this.toolboxWindow.isDestroyed()) {
      this.toolboxWindow.webContents.send(channel, data)
    }
    if (this.agentsWindow && !this.agentsWindow.isDestroyed()) {
      this.agentsWindow.webContents.send(channel, data)
    }
  }
}
