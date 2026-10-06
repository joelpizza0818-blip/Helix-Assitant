"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ipcBridge = exports.toolboxWindow = exports.floatingWindow = void 0;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const python_manager_1 = require("./python-manager");
const ipc_1 = require("./ipc");
const tray_1 = require("./tray");
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
const RENDERER_URL = isDev ? 'http://127.0.0.1:5173' : `file://${path_1.default.join(__dirname, '../dist/index.html')}`;
const WS_PORT = parseInt(process.env.AGENT_WS_PORT || '8765', 10);
let floatingWindow = null;
exports.floatingWindow = floatingWindow;
let toolboxWindow = null;
exports.toolboxWindow = toolboxWindow;
let trayManager = null;
let pythonManager = null;
let ipcBridge = null;
exports.ipcBridge = ipcBridge;
// Single instance lock for packaged builds
if (electron_1.app.isPackaged) {
    const gotLock = electron_1.app.requestSingleInstanceLock();
    if (!gotLock) {
        electron_1.app.quit();
        process.exit(0);
    }
    electron_1.app.on('second-instance', () => {
        if (floatingWindow) {
            if (floatingWindow.isMinimized())
                floatingWindow.restore();
            floatingWindow.show();
            floatingWindow.focus();
        }
    });
}
function loadWithRetry(win, url, maxRetries = 30, intervalMs = 1500) {
    win.loadURL(url).catch(() => {
        if (maxRetries > 0) {
            setTimeout(() => {
                if (!win.isDestroyed()) {
                    loadWithRetry(win, url, maxRetries - 1, intervalMs);
                }
            }, intervalMs);
        }
        else {
            console.error(`[Main] Failed to load ${url} after all retries`);
        }
    });
}
function createFloatingWindow() {
    const { width, height } = electron_1.screen.getPrimaryDisplay().workAreaSize;
    const win = new electron_1.BrowserWindow({
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
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    loadWithRetry(win, `${RENDERER_URL}#floating`);
    // Prevent closing — hide instead
    win.on('close', (e) => {
        e.preventDefault();
        win.hide();
    });
    return win;
}
function createToolboxWindow() {
    const win = new electron_1.BrowserWindow({
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
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    loadWithRetry(win, `${RENDERER_URL}#toolbox`);
    win.setMenuBarVisibility(false);
    win.on('close', (e) => {
        e.preventDefault();
        win.hide();
    });
    return win;
}
async function startPythonAgent() {
    let agentDir = isDev
        ? path_1.default.resolve(__dirname, '../../services/agent')
        : path_1.default.join(process.resourcesPath, 'agent');
    if (!fs_1.default.existsSync(path_1.default.join(agentDir, 'main.py'))) {
        const fallbackDir = path_1.default.resolve(process.cwd(), 'services/agent');
        if (fs_1.default.existsSync(path_1.default.join(fallbackDir, 'main.py'))) {
            agentDir = fallbackDir;
        }
    }
    pythonManager = new python_manager_1.PythonManager();
    pythonManager.onStdout((line) => {
        console.log(`[Python] ${line}`);
    });
    pythonManager.onStderr((line) => {
        console.error(`[Python:err] ${line}`);
    });
    pythonManager.onExit((code) => {
        console.warn(`[Python] Process exited with code: ${code}`);
        trayManager?.updateStatus('error');
    });
    try {
        await pythonManager.start(agentDir, WS_PORT);
        console.log('[Main] Python agent started');
    }
    catch (err) {
        console.error('[Main] Failed to start Python agent:', err);
    }
}
function setupIPC() {
    if (!floatingWindow || !toolboxWindow)
        return;
    exports.ipcBridge = ipcBridge = new ipc_1.IPCBridge();
    ipcBridge.setupHandlers(floatingWindow, toolboxWindow);
}
async function connectWebSocket(retryCount = 0, maxRetries = 15) {
    if (!ipcBridge)
        return;
    // Give Python a moment to start the WebSocket server on first attempt
    if (retryCount === 0) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    try {
        await ipcBridge.connectToPython(`ws://127.0.0.1:${WS_PORT}`);
        console.log('[Main] Connected to Python agent WebSocket');
        trayManager?.updateStatus('idle');
    }
    catch (err) {
        console.error(`[Main] Could not connect to Python WebSocket (attempt ${retryCount + 1}/${maxRetries}):`, err.message);
        trayManager?.updateStatus('error');
        if (retryCount < maxRetries) {
            const delay = Math.min(2000 + retryCount * 1000, 10000);
            setTimeout(() => connectWebSocket(retryCount + 1, maxRetries), delay);
        }
        else {
            console.error('[Main] Exhausted WebSocket reconnect attempts. Python agent may not be running.');
        }
    }
}
electron_1.app.whenReady().then(async () => {
    // Set app user model ID for Windows notifications
    if (process.platform === 'win32') {
        electron_1.app.setAppUserModelId('com.helix.agent');
    }
    // Disable default menu
    electron_1.Menu.setApplicationMenu(null);
    // Create windows
    exports.floatingWindow = floatingWindow = createFloatingWindow();
    exports.toolboxWindow = toolboxWindow = createToolboxWindow();
    // Create tray
    const iconPath = path_1.default.join(__dirname, '../assets/tray-icon.png');
    trayManager = new tray_1.TrayManager();
    trayManager.create(iconPath);
    trayManager.setOnLeftClick(() => {
        if (!floatingWindow)
            return;
        if (floatingWindow.isVisible()) {
            floatingWindow.hide();
        }
        else {
            floatingWindow.show();
            floatingWindow.focus();
        }
    });
    // Build tray context menu
    const buildContextMenu = () => {
        return electron_1.Menu.buildFromTemplate([
            {
                label: 'Open HELIX',
                click: () => { floatingWindow?.show(); floatingWindow?.focus(); }
            },
            {
                label: 'Toolbox',
                click: () => { toolboxWindow?.show(); toolboxWindow?.focus(); }
            },
            {
                label: 'Task Manager',
                click: () => {
                    floatingWindow?.show();
                    floatingWindow?.webContents.send('helix:show-tasks');
                }
            },
            { type: 'separator' },
            {
                label: 'Settings',
                click: () => { toolboxWindow?.show(); toolboxWindow?.focus(); }
            },
            { type: 'separator' },
            {
                label: 'Quit HELIX',
                click: () => {
                    electron_1.app.quit();
                }
            }
        ]);
    };
    trayManager.setContextMenu(buildContextMenu());
    // Start Python agent
    await startPythonAgent();
    // Register IPC handlers (once) and connect WebSocket (with retries)
    setupIPC();
    connectWebSocket();
    // Show floating window on startup
    floatingWindow?.show();
    floatingWindow?.focus();
    trayManager.updateStatus('idle');
});
electron_1.app.on('before-quit', async () => {
    console.log('[Main] Quitting HELIX...');
    // Allow windows to close
    floatingWindow?.removeAllListeners('close');
    toolboxWindow?.removeAllListeners('close');
    // Stop Python agent
    await pythonManager?.stop();
});
electron_1.app.on('window-all-closed', () => {
    // Do NOT quit — HELIX lives in the tray
    // Only quit when user explicitly selects Quit from tray menu
});
// Handle IPC for opening toolbox
electron_1.ipcMain.on('helix:open-toolbox', () => {
    toolboxWindow?.show();
    toolboxWindow?.focus();
});
// Handle IPC for opening external URLs safely
electron_1.ipcMain.on('helix:open-external', (_event, url) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
        electron_1.shell.openExternal(url);
    }
});
//# sourceMappingURL=main.js.map