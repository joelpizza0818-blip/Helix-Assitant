import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  screen,
  shell,
  Notification,
  dialog,
  globalShortcut,
  clipboard
} from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'
import { PythonManager } from './python-manager'
import { IPCBridge } from './ipc'
import { TrayManager } from './tray'
import { BrowserExtensionBridge } from './browser-extension-bridge'
import { ClipboardHistory } from './clipboard-history'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const rendererPort = Number(process.env.HELIX_RENDERER_PORT || 5173)
const RENDERER_URL = isDev
  ? `http://127.0.0.1:${rendererPort}`
  : pathToFileURL(path.join(__dirname, '../dist/index.html')).toString()
const DEFAULT_WS_PORT = parseInt(process.env.AGENT_WS_PORT || '8765', 10)
const UPDATE_POLICY_URL = 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-updates/policy.json'
let wsPort = DEFAULT_WS_PORT

if (isDev) {
  const checkoutName = path.basename(path.resolve(app.getAppPath(), '..', '..'))
  app.setPath(
    'userData',
    path.join(app.getPath('appData'), `@helix-desktop-dev-${checkoutName}`)
  )
}

let floatingWindow: BrowserWindow | null = null
let toolboxWindow: BrowserWindow | null = null
let confirmationWindow: BrowserWindow | null = null
let trayManager: TrayManager | null = null
let pythonManager: PythonManager | null = null
let ipcBridge: IPCBridge | null = null
let browserExtensionBridge: BrowserExtensionBridge | null = null
let clipboardHistory: ClipboardHistory | null = null
let updaterCheckInProgress = false
let updateDownloaded = false
let isQuitting = false
let shutdownComplete = false
let adminAuthenticated = false
let pendingOAuthCallback: string | null = null

function sendPendingOAuthCallback(): void {
  if (!pendingOAuthCallback || !toolboxWindow || toolboxWindow.webContents.isLoading()) return
  toolboxWindow.webContents.send('helix:oauth-callback', pendingOAuthCallback)
  pendingOAuthCallback = null
}

function handleOAuthCallbackUrl(value: string): void {
  let callback: URL
  try {
    callback = new URL(value)
  } catch {
    return
  }
  if (callback.protocol !== 'helix:' || callback.hostname !== 'auth' || callback.pathname !== '/callback') return
  pendingOAuthCallback = callback.toString()
  sendPendingOAuthCallback()
  toolboxWindow?.show()
  toolboxWindow?.focus()
}

