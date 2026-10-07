import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  screen,
  shell,
  Notification
} from 'electron'
import path from 'path'
import fs from 'fs'
import { PythonManager } from './python-manager'
import { IPCBridge } from './ipc'
import { TrayManager } from './tray'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const RENDERER_URL = isDev ? 'http://127.0.0.1:5173' : `file://${path.join(__dirname, '../dist/index.html')}`
const DEFAULT_WS_PORT = parseInt(process.env.AGENT_WS_PORT || '8765', 10)
let wsPort = DEFAULT_WS_PORT

let floatingWindow: BrowserWindow | null = null
let toolboxWindow: BrowserWindow | null = null
let trayManager: TrayManager | null = null
let pythonManager: PythonManager | null = null
let ipcBridge: IPCBridge | null = null
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

async function startPythonAgent(): Promise<void> {
  // Resolve agent directory — try multiple strategies
  const candidates = isDev
    ? [
        // process.cwd() is typically the workspace root (apps/desktop)
        path.resolve(process.cwd(), '../../services/agent'),
        // From dist-electron/ go up to monorepo root
        path.resolve(__dirname, '../../../services/agent'),
        // From apps/desktop/ go up to monorepo root
        path.resolve(__dirname, '../../services/agent'),
        // Absolute fallback
        path.resolve(process.cwd(), 'services/agent'),
      ]
    : [path.join(process.resourcesPath, 'agent')]

  let agentDir = ''
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'main.py'))) {
      agentDir = candidate
      break
    }
  }

  if (!agentDir) {
    console.error('[Main] Python agent main.py not found in any candidate path:')
    candidates.forEach((c) => console.error(`  - ${c}`))
    console.error('[Main] Python agent will NOT start. The app will run without backend.')
    return
  }

  console.log(`[Main] Found Python agent at: ${agentDir}`)

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

  try {
    wsPort = await pythonManager.start(
      agentDir,
      DEFAULT_WS_PORT,
      path.join(app.getPath('userData'), 'settings.json')
    )
    console.log('[Main] Python agent started')
  } catch (err) {
    console.error('[Main] Failed to start Python agent:', err)
  }
}

function setupIPC(): void {
  if (!floatingWindow || !toolboxWindow) return

  ipcBridge = new IPCBridge()
  ipcBridge.setupHandlers(floatingWindow, toolboxWindow)
}

async function connectWebSocket(retryCount = 0, maxRetries = 15): Promise<void> {
  if (!ipcBridge) return

  try {
    await ipcBridge.connectToPython(`ws://127.0.0.1:${wsPort}`)
    console.log('[Main] Connected to Python agent WebSocket')
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

  // Create windows
  floatingWindow = createFloatingWindow()
  toolboxWindow = createToolboxWindow()
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

  // Connect WebSocket only after the Python agent reports readiness.
  connectWebSocket()

  // Show floating window on startup
  floatingWindow?.show()
  floatingWindow?.focus()
  trayManager.updateStatus('idle')
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
    floatingWindow?.destroy()
    toolboxWindow?.destroy()
    trayManager?.destroy()
    ipcBridge?.close()
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
