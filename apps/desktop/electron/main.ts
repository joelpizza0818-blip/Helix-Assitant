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

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
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

function setupAutoUpdater(): void {
  if (!app.isPackaged || process.platform !== 'win32') return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
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
  setTimeout(() => {
    void checkForUpdates().catch((error: unknown) => {
      console.error('[Updater] Initial update check failed:', error)
    })
  }, 30_000)
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