async function verifyGithubAdmin(token: string): Promise<boolean> {
  if (!token.trim()) {
    adminAuthenticated = false
    return false
  }

  try {
    const response = await fetch(`${adminApiBaseUrl()}/authorization`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (response.status === 401) {
      adminAuthenticated = false
      return false
    }
    if (!response.ok) {
      throw new Error(`Could not check the admin rank (server returned ${response.status}).`)
    }
    const result: unknown = await response.json()
    if (
      result === null
      || typeof result !== 'object'
      || !('success' in result)
      || result.success !== true
      || !('authenticated' in result)
      || typeof result.authenticated !== 'boolean'
    ) {
      throw new Error('The server returned an invalid admin authorization response.')
    }
    const isAdmin = result.authenticated
    adminAuthenticated = isAdmin
    return isAdmin
  } catch (error) {
    adminAuthenticated = false
    throw error
  }
}

interface AdminBackup { version: string; createdAt: string; currentVersion: string | null }
interface AdminConfig { autoUpdate: boolean; checkIntervalHours: number; channel: 'stable' | 'beta'; publicVersion: string; backups: AdminBackup[] }

function adminConfigPath(): string { return path.join(app.getPath('userData'), 'admin-config.json') }
function readAdminConfig(): AdminConfig {
  const fallback: AdminConfig = { autoUpdate: true, checkIntervalHours: 24, channel: 'stable', publicVersion: app.getVersion(), backups: [] }
  try {
    const value = JSON.parse(fs.readFileSync(adminConfigPath(), 'utf8'))
    return { ...fallback, ...value, backups: Array.isArray(value.backups) ? value.backups : [] }
  } catch { return fallback }
}
function writeAdminConfig(config: AdminConfig): AdminConfig {
  const safe = { ...config, checkIntervalHours: Math.max(1, Math.min(720, Number(config.checkIntervalHours) || 24)), backups: config.backups.slice(0, 20) }
  fs.mkdirSync(path.dirname(adminConfigPath()), { recursive: true })
  fs.writeFileSync(adminConfigPath(), JSON.stringify(safe, null, 2), 'utf8')
  return safe
}

function adminApiBaseUrl(): string {
  return process.env.HELIX_ADMIN_URL
    || 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-admin'
}

async function loadAdminConfig(token: string): Promise<AdminConfig & { synced?: boolean; syncError?: string }> {
  const local = readAdminConfig()
  try {
    const response = await fetch(`${adminApiBaseUrl()}/policy`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      return { ...local, synced: false, syncError: `Server rejected admin policy (${response.status}).` }
    }
    const result = await response.json() as { success?: boolean; data?: Record<string, unknown> }
    const data = result.data
    if (
      result.success !== true
      || !data
      || typeof data.publicVersion !== 'string'
      || (data.channel !== 'stable' && data.channel !== 'beta')
      || typeof data.autoUpdate !== 'boolean'
      || typeof data.checkIntervalHours !== 'number'
      || !Array.isArray(data.backups)
    ) {
      return { ...local, synced: false, syncError: 'The server returned an invalid admin policy.' }
    }
    const remote: AdminConfig = {
      publicVersion: data.publicVersion,
      channel: data.channel,
      autoUpdate: data.autoUpdate,
      checkIntervalHours: data.checkIntervalHours,
      backups: data.backups.filter((backup): backup is AdminBackup => (
        backup !== null
        && typeof backup === 'object'
        && 'version' in backup
        && typeof backup.version === 'string'
        && 'createdAt' in backup
        && typeof backup.createdAt === 'string'
      )),
    }
    writeAdminConfig(remote)
    return { ...remote, synced: true }
  } catch (error) {
    return {
      ...local,
      synced: false,
      syncError: error instanceof Error ? error.message : 'Could not load admin policy.',
    }
  }
}

async function publishAdminConfig(config: AdminConfig, token: string): Promise<{ synced: boolean; error?: string }> {
  try {
    const response = await fetch(`${adminApiBaseUrl()}/policy`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        publicVersion: config.publicVersion || app.getVersion(),
        channel: config.channel,
        autoUpdate: config.autoUpdate,
        checkIntervalHours: config.checkIntervalHours,
      }),
    })
    if (!response.ok) return { synced: false, error: `Server rejected admin policy (${response.status}).` }
    return { synced: true }
  } catch (error) {
    return { synced: false, error: error instanceof Error ? error.message : 'Could not sync admin policy.' }
  }
}

async function publishAdminBackup(backup: AdminBackup, token: string): Promise<{ synced: boolean; error?: string }> {
  try {
    const response = await fetch(`${adminApiBaseUrl()}/backups`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version: backup.version, currentVersion: backup.currentVersion }),
    })
    if (!response.ok) return { synced: false, error: `Server rejected backup (${response.status}).` }
    return { synced: true }
  } catch (error) {
    return { synced: false, error: error instanceof Error ? error.message : 'Could not sync backup.' }
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', (_event, commandLine) => {
  const oauthUrl = commandLine.find((argument) => argument.startsWith('helix://auth/callback'))
  if (oauthUrl) handleOAuthCallbackUrl(oauthUrl)
  const window = toolboxWindow?.isVisible() ? toolboxWindow : floatingWindow
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
})

function loadWithRetry(win: BrowserWindow, url: string, maxRetries = 30, intervalMs = 1500) {
  win.loadURL(url).catch(() => {
    if (maxRetries > 0) {
      setTimeout(() => {
        if (!win.isDestroyed()) {
          loadWithRetry(win, url, maxRetries - 1, intervalMs)
        }
      }, intervalMs)
    } else {
      console.error(`[Main] Failed to load ${url} after all retries`)
    }
  })
}

function createFloatingWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  const win = new BrowserWindow({
    width: 420,
    height: 640,
    x: width - 440,
    y: height - 660,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: '#101010',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  loadWithRetry(win, `${RENDERER_URL}#floating`)

  // Prevent closing — hide instead
  win.on('close', (e) => {
    e.preventDefault()
    win.hide()
  })

  return win
}

function createToolboxWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    titleBarStyle: 'default',
    show: false,
    backgroundColor: '#101010',
    title: 'HELIX Toolbox',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.webContents.on('did-finish-load', () => {
    sendPendingOAuthCallback()
  })
  loadWithRetry(win, `${RENDERER_URL}#toolbox`)
  win.setMenuBarVisibility(false)

  win.on('close', (e) => {
    e.preventDefault()
    win.hide()
  })

  return win
}

