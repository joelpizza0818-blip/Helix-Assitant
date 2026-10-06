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
import { PythonManager } from './python-manager'
import { IPCBridge } from './ipc'
import { TrayManager } from './tray'

const isDev = process.env.NODE_ENV === 'development'
const RENDERER_URL = isDev ? 'http://localhost:5173' : `file://${path.join(__dirname, '../dist/index.html')}`
const WS_PORT = parseInt(process.env.AGENT_WS_PORT || '8765', 10)

let floatingWindow: BrowserWindow | null = null
let toolboxWindow: BrowserWindow | null = null
let trayManager: TrayManager | null = null
let pythonManager: PythonManager | null = null
let ipcBridge: IPCBridge | null = null

// Single instance lock
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  // Someone tried to run a second instance — focus our window
  if (floatingWindow) {
    if (floatingWindow.isMinimized()) floatingWindow.restore()
    floatingWindow.show()
    floatingWindow.focus()
  }
})

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

  win.loadURL(`${RENDERER_URL}#floating`)

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

  win.loadURL(`${RENDERER_URL}#toolbox`)
  win.setMenuBarVisibility(false)

  win.on('close', (e) => {
    e.preventDefault()
    win.hide()
  })

  return win
}

async function startPythonAgent(): Promise<void> {
  let agentDir = isDev
    ? path.resolve(__dirname, '../../services/agent')
    : path.join(process.resourcesPath, 'agent')

  if (!fs.existsSync(path.join(agentDir, 'main.py'))) {
    const fallbackDir = path.resolve(process.cwd(), 'services/agent')
    if (fs.existsSync(path.join(fallbackDir, 'main.py'))) {
      agentDir = fallbackDir
    }
  }

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
    await pythonManager.start(agentDir, WS_PORT)
    console.log('[Main] Python agent started')
  } catch (err) {
    console.error('[Main] Failed to start Python agent:', err)
  }
}

async function connectIPC(): Promise<void> {
  if (!floatingWindow || !toolboxWindow) return

  ipcBridge = new IPCBridge()
  ipcBridge.setupHandlers(floatingWindow, toolboxWindow)

  // Give Python a moment to start the WebSocket server
  await new Promise((resolve) => setTimeout(resolve, 2000))

  try {
    await ipcBridge.connectToPython(`ws://localhost:${WS_PORT}`)
    console.log('[Main] Connected to Python agent WebSocket')
    trayManager?.updateStatus('idle')
  } catch (err) {
    console.error('[Main] Could not connect to Python WebSocket:', err)
    trayManager?.updateStatus('error')
    // Retry after 5 seconds
    setTimeout(() => connectIPC(), 5000)
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

  // Connect IPC bridge
  await connectIPC()

  // Show floating window on startup
  floatingWindow?.show()
  floatingWindow?.focus()
  trayManager.updateStatus('idle')
})

app.on('before-quit', async () => {
  console.log('[Main] Quitting HELIX...')
  // Allow windows to close
  floatingWindow?.removeAllListeners('close')
  toolboxWindow?.removeAllListeners('close')
  // Stop Python agent
  await pythonManager?.stop()
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

// Handle IPC for opening external URLs safely
ipcMain.on('helix:open-external', (_event, url: string) => {
  if (url.startsWith('https://') || url.startsWith('http://')) {
    shell.openExternal(url)
  }
})

export { floatingWindow, toolboxWindow, ipcBridge }
