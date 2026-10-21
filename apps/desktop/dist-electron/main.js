"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ipcBridge = exports.toolboxWindow = exports.floatingWindow = void 0;
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const url_1 = require("url");
const python_manager_1 = require("./python-manager");
const ipc_1 = require("./ipc");
const tray_1 = require("./tray");
const browser_extension_bridge_1 = require("./browser-extension-bridge");
const clipboard_history_1 = require("./clipboard-history");
const capability_manager_1 = require("./capability-manager");
const capability_config_1 = require("./capability-config");
const media_permissions_1 = require("./media-permissions");
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
const rendererPort = Number(process.env.HELIX_RENDERER_PORT || 5173);
const RENDERER_URL = isDev
    ? `http://127.0.0.1:${rendererPort}`
    : (0, url_1.pathToFileURL)(path_1.default.join(__dirname, '../dist/index.html')).toString();
const DEFAULT_WS_PORT = parseInt(process.env.AGENT_WS_PORT || '8765', 10);
const UPDATE_POLICY_URL = 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-updates/policy.json';
let wsPort = DEFAULT_WS_PORT;
if (isDev) {
    const checkoutName = path_1.default.basename(path_1.default.resolve(electron_1.app.getAppPath(), '..', '..'));
    electron_1.app.setPath('userData', path_1.default.join(electron_1.app.getPath('appData'), `@helix-desktop-dev-${checkoutName}`));
}
let floatingWindow = null;
exports.floatingWindow = floatingWindow;
let toolboxWindow = null;
exports.toolboxWindow = toolboxWindow;
let confirmationWindow = null;
let trayManager = null;
let pythonManager = null;
let ipcBridge = null;
exports.ipcBridge = ipcBridge;
let browserExtensionBridge = null;
let clipboardHistory = null;
let capabilityManager = null;
let updaterCheckInProgress = false;
let updateDownloaded = false;
let isQuitting = false;
let shutdownComplete = false;
let adminAuthenticated = false;
let pendingOAuthCallback = null;
const MAX_LOG_BUFFER_LINES = 2000;
const recentLogBuffer = [];
let logFileStream = null;
function appendSystemLog(prefix, message) {
    const timestamp = new Date().toISOString();
    const formattedLine = `[${timestamp}] ${prefix} ${message}`;
    recentLogBuffer.push(formattedLine);
    if (recentLogBuffer.length > MAX_LOG_BUFFER_LINES) {
        recentLogBuffer.shift();
    }
    try {
        if (!logFileStream) {
            const logsDirectory = path_1.default.join(electron_1.app.getPath('userData'), 'logs');
            if (!fs_1.default.existsSync(logsDirectory)) {
                fs_1.default.mkdirSync(logsDirectory, { recursive: true });
            }
            logFileStream = fs_1.default.createWriteStream(path_1.default.join(logsDirectory, 'helix.log'), { flags: 'a', encoding: 'utf-8' });
        }
        logFileStream.write(formattedLine + '\n');
    }
    catch {
        // Ignore logging failures to prevent interrupting main execution
    }
}
function normalizeOAuthCallbackUrl(value) {
    let callback;
    try {
        callback = new URL(value.trim().replace(/^["']|["']$/g, ''));
    }
    catch {
        return null;
    }
    const callbackPath = callback.pathname.replace(/\/+$/, '');
    const isCallbackRoute = (callback.hostname.toLowerCase() === 'auth' && callbackPath === '/callback')
        || (!callback.hostname && callbackPath === '/auth/callback');
    if (callback.protocol !== 'helix:' || !isCallbackRoute || callback.username || callback.password || callback.port) {
        return null;
    }
    return `helix://auth/callback${callback.search}${callback.hash}`;
}
function findOAuthCallbackArgument(argumentsList) {
    return argumentsList.find((argument) => normalizeOAuthCallbackUrl(argument) !== null);
}
function sendPendingOAuthCallback() {
    if (!pendingOAuthCallback || !toolboxWindow || toolboxWindow.webContents.isLoading())
        return;
    toolboxWindow.webContents.send('helix:oauth-callback', pendingOAuthCallback);
    pendingOAuthCallback = null;
}
function handleOAuthCallbackUrl(value) {
    const callback = normalizeOAuthCallbackUrl(value);
    if (!callback)
        return;
    pendingOAuthCallback = callback;
    sendPendingOAuthCallback();
    toolboxWindow?.show();
    toolboxWindow?.focus();
}
async function verifyGithubAdmin(token) {
    if (!token.trim()) {
        adminAuthenticated = false;
        return false;
    }
    try {
        const response = await fetch(`${adminApiBaseUrl()}/authorization`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(8000),
        });
        if (response.status === 401) {
            adminAuthenticated = false;
            return false;
        }
        if (!response.ok) {
            throw new Error(`Could not check the admin rank (server returned ${response.status}).`);
        }
        const result = await response.json();
        if (result === null
            || typeof result !== 'object'
            || !('success' in result)
            || result.success !== true
            || !('authenticated' in result)
            || typeof result.authenticated !== 'boolean') {
            throw new Error('The server returned an invalid admin authorization response.');
        }
        const isAdmin = result.authenticated;
        adminAuthenticated = isAdmin;
        return isAdmin;
    }
    catch (error) {
        adminAuthenticated = false;
        throw error;
    }
}
function adminConfigPath() { return path_1.default.join(electron_1.app.getPath('userData'), 'admin-config.json'); }
function readAdminConfig() {
    const fallback = { autoUpdate: true, checkIntervalHours: 24, channel: 'stable', publicVersion: electron_1.app.getVersion(), backups: [] };
    try {
        const value = JSON.parse(fs_1.default.readFileSync(adminConfigPath(), 'utf8'));
        return { ...fallback, ...value, backups: Array.isArray(value.backups) ? value.backups : [] };
    }
    catch {
        return fallback;
    }
}
function writeAdminConfig(config) {
    const safe = { ...config, checkIntervalHours: Math.max(1, Math.min(720, Number(config.checkIntervalHours) || 24)), backups: config.backups.slice(0, 20) };
    fs_1.default.mkdirSync(path_1.default.dirname(adminConfigPath()), { recursive: true });
    fs_1.default.writeFileSync(adminConfigPath(), JSON.stringify(safe, null, 2), 'utf8');
    return safe;
}
function adminApiBaseUrl() {
    return process.env.HELIX_ADMIN_URL
        || 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-admin';
}
async function loadAdminConfig(token) {
    const local = readAdminConfig();
    try {
        const response = await fetch(`${adminApiBaseUrl()}/policy`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
            return { ...local, synced: false, syncError: `Server rejected admin policy (${response.status}).` };
        }
        const result = await response.json();
        const data = result.data;
        if (result.success !== true
            || !data
            || typeof data.publicVersion !== 'string'
            || (data.channel !== 'stable' && data.channel !== 'beta')
            || typeof data.autoUpdate !== 'boolean'
            || typeof data.checkIntervalHours !== 'number'
            || !Array.isArray(data.backups)) {
            return { ...local, synced: false, syncError: 'The server returned an invalid admin policy.' };
        }
        const remote = {
            publicVersion: data.publicVersion,
            channel: data.channel,
            autoUpdate: data.autoUpdate,
            checkIntervalHours: data.checkIntervalHours,
            backups: data.backups.filter((backup) => (backup !== null
                && typeof backup === 'object'
                && 'version' in backup
                && typeof backup.version === 'string'
                && 'createdAt' in backup
                && typeof backup.createdAt === 'string')),
        };
        writeAdminConfig(remote);
        return { ...remote, synced: true };
    }
    catch (error) {
        return {
            ...local,
            synced: false,
            syncError: error instanceof Error ? error.message : 'Could not load admin policy.',
        };
    }
}
async function publishAdminConfig(config, token) {
    try {
        const response = await fetch(`${adminApiBaseUrl()}/policy`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                publicVersion: config.publicVersion || electron_1.app.getVersion(),
                channel: config.channel,
                autoUpdate: config.autoUpdate,
                checkIntervalHours: config.checkIntervalHours,
            }),
        });
        if (!response.ok)
            return { synced: false, error: `Server rejected admin policy (${response.status}).` };
        return { synced: true };
    }
    catch (error) {
        return { synced: false, error: error instanceof Error ? error.message : 'Could not sync admin policy.' };
    }
}
async function publishAdminBackup(backup, token) {
    try {
        const response = await fetch(`${adminApiBaseUrl()}/backups`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ version: backup.version, currentVersion: backup.currentVersion }),
        });
        if (!response.ok)
            return { synced: false, error: `Server rejected backup (${response.status}).` };
        return { synced: true };
    }
    catch (error) {
        return { synced: false, error: error instanceof Error ? error.message : 'Could not sync backup.' };
    }
}
const gotLock = electron_1.app.requestSingleInstanceLock();
if (!gotLock) {
    electron_1.app.quit();
    process.exit(0);
}
electron_1.app.on('second-instance', (_event, commandLine) => {
    const oauthUrl = findOAuthCallbackArgument(commandLine);
    if (oauthUrl)
        handleOAuthCallbackUrl(oauthUrl);
    const window = toolboxWindow?.isVisible() ? toolboxWindow : floatingWindow;
    if (!window)
        return;
    if (window.isMinimized())
        window.restore();
    window.show();
    window.focus();
});
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
    win.webContents.on('did-finish-load', () => {
        sendPendingOAuthCallback();
    });
    loadWithRetry(win, `${RENDERER_URL}#toolbox`);
    win.setMenuBarVisibility(false);
    win.on('close', (e) => {
        e.preventDefault();
        win.hide();
    });
    return win;
}
function createConfirmationWindow() {
    const { x, y, width } = electron_1.screen.getPrimaryDisplay().workArea;
    const win = new electron_1.BrowserWindow({
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
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    loadWithRetry(win, `${RENDERER_URL}#confirmation`);
    return win;
}
async function startPythonAgent() {
    const agentCandidates = isDev
        ? [
            path_1.default.resolve(electron_1.app.getAppPath(), '..', '..', 'services', 'agent'),
            path_1.default.resolve(__dirname, '../../../services/agent'),
            path_1.default.resolve(process.cwd(), 'services/agent')
        ]
        : [
            // Keep the package root aligned with the Python import path: the
            // bundled entrypoint imports services.agent.*.
            path_1.default.join(process.resourcesPath, 'services', 'agent'),
            // Accept packages produced by older HELIX builds during upgrades.
            path_1.default.join(process.resourcesPath, 'agent')
        ];
    const agentDir = agentCandidates.find((candidate) => fs_1.default.existsSync(path_1.default.join(candidate, 'main.py')));
    if (!agentDir) {
        throw new Error(`Python agent main.py not found. Checked:\n${agentCandidates.join('\n')}`);
    }
    console.log(`[Main] Desktop app root: ${electron_1.app.getAppPath()}`);
    console.log(`[Main] Found Python agent at: ${agentDir}`);
    const packagedAgentCandidates = [
        path_1.default.join(process.resourcesPath, 'agent-runtime', 'helix-agent', 'helix-agent.exe'),
        path_1.default.join(process.resourcesPath, 'agent-runtime', 'helix-agent.exe')
    ];
    const packagedAgent = !isDev
        ? packagedAgentCandidates.find((candidate) => fs_1.default.existsSync(candidate))
        : undefined;
    pythonManager = new python_manager_1.PythonManager();
    pythonManager.onStdout((line) => {
        appendSystemLog('[Python]', line);
        console.log(`[Python] ${line}`);
    });
    pythonManager.onStderr((line) => {
        appendSystemLog('[Python:err]', line);
        console.error(`[Python:err] ${line}`);
    });
    pythonManager.onExit((code) => {
        appendSystemLog('[Python]', `Process exited with code: ${code}`);
        console.warn(`[Python] Process exited with code: ${code}`);
        trayManager?.updateStatus('error');
    });
    wsPort = await pythonManager.start(agentDir, DEFAULT_WS_PORT, path_1.default.join(electron_1.app.getPath('userData'), 'settings.json'), packagedAgent);
    appendSystemLog('[Main]', `Python agent started on port ${wsPort} (packaged: ${Boolean(packagedAgent)})`);
    console.log('[Main] Python agent started');
}
function setupIPC() {
    if (!floatingWindow || !toolboxWindow || !confirmationWindow)
        return;
    exports.ipcBridge = ipcBridge = new ipc_1.IPCBridge();
    ipcBridge.onSettingsApplied(applyDesktopSettings);
    ipcBridge.onCapabilityRequired(async (payload) => {
        const id = typeof payload.capability === 'string' ? payload.capability : '';
        const requestId = typeof payload.request_id === 'string' ? payload.request_id : '';
        const manager = capabilityManager;
        const manifest = manager?.getManifest(id);
        if (!requestId) {
            ipcBridge?.sendCapabilityResolved({ request_id: requestId, capability: id, status: 'error', error: 'Capability pack is unavailable.' });
            return;
        }
        if (manager?.getProfile() === 'complete') {
            const installed = manager.isPackInstalled(id);
            ipcBridge?.sendCapabilityResolved({
                request_id: requestId,
                capability: id,
                status: installed ? 'installed' : 'error',
                ...(installed ? {} : { error: `Required capability pack '${id}' is missing from the complete installation.` }),
            });
            return;
        }
        if (!manifest) {
            ipcBridge?.sendCapabilityResolved({ request_id: requestId, capability: id, status: 'error', error: 'Capability pack is unavailable.' });
            return;
        }
        try {
            const installed = await manager.installPack(manifest);
            await ipcBridge.loadCapabilityPack(installed);
            ipcBridge?.sendCapabilityResolved({ request_id: requestId, capability: id, status: 'installed' });
        }
        catch (error) {
            ipcBridge?.sendCapabilityResolved({
                request_id: requestId,
                capability: id,
                status: 'error',
                error: error instanceof Error ? error.message : 'Capability installation failed.',
            });
        }
    });
    ipcBridge.setupHandlers(floatingWindow, toolboxWindow, confirmationWindow);
    electron_1.ipcMain.handle('helix:updater-check', async () => {
        if (!electron_1.app.isPackaged || process.platform !== 'win32')
            return { status: 'unsupported' };
        await checkForUpdates();
        return { status: 'checking', version: electron_1.app.getVersion() };
    });
    electron_1.ipcMain.handle('helix:updater-download', async () => {
        if (!electron_1.app.isPackaged || process.platform !== 'win32') {
            throw new Error('Updates are only available in an installed HELIX Windows build.');
        }
        await electron_updater_1.autoUpdater.downloadUpdate();
    });
    electron_1.ipcMain.handle('helix:updater-install', () => {
        if (!electron_1.app.isPackaged || process.platform !== 'win32' || !updateDownloaded) {
            throw new Error('There is no downloaded HELIX update ready to install.');
        }
        electron_updater_1.autoUpdater.quitAndInstall(false, true);
    });
    electron_1.ipcMain.handle('helix:admin-status', () => ({
        configured: true,
        authenticated: adminAuthenticated,
    }));
    electron_1.ipcMain.handle('helix:app-version', () => electron_1.app.getVersion());
    electron_1.ipcMain.handle('helix:get-capabilities', () => capabilityManager?.snapshot() ?? {
        profile: 'complete', packs: [], missingCount: 0, ready: true,
    });
    electron_1.ipcMain.handle('helix:refresh-capabilities', async () => {
        if (!capabilityManager)
            throw new Error('Capability manager is not initialized.');
        return capabilityManager.refreshCatalog();
    });
    electron_1.ipcMain.handle('helix:set-installation-profile', async (_event, profile) => {
        if (profile !== 'progressive' && profile !== 'complete')
            throw new TypeError('Invalid installation profile.');
        if (!capabilityManager)
            throw new Error('Capability manager is not initialized.');
        return capabilityManager.setProfile(profile);
    });
    electron_1.ipcMain.handle('helix:install-capability', async (_event, manifest) => {
        if (!capabilityManager)
            throw new Error('Capability manager is not initialized.');
        const installed = await capabilityManager.installPack(manifest);
        if (!ipcBridge)
            throw new Error('Python agent bridge is not initialized.');
        await ipcBridge.loadCapabilityPack(installed);
        return installed;
    });
    electron_1.ipcMain.handle('helix:cancel-capability', (_event, id) => {
        if (typeof id !== 'string')
            throw new TypeError('Capability pack id must be a string.');
        return capabilityManager?.cancelPack(id) ?? false;
    });
    electron_1.ipcMain.handle('helix:admin-validate', async (_event, accessToken) => {
        return { authenticated: await verifyGithubAdmin(accessToken) };
    });
    electron_1.ipcMain.handle('helix:admin-config', async (_event, accessToken) => {
        if (!await verifyGithubAdmin(accessToken))
            throw new Error('Admin authentication required.');
        return loadAdminConfig(accessToken);
    });
    electron_1.ipcMain.handle('helix:admin-save-config', async (_event, accessToken, incoming) => {
        if (!await verifyGithubAdmin(accessToken))
            throw new Error('Admin authentication required.');
        const current = readAdminConfig();
        const next = {
            ...current,
            ...incoming,
            channel: incoming.channel === 'beta' ? 'beta' : 'stable',
            backups: Array.isArray(incoming.backups) ? incoming.backups : current.backups,
        };
        if (typeof next.autoUpdate !== 'boolean'
            || !Number.isInteger(next.checkIntervalHours)
            || next.checkIntervalHours < 1
            || next.checkIntervalHours > 720
            || !/^\d+(?:\.\d+){1,3}$/.test(next.publicVersion)) {
            throw new Error('Admin policy contains an invalid value.');
        }
        const saved = writeAdminConfig(next);
        const sync = await publishAdminConfig(saved, accessToken);
        if (saved.autoUpdate)
            void checkForUpdates();
        return { ...saved, synced: sync.synced, syncError: sync.error };
    });
    electron_1.ipcMain.handle('helix:admin-backup', async (_event, accessToken, version) => {
        if (!await verifyGithubAdmin(accessToken))
            throw new Error('Admin authentication required.');
        if (typeof version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(version))
            throw new Error('Invalid version.');
        const current = readAdminConfig();
        const backup = { version, createdAt: new Date().toISOString(), currentVersion: electron_1.app.getVersion() };
        const savedBackup = writeAdminConfig({ ...current, backups: [backup, ...current.backups.filter((item) => item.version !== version)] }).backups[0];
        const sync = await publishAdminBackup(savedBackup, accessToken);
        return { ...savedBackup, synced: sync.synced, syncError: sync.error };
    });
    electron_1.ipcMain.handle('helix:admin-logs', async (_event, accessToken) => {
        if (!await verifyGithubAdmin(accessToken))
            throw new Error('Admin authentication required.');
        const logsDirectory = path_1.default.join(electron_1.app.getPath('userData'), 'logs');
        const mainLogFile = path_1.default.join(logsDirectory, 'helix.log');
        const agentLogFile = path_1.default.join(logsDirectory, 'agent.log');
        return {
            success: true,
            logs: [...recentLogBuffer],
            logPath: mainLogFile,
            agentLogPath: fs_1.default.existsSync(agentLogFile) ? agentLogFile : undefined,
            totalCount: recentLogBuffer.length,
        };
    });
    electron_1.ipcMain.handle('helix:admin-clear-logs', async (_event, accessToken) => {
        if (!await verifyGithubAdmin(accessToken))
            throw new Error('Admin authentication required.');
        recentLogBuffer.length = 0;
        try {
            if (logFileStream) {
                logFileStream.end();
                logFileStream = null;
            }
            const logsDirectory = path_1.default.join(electron_1.app.getPath('userData'), 'logs');
            const mainLogFile = path_1.default.join(logsDirectory, 'helix.log');
            if (fs_1.default.existsSync(mainLogFile)) {
                fs_1.default.writeFileSync(mainLogFile, '', 'utf-8');
            }
        }
        catch {
            // Ignore clear errors
        }
        appendSystemLog('[Main]', 'Logs cleared by admin.');
        return { success: true };
    });
    electron_1.ipcMain.handle('helix:get-browser-extension-info', () => {
        if (browserExtensionBridge)
            return browserExtensionBridge.getInfo();
        return {
            token: '',
            port: 47831,
            extensionPath: '',
            listening: false,
            lastPage: null,
            error: 'Browser companion is not initialized.',
        };
    });
    electron_1.ipcMain.handle('helix:open-browser-extension-folder', async () => {
        if (!browserExtensionBridge)
            throw new Error('Browser companion is not initialized.');
        const error = await electron_1.shell.openPath(browserExtensionBridge.getInfo().extensionPath);
        if (error)
            throw new Error(`Could not open the browser extension folder: ${error}`);
    });
    electron_1.ipcMain.handle('helix:copy-text-to-clipboard', (_event, text) => {
        if (typeof text !== 'string')
            throw new TypeError('Clipboard text must be a string.');
        electron_1.clipboard.writeText(text);
    });
    clipboardHistory = new clipboard_history_1.ClipboardHistory((items) => sendToDesktopWindows('helix:clipboard-history-changed', items), (enabled) => sendToDesktopWindows('helix:clipboard-monitoring-changed', enabled));
    clipboardHistory.start();
    electron_1.ipcMain.handle('helix:get-clipboard-history', () => clipboardHistory?.getHistory() ?? []);
    electron_1.ipcMain.handle('helix:get-clipboard-monitoring', () => clipboardHistory?.isMonitoring() ?? false);
    electron_1.ipcMain.handle('helix:set-clipboard-monitoring', (_event, enabled) => {
        if (typeof enabled !== 'boolean')
            throw new TypeError('Clipboard monitoring state must be a boolean.');
        clipboardHistory?.setMonitoring(enabled);
    });
    electron_1.ipcMain.handle('helix:clear-clipboard-history', () => clipboardHistory?.clear());
    electron_1.ipcMain.handle('helix:restore-clipboard-item', (_event, id) => {
        if (typeof id !== 'string')
            throw new TypeError('Clipboard history item ID must be a string.');
        clipboardHistory?.restore(id);
    });
}
function sendToDesktopWindows(channel, payload) {
    for (const window of [floatingWindow, toolboxWindow]) {
        if (window && !window.isDestroyed())
            window.webContents.send(channel, payload);
    }
}
async function checkForUpdates() {
    if (!electron_1.app.isPackaged || updaterCheckInProgress)
        return;
    updaterCheckInProgress = true;
    try {
        await electron_updater_1.autoUpdater.checkForUpdates();
    }
    finally {
        updaterCheckInProgress = false;
    }
}
async function getRemoteUpdatePolicy() {
    const response = await fetch(UPDATE_POLICY_URL, {
        signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
        throw new Error(`Update policy service returned HTTP ${response.status}.`);
    }
    const policy = await response.json();
    if (policy === null
        || typeof policy !== 'object'
        || !('autoUpdate' in policy)
        || typeof policy.autoUpdate !== 'boolean'
        || !('checkIntervalHours' in policy)
        || typeof policy.checkIntervalHours !== 'number'
        || !Number.isInteger(policy.checkIntervalHours)
        || policy.checkIntervalHours < 1
        || policy.checkIntervalHours > 720) {
        throw new Error('Update policy service returned invalid settings.');
    }
    return {
        autoUpdate: policy.autoUpdate,
        checkIntervalHours: policy.checkIntervalHours,
    };
}
function setupAutoUpdater() {
    if (!electron_1.app.isPackaged || process.platform !== 'win32')
        return;
    electron_updater_1.autoUpdater.autoDownload = false;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = false;
    const adminConfig = readAdminConfig();
    electron_updater_1.autoUpdater.on('checking-for-update', () => {
        sendToDesktopWindows('helix:updater-status', { status: 'checking', currentVersion: electron_1.app.getVersion() });
    });
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        sendToDesktopWindows('helix:updater-status', {
            status: 'available',
            currentVersion: electron_1.app.getVersion(),
            version: info.version,
        });
    });
    electron_updater_1.autoUpdater.on('update-not-available', (info) => {
        sendToDesktopWindows('helix:updater-status', {
            status: 'current',
            currentVersion: electron_1.app.getVersion(),
            version: info.version,
        });
    });
    electron_updater_1.autoUpdater.on('download-progress', (progress) => {
        sendToDesktopWindows('helix:updater-status', {
            status: 'downloading',
            percent: progress.percent,
            transferred: progress.transferred,
            total: progress.total,
        });
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        updateDownloaded = true;
        sendToDesktopWindows('helix:updater-status', {
            status: 'downloaded',
            currentVersion: electron_1.app.getVersion(),
            version: info.version,
        });
    });
    electron_updater_1.autoUpdater.on('error', (error) => {
        console.error('[Updater] Update operation failed:', error);
        sendToDesktopWindows('helix:updater-status', {
            status: 'error',
            message: error.message || 'Could not check for updates.',
        });
    });
    let lastAutomaticCheck = 0;
    const scheduleCheck = async () => {
        const localConfig = readAdminConfig();
        let remotePolicy = null;
        try {
            remotePolicy = await getRemoteUpdatePolicy();
        }
        catch (error) {
            console.warn('[Updater] Could not load shared update policy; using local policy:', error);
        }
        const autoUpdate = remotePolicy?.autoUpdate ?? localConfig.autoUpdate;
        if (!autoUpdate)
            return;
        const checkIntervalHours = remotePolicy?.checkIntervalHours ?? localConfig.checkIntervalHours;
        if (Date.now() - lastAutomaticCheck < checkIntervalHours * 60 * 60 * 1000)
            return;
        lastAutomaticCheck = Date.now();
        try {
            await checkForUpdates();
        }
        catch (error) {
            console.error('[Updater] Automatic update check failed:', error);
        }
    };
    setTimeout(() => void scheduleCheck(), 30000);
    setInterval(() => void scheduleCheck(), 15 * 60 * 1000);
}
async function startBrowserExtensionBridge() {
    const extensionPath = electron_1.app.isPackaged
        ? path_1.default.join(process.resourcesPath, 'browser-extension')
        : path_1.default.join(electron_1.app.getAppPath(), 'browser-extension');
    browserExtensionBridge = new browser_extension_bridge_1.BrowserExtensionBridge(path_1.default.join(electron_1.app.getPath('userData'), 'browser-extension-token'), extensionPath, (snapshot) => ipcBridge?.sendBrowserPageUpdate(snapshot) ?? false);
    try {
        await browserExtensionBridge.start();
    }
    catch (error) {
        console.error('[Main] Browser companion could not start:', error);
    }
}
function applyDesktopSettings(settings) {
    if (typeof settings.always_on_top === 'boolean') {
        floatingWindow?.setAlwaysOnTop(settings.always_on_top);
    }
    electron_1.globalShortcut.unregisterAll();
    const summon = settings.global_summon_shortcut;
    if (typeof summon === 'string' && summon.trim()) {
        electron_1.globalShortcut.register(summon, () => {
            if (!floatingWindow || floatingWindow.isDestroyed())
                return;
            if (floatingWindow.isMinimized())
                floatingWindow.restore();
            floatingWindow.show();
            floatingWindow.focus();
        });
    }
    const emergency = settings.emergency_stop_shortcut;
    if (typeof emergency === 'string' && emergency.trim()) {
        electron_1.globalShortcut.register(emergency, () => ipcBridge?.sendEmergencyStop());
    }
}
async function connectWebSocket(retryCount = 0, maxRetries = 15) {
    if (!ipcBridge)
        return;
    try {
        await ipcBridge.connectToPython(`ws://127.0.0.1:${wsPort}`, () => pythonManager.getWebSocketToken());
        console.log('[Main] Connected to Python agent WebSocket');
        const settings = await ipcBridge.loadSettings();
        if (settings.start_minimized === false) {
            floatingWindow?.show();
            floatingWindow?.focus();
        }
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
    if (electron_1.app.isPackaged) {
        electron_1.app.setAsDefaultProtocolClient('helix');
    }
    else {
        electron_1.app.setAsDefaultProtocolClient('helix', process.execPath, [path_1.default.resolve(process.argv[1])]);
    }
    // Set app user model ID for Windows notifications
    if (process.platform === 'win32') {
        electron_1.app.setAppUserModelId('com.helix.agent');
    }
    // Disable default menu
    electron_1.Menu.setApplicationMenu(null);
    setupAutoUpdater();
    electron_1.session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const trusted = (0, media_permissions_1.isTrustedRendererRequest)(webContents.getURL(), details.securityOrigin, RENDERER_URL);
        if (!trusted) {
            callback(false);
            return;
        }
        if (permission === 'media') {
            if (!(0, media_permissions_1.isSupportedMediaRequest)(details.mediaTypes)) {
                callback(false);
                return;
            }
            void (async () => {
                if (process.platform !== 'darwin')
                    return true;
                for (const mediaType of details.mediaTypes ?? []) {
                    const systemMediaType = mediaType === 'audio' ? 'microphone' : 'camera';
                    const status = electron_1.systemPreferences.getMediaAccessStatus(systemMediaType);
                    if (status === 'granted')
                        continue;
                    if (status !== 'not-determined'
                        || !await electron_1.systemPreferences.askForMediaAccess(systemMediaType)) {
                        return false;
                    }
                }
                return true;
            })().then(callback, (error) => {
                console.error('[Main] Could not request system media access:', error);
                callback(false);
            });
            return;
        }
        callback(['notifications', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission));
    });
    electron_1.session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        if (!webContents
            || !(0, media_permissions_1.isTrustedRendererRequest)(webContents.getURL(), details.securityOrigin || requestingOrigin, RENDERER_URL)) {
            return false;
        }
        if (permission === 'media') {
            return (0, media_permissions_1.isSupportedMediaType)(details.mediaType)
                && (process.platform !== 'darwin'
                    || electron_1.systemPreferences.getMediaAccessStatus(details.mediaType === 'audio' ? 'microphone' : 'camera') === 'granted');
        }
        return ['notifications', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission);
    });
    const capabilityConfig = (0, capability_config_1.readCapabilityConfig)(electron_1.app.isPackaged, process.resourcesPath);
    capabilityManager = new capability_manager_1.CapabilityManager(electron_1.app.getPath('userData'), electron_1.app.getVersion(), {
        publicKey: capabilityConfig.publicKey,
        manifestUrl: capabilityConfig.catalogUrl,
        progressiveEnabled: true,
        onProgress: (progress) => sendToDesktopWindows('helix:capability-download-progress', progress),
    });
    await capabilityManager.load();
    try {
        await capabilityManager.refreshCatalog();
    }
    catch (error) {
        console.error('[Capabilities] Could not refresh the signed capability catalog:', error);
    }
    // Create windows
    exports.floatingWindow = floatingWindow = createFloatingWindow();
    exports.toolboxWindow = toolboxWindow = createToolboxWindow();
    confirmationWindow = createConfirmationWindow();
    const startupOAuthUrl = findOAuthCallbackArgument(process.argv);
    if (startupOAuthUrl)
        handleOAuthCallbackUrl(startupOAuthUrl);
    setupIPC();
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
    await startBrowserExtensionBridge();
    // Connect WebSocket only after the Python agent reports readiness.
    connectWebSocket();
    // The persisted startup preference controls whether the overlay is shown;
    // the tray remains available even when HELIX starts minimized.
    trayManager.updateStatus('idle');
}).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Main] HELIX failed to start:', error);
    electron_1.dialog.showErrorBox('HELIX could not start its agent', `${message}\n\nCheck services/agent/requirements.txt and the Python environment, then start HELIX again.`);
    electron_1.app.quit();
});
electron_1.app.on('before-quit', (event) => {
    if (shutdownComplete)
        return;
    event.preventDefault();
    if (isQuitting)
        return;
    isQuitting = true;
    console.log('[Main] Quitting HELIX...');
    void (async () => {
        floatingWindow?.removeAllListeners('close');
        toolboxWindow?.removeAllListeners('close');
        confirmationWindow?.removeAllListeners('close');
        floatingWindow?.destroy();
        toolboxWindow?.destroy();
        confirmationWindow?.destroy();
        trayManager?.destroy();
        ipcBridge?.close();
        clipboardHistory?.stop();
        await browserExtensionBridge?.close();
        await pythonManager?.stop();
        shutdownComplete = true;
        electron_1.app.quit();
    })().catch((error) => {
        console.error('[Main] Failed to shut down HELIX cleanly:', error);
        electron_1.app.exit(1);
    });
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
electron_1.ipcMain.on('helix:quit', () => {
    electron_1.app.quit();
});
// Handle IPC for opening external URLs safely
electron_1.ipcMain.on('helix:open-external', (_event, url) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
        electron_1.shell.openExternal(url);
    }
});
//# sourceMappingURL=main.js.map