function createConfirmationWindow(): BrowserWindow {
  const { x, y, width } = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    width: 400,
    height: 360,
    x: x + width - 416,
    y: y + 16,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  loadWithRetry(win, `${RENDERER_URL}#confirmation`)
  return win
}

async function startPythonAgent(): Promise<void> {
  const agentCandidates = isDev
    ? [
        path.resolve(app.getAppPath(), '..', '..', 'services', 'agent'),
        path.resolve(__dirname, '../../../services/agent'),
        path.resolve(process.cwd(), 'services/agent')
      ]
    : [
        // Keep the package root aligned with the Python import path: the
        // bundled entrypoint imports services.agent.*.
        path.join(process.resourcesPath, 'services', 'agent'),
        // Accept packages produced by older HELIX builds during upgrades.
        path.join(process.resourcesPath, 'agent')
      ]

  const agentDir = agentCandidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'main.py'))
  )
  if (!agentDir) {
    throw new Error(
      `Python agent main.py not found. Checked:\n${agentCandidates.join('\n')}`
    )
  }

  console.log(`[Main] Desktop app root: ${app.getAppPath()}`)
  console.log(`[Main] Found Python agent at: ${agentDir}`)

  const packagedAgentCandidates = [
    path.join(process.resourcesPath, 'agent-runtime', 'helix-agent', 'helix-agent.exe'),
    path.join(process.resourcesPath, 'agent-runtime', 'helix-agent.exe')
  ]
  const packagedAgent = !isDev
    ? packagedAgentCandidates.find((candidate) => fs.existsSync(candidate))
    : undefined

  pythonManager = new PythonManager()

  pythonManager.onStdout((line) => {
    console.log(`[Python] ${line}`)
  })

  pythonManager.onStderr((line) => {
    console.error(`[Python:err] ${line}`)
  })

  pythonManager.onExit((code) => {
    console.warn(`[Python] Process exited with code: ${code}`)
    trayManager?.updateStatus('error')
  })

  wsPort = await pythonManager.start(
    agentDir,
    DEFAULT_WS_PORT,
    path.join(app.getPath('userData'), 'settings.json'),
    packagedAgent
  )
  console.log('[Main] Python agent started')
}

function setupIPC(): void {
  if (!floatingWindow || !toolboxWindow || !confirmationWindow) return

  ipcBridge = new IPCBridge()
  ipcBridge.onSettingsApplied(applyDesktopSettings)
  ipcBridge.setupHandlers(floatingWindow, toolboxWindow, confirmationWindow)

  ipcMain.handle('helix:updater-check', async () => {
    if (!app.isPackaged || process.platform !== 'win32') return { status: 'unsupported' }
    await checkForUpdates()
    return { status: 'checking', version: app.getVersion() }
  })
  ipcMain.handle('helix:updater-download', async () => {
    if (!app.isPackaged || process.platform !== 'win32') {
      throw new Error('Updates are only available in an installed HELIX Windows build.')
    }
    await autoUpdater.downloadUpdate()
  })
  ipcMain.handle('helix:updater-install', () => {
    if (!app.isPackaged || process.platform !== 'win32' || !updateDownloaded) {
      throw new Error('There is no downloaded HELIX update ready to install.')
    }
    autoUpdater.quitAndInstall(false, true)
  })
  ipcMain.handle('helix:admin-status', () => ({
    configured: true,
    authenticated: adminAuthenticated,
  }))
  ipcMain.handle('helix:app-version', () => app.getVersion())
  ipcMain.handle('helix:admin-validate', async (_event, accessToken: string) => {
    return { authenticated: await verifyGithubAdmin(accessToken) }
  })
  ipcMain.handle('helix:admin-config', async (_event, accessToken: string) => {
    if (!await verifyGithubAdmin(accessToken)) throw new Error('Admin authentication required.')
    return loadAdminConfig(accessToken)
  })
  ipcMain.handle('helix:admin-save-config', async (_event, accessToken: string, incoming: Partial<AdminConfig>) => {
    if (!await verifyGithubAdmin(accessToken)) throw new Error('Admin authentication required.')
    const current = readAdminConfig()
    const next: AdminConfig = {
      ...current,
      ...incoming,
      channel: incoming.channel === 'beta' ? 'beta' : 'stable',
      backups: Array.isArray(incoming.backups) ? incoming.backups : current.backups,
    }
    if (
      typeof next.autoUpdate !== 'boolean'
      || !Number.isInteger(next.checkIntervalHours)
      || next.checkIntervalHours < 1
      || next.checkIntervalHours > 720
      || !/^\d+(?:\.\d+){1,3}$/.test(next.publicVersion)
    ) {
      throw new Error('Admin policy contains an invalid value.')
    }
    const saved = writeAdminConfig(next)
    const sync = await publishAdminConfig(saved, accessToken)
    if (saved.autoUpdate) void checkForUpdates()
    return { ...saved, synced: sync.synced, syncError: sync.error }
  })
  ipcMain.handle('helix:admin-backup', async (_event, accessToken: string, version: string) => {
    if (!await verifyGithubAdmin(accessToken)) throw new Error('Admin authentication required.')
    if (typeof version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(version)) throw new Error('Invalid version.')
    const current = readAdminConfig()
    const backup = { version, createdAt: new Date().toISOString(), currentVersion: app.getVersion() }
    const savedBackup = writeAdminConfig({ ...current, backups: [backup, ...current.backups.filter((item) => item.version !== version)] }).backups[0]
    const sync = await publishAdminBackup(savedBackup, accessToken)
    return { ...savedBackup, synced: sync.synced, syncError: sync.error }
  })

  ipcMain.handle('helix:get-browser-extension-info', () => {
    if (browserExtensionBridge) return browserExtensionBridge.getInfo()
    return {
      token: '',
      port: 47831,
      extensionPath: '',
      listening: false,
      lastPage: null,
      error: 'Browser companion is not initialized.',
    }
  })
  ipcMain.handle('helix:open-browser-extension-folder', async () => {
    if (!browserExtensionBridge) throw new Error('Browser companion is not initialized.')
    const error = await shell.openPath(browserExtensionBridge.getInfo().extensionPath)
    if (error) throw new Error(`Could not open the browser extension folder: ${error}`)
  })
  ipcMain.handle('helix:copy-text-to-clipboard', (_event, text: string) => {
    if (typeof text !== 'string') throw new TypeError('Clipboard text must be a string.')
    clipboard.writeText(text)
  })

  clipboardHistory = new ClipboardHistory(
    (items) => sendToDesktopWindows('helix:clipboard-history-changed', items),
    (enabled) => sendToDesktopWindows('helix:clipboard-monitoring-changed', enabled),
  )
  clipboardHistory.start()
  ipcMain.handle('helix:get-clipboard-history', () => clipboardHistory?.getHistory() ?? [])
  ipcMain.handle('helix:get-clipboard-monitoring', () => clipboardHistory?.isMonitoring() ?? false)
  ipcMain.handle('helix:set-clipboard-monitoring', (_event, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new TypeError('Clipboard monitoring state must be a boolean.')
    clipboardHistory?.setMonitoring(enabled)
  })
  ipcMain.handle('helix:clear-clipboard-history', () => clipboardHistory?.clear())
  ipcMain.handle('helix:restore-clipboard-item', (_event, id: string) => {
    if (typeof id !== 'string') throw new TypeError('Clipboard history item ID must be a string.')
    clipboardHistory?.restore(id)
  })
}

function sendToDesktopWindows(channel: string, payload: unknown): void {
  for (const window of [floatingWindow, toolboxWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged || updaterCheckInProgress) return
  updaterCheckInProgress = true
  try {
    await autoUpdater.checkForUpdates()
  } finally {
    updaterCheckInProgress = false
  }
}

async function getRemoteUpdatePolicy(): Promise<{
  autoUpdate: boolean
  checkIntervalHours: number
} | null> {
  const response = await fetch(UPDATE_POLICY_URL, {
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) {
    throw new Error(`Update policy service returned HTTP ${response.status}.`)
  }
  const policy: unknown = await response.json()
  if (
    policy === null
    || typeof policy !== 'object'
    || !('autoUpdate' in policy)
    || typeof policy.autoUpdate !== 'boolean'
    || !('checkIntervalHours' in policy)
    || typeof policy.checkIntervalHours !== 'number'
    || !Number.isInteger(policy.checkIntervalHours)
    || policy.checkIntervalHours < 1
    || policy.checkIntervalHours > 720
  ) {
    throw new Error('Update policy service returned invalid settings.')
  }
  return {
    autoUpdate: policy.autoUpdate,
    checkIntervalHours: policy.checkIntervalHours,
  }
}

function setupAutoUpdater(): void {
  if (!app.isPackaged || process.platform !== 'win32') return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  const adminConfig = readAdminConfig()
  autoUpdater.on('checking-for-update', () => {
    sendToDesktopWindows('helix:updater-status', { status: 'checking', currentVersion: app.getVersion() })
  })
  autoUpdater.on('update-available', (info) => {
    sendToDesktopWindows('helix:updater-status', {
      status: 'available',
      currentVersion: app.getVersion(),
      version: info.version,
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    sendToDesktopWindows('helix:updater-status', {
      status: 'current',
      currentVersion: app.getVersion(),
      version: info.version,
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    sendToDesktopWindows('helix:updater-status', {
      status: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true
    sendToDesktopWindows('helix:updater-status', {
      status: 'downloaded',
      currentVersion: app.getVersion(),
      version: info.version,
    })
  })
  autoUpdater.on('error', (error) => {
    console.error('[Updater] Update operation failed:', error)
    sendToDesktopWindows('helix:updater-status', {
      status: 'error',
      message: error.message || 'Could not check for updates.',
    })
  })
  let lastAutomaticCheck = 0
  const scheduleCheck = async () => {
    const localConfig = readAdminConfig()
    let remotePolicy: Awaited<ReturnType<typeof getRemoteUpdatePolicy>> = null
    try {
      remotePolicy = await getRemoteUpdatePolicy()
    } catch (error) {
      console.warn('[Updater] Could not load shared update policy; using local policy:', error)
    }
    const autoUpdate = remotePolicy?.autoUpdate ?? localConfig.autoUpdate
    if (!autoUpdate) return
    const checkIntervalHours = remotePolicy?.checkIntervalHours ?? localConfig.checkIntervalHours
    if (Date.now() - lastAutomaticCheck < checkIntervalHours * 60 * 60 * 1000) return
    lastAutomaticCheck = Date.now()
    try {
      await checkForUpdates()
    } catch (error) {
      console.error('[Updater] Automatic update check failed:', error)
    }
  }
  setTimeout(() => void scheduleCheck(), 30_000)
  setInterval(() => void scheduleCheck(), 15 * 60 * 1000)
}

async function startBrowserExtensionBridge(): Promise<void> {
  const extensionPath = app.isPackaged
    ? path.join(process.resourcesPath, 'browser-extension')
    : path.join(app.getAppPath(), 'browser-extension')
  browserExtensionBridge = new BrowserExtensionBridge(
    path.join(app.getPath('userData'), 'browser-extension-token'),
    extensionPath,
    (snapshot) => ipcBridge?.sendBrowserPageUpdate(snapshot) ?? false,
  )
  try {
    await browserExtensionBridge.start()
  } catch (error) {
    console.error('[Main] Browser companion could not start:', error)
  }
}

function applyDesktopSettings(settings: Record<string, unknown>): void {
  if (typeof settings.always_on_top === 'boolean') {
    floatingWindow?.setAlwaysOnTop(settings.always_on_top)
  }

  globalShortcut.unregisterAll()
  const summon = settings.global_summon_shortcut
  if (typeof summon === 'string' && summon.trim()) {
    globalShortcut.register(summon, () => {
      if (!floatingWindow || floatingWindow.isDestroyed()) return
      if (floatingWindow.isMinimized()) floatingWindow.restore()
      floatingWindow.show()
      floatingWindow.focus()
    })
  }

  const emergency = settings.emergency_stop_shortcut
  if (typeof emergency === 'string' && emergency.trim()) {
    globalShortcut.register(emergency, () => ipcBridge?.sendEmergencyStop())
  }
}

async function connectWebSocket(retryCount = 0, maxRetries = 15): Promise<void> {
  if (!ipcBridge) return

  try {
    await ipcBridge.connectToPython(`ws://127.0.0.1:${wsPort}`)
    console.log('[Main] Connected to Python agent WebSocket')
    const settings = await ipcBridge.loadSettings()
    if (settings.start_minimized === false) {
      floatingWindow?.show()
      floatingWindow?.focus()
    }
    trayManager?.updateStatus('idle')
  } catch (err) {
    console.error(`[Main] Could not connect to Python WebSocket (attempt ${retryCount + 1}/${maxRetries}):`, (err as Error).message)
    trayManager?.updateStatus('error')
    if (retryCount < maxRetries) {
      const delay = Math.min(2000 + retryCount * 1000, 10000)
      setTimeout(() => connectWebSocket(retryCount + 1, maxRetries), delay)
    } else {
      console.error('[Main] Exhausted WebSocket reconnect attempts. Python agent may not be running.')
    }
  }
}

app.whenReady().then(async () => {
  app.setAsDefaultProtocolClient('helix')

  // Set app user model ID for Windows notifications
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.helix.agent')
  }

  // Disable default menu
  Menu.setApplicationMenu(null)
  setupAutoUpdater()

  // Create windows
  floatingWindow = createFloatingWindow()
  toolboxWindow = createToolboxWindow()
  confirmationWindow = createConfirmationWindow()
  const startupOAuthUrl = process.argv.find((argument) => argument.startsWith('helix://auth/callback'))
  if (startupOAuthUrl) handleOAuthCallbackUrl(startupOAuthUrl)
  setupIPC()

  // Create tray
  const iconPath = path.join(__dirname, '../assets/tray-icon.png')
  trayManager = new TrayManager()
  trayManager.create(iconPath)
  trayManager.setOnLeftClick(() => {
    if (!floatingWindow) return
    if (floatingWindow.isVisible()) {
      floatingWindow.hide()
    } else {
      floatingWindow.show()
      floatingWindow.focus()
    }
  })

  // Build tray context menu
  const buildContextMenu = () => {
    return Menu.buildFromTemplate([
      {
        label: 'Open HELIX',
        click: () => { floatingWindow?.show(); floatingWindow?.focus() }
      },
      {
        label: 'Toolbox',
        click: () => { toolboxWindow?.show(); toolboxWindow?.focus() }
      },
      {
        label: 'Task Manager',
        click: () => {
          floatingWindow?.show()
          floatingWindow?.webContents.send('helix:show-tasks')
        }
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => { toolboxWindow?.show(); toolboxWindow?.focus() }
      },
      { type: 'separator' },
      {
        label: 'Quit HELIX',
        click: () => {
          app.quit()
        }
      }
    ])
  }

  trayManager.setContextMenu(buildContextMenu())

  // Start Python agent
  await startPythonAgent()
  await startBrowserExtensionBridge()

  // Connect WebSocket only after the Python agent reports readiness.
  connectWebSocket()

  // The persisted startup preference controls whether the overlay is shown;
  // the tray remains available even when HELIX starts minimized.
  trayManager.updateStatus('idle')
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[Main] HELIX failed to start:', error)
  dialog.showErrorBox(
    'HELIX could not start its agent',
    `${message}\n\nCheck services/agent/requirements.txt and the Python environment, then start HELIX again.`
  )
  app.quit()
})

app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  if (isQuitting) return

  isQuitting = true
  console.log('[Main] Quitting HELIX...')
  void (async () => {
    floatingWindow?.removeAllListeners('close')
    toolboxWindow?.removeAllListeners('close')
    confirmationWindow?.removeAllListeners('close')
    floatingWindow?.destroy()
    toolboxWindow?.destroy()
    confirmationWindow?.destroy()
    trayManager?.destroy()
    ipcBridge?.close()
    clipboardHistory?.stop()
    await browserExtensionBridge?.close()
    await pythonManager?.stop()
    shutdownComplete = true
    app.quit()
  })().catch((error: unknown) => {
    console.error('[Main] Failed to shut down HELIX cleanly:', error)
    app.exit(1)
  })
})

app.on('window-all-closed', () => {
  // Do NOT quit — HELIX lives in the tray
  // Only quit when user explicitly selects Quit from tray menu
})

// Handle IPC for opening toolbox
ipcMain.on('helix:open-toolbox', () => {
  toolboxWindow?.show()
  toolboxWindow?.focus()
})

ipcMain.on('helix:quit', () => {
  app.quit()
})

// Handle IPC for opening external URLs safely
ipcMain.on('helix:open-external', (_event, url: string) => {
  if (url.startsWith('https://') || url.startsWith('http://')) {
    shell.openExternal(url)
  }
})

export { floatingWindow, toolboxWindow, ipcBridge }
