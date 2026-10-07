"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const child_process = require("child_process");
const net = require("net");
const WebSocket = require("ws");
const RESTART_DELAYS_MS = [1e3, 2e3, 5e3, 1e4, 3e4];
class PythonManager {
  constructor() {
    this.process = null;
    this.agentDir = "";
    this.wsPort = 8765;
    this.settingsPath = "";
    this.restartCount = 0;
    this.maxRestarts = 5;
    this.stopping = false;
    this.restartTimer = null;
    this.stdoutHandlers = [];
    this.stderrHandlers = [];
    this.exitHandlers = [];
  }
  async start(agentDir, wsPort2, settingsPath) {
    this.agentDir = agentDir;
    this.wsPort = await this.findAvailablePort(wsPort2);
    this.settingsPath = settingsPath;
    if (this.wsPort !== wsPort2) {
      console.warn(`[PythonManager] Port ${wsPort2} is already in use; using ${this.wsPort} instead`);
    }
    this.stopping = false;
    this.restartCount = 0;
    await this._spawn();
    try {
      await this._waitForReady();
    } catch (error) {
      await this.stop();
      throw error;
    }
    return this.wsPort;
  }
  async _waitForReady(timeoutMs = 9e4) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const child = this.process;
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        throw new Error("Python agent exited before its WebSocket became ready");
      }
      const ready = await new Promise((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${this.wsPort}`);
        let settled = false;
        let timeout = null;
        const finish = (connected) => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          socket.close();
          resolve(connected);
        };
        timeout = setTimeout(() => finish(false), 1e3);
        socket.once("open", () => finish(true));
        socket.once("error", () => finish(false));
      });
      if (ready) {
        console.log(`[PythonManager] Agent WebSocket ready on port ${this.wsPort}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      `Python agent WebSocket did not become ready on port ${this.wsPort} within ${timeoutMs}ms`
    );
  }
  findAvailablePort(preferredPort) {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", (error) => {
        if (error.code !== "EADDRINUSE") {
          reject(error);
          return;
        }
        const fallbackServer = net.createServer();
        fallbackServer.once("error", reject);
        fallbackServer.listen(0, "127.0.0.1", () => {
          const address = fallbackServer.address();
          if (!address || typeof address === "string") {
            fallbackServer.close();
            reject(new Error("Could not determine an available agent port"));
            return;
          }
          fallbackServer.close((closeError) => {
            if (closeError) reject(closeError);
            else resolve(address.port);
          });
        });
      });
      server.listen(preferredPort, "127.0.0.1", () => {
        server.close((error) => {
          if (error) reject(error);
          else resolve(preferredPort);
        });
      });
    });
  }
  async _spawn() {
    var _a, _b;
    const pythonExe = this._findPython();
    if (!pythonExe) {
      throw new Error("Python executable not found. Install Python 3.11+ and ensure it is in PATH.");
    }
    const mainScript = path.join(this.agentDir, "main.py");
    if (!fs.existsSync(mainScript)) {
      throw new Error(`Python agent main.py not found at: ${mainScript}`);
    }
    console.log(`[PythonManager] Spawning: ${pythonExe} main.py --ws-port ${this.wsPort}`);
    console.log(`[PythonManager] Working dir: ${this.agentDir}`);
    this.process = child_process.spawn(pythonExe, ["main.py", "--ws-port", String(this.wsPort)], {
      cwd: this.agentDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        PYTHONPATH: [
          path.resolve(this.agentDir, "../.."),
          process.env.PYTHONPATH
        ].filter(Boolean).join(path.delimiter),
        HELIX_SETTINGS_PATH: this.settingsPath
      }
    });
    let stdoutBuffer = "";
    (_a = this.process.stdout) == null ? void 0 : _a.on("data", (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      lines.forEach((line) => {
        if (line.trim()) {
          this.stdoutHandlers.forEach((h) => h(line));
        }
      });
    });
    let stderrBuffer = "";
    (_b = this.process.stderr) == null ? void 0 : _b.on("data", (data) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";
      lines.forEach((line) => {
        if (line.trim()) {
          this.stderrHandlers.forEach((h) => h(line));
        }
      });
    });
    this.process.on("exit", (code) => {
      this.exitHandlers.forEach((h) => h(code));
      this.process = null;
      if (!this.stopping && this.restartCount < this.maxRestarts) {
        const delay = RESTART_DELAYS_MS[Math.min(this.restartCount, RESTART_DELAYS_MS.length - 1)];
        console.warn(`[PythonManager] Process exited (code ${code}). Restarting in ${delay}ms... (attempt ${this.restartCount + 1}/${this.maxRestarts})`);
        this.restartCount++;
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (!this.stopping) void this._spawn();
        }, delay);
      } else if (!this.stopping) {
        console.error("[PythonManager] Max restarts reached. Agent is permanently down.");
      }
    });
    this.process.on("error", (err) => {
      console.error("[PythonManager] Spawn error:", err.message);
    });
  }
  async stop() {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const agentProcess = this.process;
    if (!agentProcess) return;
    if (process.platform === "win32" && agentProcess.pid) {
      await new Promise((resolve, reject) => {
        child_process.execFile(
          "taskkill",
          ["/PID", String(agentProcess.pid), "/T", "/F"],
          { windowsHide: true },
          (error) => {
            if (error && agentProcess.exitCode === null && agentProcess.signalCode === null) {
              reject(new Error(`Could not stop Python agent process tree: ${error.message}`));
              return;
            }
            resolve();
          }
        );
      });
      if (!await this.waitForExit(agentProcess, 5e3)) {
        throw new Error("Python agent process did not exit after process-tree shutdown");
      }
      return;
    }
    agentProcess.kill("SIGTERM");
    if (await this.waitForExit(agentProcess, 5e3)) return;
    agentProcess.kill("SIGKILL");
    if (!await this.waitForExit(agentProcess, 5e3)) {
      throw new Error("Python agent process did not exit after forced shutdown");
    }
  }
  waitForExit(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.removeListener("exit", onExit);
        resolve(false);
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timeout);
        resolve(true);
      };
      child.once("exit", onExit);
    });
  }
  async restart() {
    await this.stop();
    this.stopping = false;
    this.restartCount = 0;
    await this._spawn();
  }
  isRunning() {
    return this.process !== null && !this.process.killed;
  }
  onStdout(fn) {
    this.stdoutHandlers.push(fn);
  }
  onStderr(fn) {
    this.stderrHandlers.push(fn);
  }
  onExit(fn) {
    this.exitHandlers.push(fn);
  }
  _findPython() {
    const candidates = [
      // Check .venv inside agent dir first
      path.join(this.agentDir, ".venv", "Scripts", "python.exe"),
      path.join(this.agentDir, ".venv", "bin", "python"),
      // Check workspace-level .venv
      path.join(this.agentDir, "..", "..", ".venv", "Scripts", "python.exe"),
      // System Python
      "python",
      "python3",
      "py"
    ];
    for (const candidate of candidates) {
      if (!candidate.includes("python") && !candidate.includes("py")) continue;
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return "python";
  }
}
const RECONNECT_DELAY_MS = 3e3;
class IPCBridge {
  constructor() {
    this.ws = null;
    this.mainWindow = null;
    this.toolboxWindow = null;
    this.pendingRequests = /* @__PURE__ */ new Map();
    this.queuedRequests = /* @__PURE__ */ new Map();
    this.requestTimeouts = /* @__PURE__ */ new Map();
    this.reconnectAttempts = 0;
    this.wsUrl = "";
    this.reconnecting = false;
  }
  setupHandlers(mainWindow, toolboxWindow) {
    this.mainWindow = mainWindow;
    this.toolboxWindow = toolboxWindow;
    electron.ipcMain.on("helix:send-message", (_event, payload) => {
      this._sendToPython({ type: "USER_TEXT", payload, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    });
    electron.ipcMain.on("helix:cancel-task", (_event, taskId) => {
      this._sendToPython({ type: "TASK_CANCEL", payload: { task_id: taskId }, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    });
    electron.ipcMain.on("helix:confirm-action", (_event, requestId) => {
      this._sendToPython({ type: "CONFIRMATION_GRANTED", payload: { request_id: requestId }, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    });
    electron.ipcMain.on("helix:reject-action", (_event, requestId) => {
      this._sendToPython({ type: "CONFIRMATION_REJECTED", payload: { request_id: requestId }, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    });
    electron.ipcMain.handle("helix:get-tasks", async () => {
      return this._request({ type: "GET_TASKS", payload: {} });
    });
    electron.ipcMain.handle("helix:get-providers", async () => {
      return this._request({ type: "GET_PROVIDERS", payload: {} });
    });
    electron.ipcMain.handle("helix:get-models", async (_event, requirements) => {
      return this._request({ type: "GET_MODELS", payload: { requirements: requirements ?? {} } });
    });
    electron.ipcMain.handle("helix:get-settings", async () => {
      return this._request({ type: "GET_SETTINGS", payload: {} });
    });
    electron.ipcMain.handle("helix:save-settings", async (event, settings) => {
      const result = await this._request({ type: "SAVE_SETTINGS", payload: { settings } });
      event.sender.send("helix:settings-applied", result);
      return result;
    });
    electron.ipcMain.handle("helix:validate-key", async (_event, provider, slot, key) => {
      return this._request({ type: "VALIDATE_KEY", payload: { provider, slot, key } });
    });
  }
  async connectToPython(wsUrl) {
    this.wsUrl = wsUrl;
    return this._connect();
  }
  close() {
    for (const timeout of this.requestTimeouts.values()) clearTimeout(timeout);
    this.requestTimeouts.clear();
    for (const [requestId, resolver] of this.pendingRequests) {
      resolver(void 0, "HELIX is shutting down.");
      this.pendingRequests.delete(requestId);
    }
    this.queuedRequests.clear();
    const ws = this.ws;
    this.ws = null;
    ws == null ? void 0 : ws.removeAllListeners();
    ws == null ? void 0 : ws.close();
  }
  _connect() {
    return new Promise((resolve, reject) => {
      let connected = false;
      let settled = false;
      try {
        const ws = new WebSocket(this.wsUrl);
        this.ws = ws;
        ws.on("open", () => {
          connected = true;
          settled = true;
          console.log("[IPCBridge] Connected to Python agent WebSocket");
          this.reconnectAttempts = 0;
          this.reconnecting = false;
          for (const [requestId, message] of this.queuedRequests) {
            if (!this.pendingRequests.has(requestId)) {
              this.queuedRequests.delete(requestId);
              continue;
            }
            this.queuedRequests.delete(requestId);
            this._sendRequest(ws, message);
          }
          resolve();
        });
        ws.on("message", (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.request_id && this.pendingRequests.has(message.request_id)) {
              const resolver = this.pendingRequests.get(message.request_id);
              const timeout = this.requestTimeouts.get(message.request_id);
              if (timeout) clearTimeout(timeout);
              this.requestTimeouts.delete(message.request_id);
              this.pendingRequests.delete(message.request_id);
              resolver(message.payload, message.error);
              return;
            }
            if (message.type === "window_action") {
              this._handleWindowAction(message.payload);
              return;
            }
            this._forwardToRenderer(message);
          } catch (err) {
            console.error("[IPCBridge] Failed to parse message from Python:", err);
          }
        });
        ws.on("error", (err) => {
          console.error("[IPCBridge] WebSocket error:", err.message);
          if (!connected && !settled) {
            settled = true;
            reject(err);
          }
        });
        ws.on("close", () => {
          console.warn("[IPCBridge] WebSocket connection closed");
          if (this.ws === ws) this.ws = null;
          if (connected) {
            this._scheduleReconnect();
          } else if (!settled) {
            settled = true;
            reject(new Error("Python agent WebSocket closed before connecting"));
          }
        });
      } catch (err) {
        settled = true;
        reject(err);
      }
    });
  }
  _scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectAttempts++;
    console.log(`[IPCBridge] Reconnecting in ${RECONNECT_DELAY_MS}ms (attempt ${this.reconnectAttempts})...`);
    setTimeout(async () => {
      try {
        await this._connect();
      } catch {
        this.reconnecting = false;
        this._scheduleReconnect();
      }
    }, RECONNECT_DELAY_MS);
  }
  _sendToPython(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn("[IPCBridge] Cannot send: WebSocket not connected");
    }
  }
  _request(message, timeoutMs = 1e4) {
    return new Promise((resolve, reject) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const messageWithId = { ...message, request_id: requestId };
      this.pendingRequests.set(requestId, (data, error) => {
        if (error) reject(new Error(error));
        else resolve(data);
      });
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this._sendRequest(this.ws, messageWithId, timeoutMs);
      } else {
        this.queuedRequests.set(requestId, messageWithId);
      }
    });
  }
  _sendRequest(ws, message, timeoutMs = 1e4) {
    const timeout = setTimeout(() => {
      this.requestTimeouts.delete(message.request_id);
      const resolver = this.pendingRequests.get(message.request_id);
      this.pendingRequests.delete(message.request_id);
      this.queuedRequests.delete(message.request_id);
      resolver == null ? void 0 : resolver(void 0, `Request timeout: ${message.type}`);
    }, timeoutMs);
    this.requestTimeouts.set(message.request_id, timeout);
    ws.send(JSON.stringify(message));
  }
  _forwardToRenderer(message) {
    var _a;
    const typeMap = {
      "agent_message": "helix:agent-message",
      "task_update": "helix:task-update",
      "status_update": "helix:status-update",
      "fallback_event": "helix:fallback-event",
      "confirmation_request": "helix:confirmation-request",
      "confirmation_resolved": "helix:confirmation-resolved",
      "error": "helix:error",
      "provider_update": "helix:provider-update",
      "model_update": "helix:model-update"
    };
    const channel = typeMap[message.type] ?? `helix:${message.type}`;
    if (["helix:agent-message", "helix:confirmation-request"].includes(channel)) {
      (_a = this.mainWindow) == null ? void 0 : _a.webContents.send(channel, message.payload);
      if (this.toolboxWindow && !this.toolboxWindow.isDestroyed()) {
        this.toolboxWindow.webContents.send(channel, message.payload);
      }
      return;
    }
    this._sendToAll(channel, message.payload);
  }
  _handleWindowAction(payload) {
    const floatingWindow = this.mainWindow;
    const toolboxWindow = this.toolboxWindow;
    const floatingVisible = floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible();
    const toolboxVisible = toolboxWindow && !toolboxWindow.isDestroyed() && toolboxWindow.isVisible();
    if (payload.action === "HIDE_FLOATING_OR_TOOLBOX") {
      const windowToHide = floatingVisible ? floatingWindow : toolboxVisible ? toolboxWindow : null;
      windowToHide == null ? void 0 : windowToHide.hide();
      return;
    }
    if (payload.action === "SHOW_FLOATING_OR_TOOLBOX") {
      const windowToShow = floatingVisible ? toolboxWindow : floatingWindow;
      if (!windowToShow || windowToShow.isDestroyed()) return;
      if (windowToShow.isMinimized()) windowToShow.restore();
      windowToShow.show();
      windowToShow.focus();
    }
  }
  _sendToAll(channel, data) {
    var _a;
    (_a = this.mainWindow) == null ? void 0 : _a.webContents.send(channel, data);
    if (this.toolboxWindow && !this.toolboxWindow.isDestroyed()) {
      this.toolboxWindow.webContents.send(channel, data);
    }
  }
}
class TrayManager {
  constructor() {
    this.tray = null;
    this.onLeftClickHandler = null;
  }
  create(iconPath) {
    let icon;
    if (fs.existsSync(iconPath)) {
      icon = electron.nativeImage.createFromPath(iconPath);
      icon = icon.resize({ width: 16, height: 16 });
    } else {
      icon = electron.nativeImage.createEmpty();
    }
    this.tray = new electron.Tray(icon);
    this.tray.setToolTip("HELIX — AI Computer Agent");
    this.tray.on("click", () => {
      var _a;
      (_a = this.onLeftClickHandler) == null ? void 0 : _a.call(this);
    });
  }
  destroy() {
    var _a;
    (_a = this.tray) == null ? void 0 : _a.destroy();
    this.tray = null;
  }
  updateStatus(status) {
    var _a;
    const tooltips = {
      idle: "HELIX — Ready",
      busy: "HELIX — Working...",
      error: "HELIX — Error (click to open)",
      listening: "HELIX — Listening...",
      executing: "HELIX — Executing task..."
    };
    (_a = this.tray) == null ? void 0 : _a.setToolTip(tooltips[status] ?? "HELIX");
  }
  setOnLeftClick(fn) {
    this.onLeftClickHandler = fn;
  }
  setContextMenu(menu) {
    var _a;
    (_a = this.tray) == null ? void 0 : _a.setContextMenu(menu);
  }
  setTooltip(text) {
    var _a;
    (_a = this.tray) == null ? void 0 : _a.setToolTip(text);
  }
}
const isDev = process.env.NODE_ENV === "development" || !electron.app.isPackaged;
const rendererPort = Number(process.env.HELIX_RENDERER_PORT || 5173);
const RENDERER_URL = isDev ? `http://127.0.0.1:${rendererPort}` : `file://${path.join(__dirname, "../dist/index.html")}`;
const DEFAULT_WS_PORT = parseInt(process.env.AGENT_WS_PORT || "8765", 10);
let wsPort = DEFAULT_WS_PORT;
if (isDev) {
  const checkoutName = path.basename(path.resolve(electron.app.getAppPath(), "..", ".."));
  electron.app.setPath(
    "userData",
    path.join(electron.app.getPath("appData"), `@helix-desktop-dev-${checkoutName}`)
  );
}
exports.floatingWindow = null;
exports.toolboxWindow = null;
let trayManager = null;
let pythonManager = null;
exports.ipcBridge = null;
let isQuitting = false;
let shutdownComplete = false;
const gotLock = electron.app.requestSingleInstanceLock();
if (!gotLock) {
  electron.app.quit();
  process.exit(0);
}
electron.app.on("second-instance", () => {
  var _a;
  const window = ((_a = exports.toolboxWindow) == null ? void 0 : _a.isVisible()) ? exports.toolboxWindow : exports.floatingWindow;
  if (!window) return;
  if (window.isMinimized()) window.restore();
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
    } else {
      console.error(`[Main] Failed to load ${url} after all retries`);
    }
  });
}
function createFloatingWindow() {
  const { width, height } = electron.screen.getPrimaryDisplay().workAreaSize;
  const win = new electron.BrowserWindow({
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
    backgroundColor: "#101010",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  loadWithRetry(win, `${RENDERER_URL}#floating`);
  win.on("close", (e) => {
    e.preventDefault();
    win.hide();
  });
  return win;
}
function createToolboxWindow() {
  const win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    titleBarStyle: "default",
    show: false,
    backgroundColor: "#101010",
    title: "HELIX Toolbox",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  loadWithRetry(win, `${RENDERER_URL}#toolbox`);
  win.setMenuBarVisibility(false);
  win.on("close", (e) => {
    e.preventDefault();
    win.hide();
  });
  return win;
}
async function startPythonAgent() {
  const agentDir = isDev ? path.resolve(electron.app.getAppPath(), "..", "..", "services", "agent") : path.join(process.resourcesPath, "agent");
  if (!fs.existsSync(path.join(agentDir, "main.py"))) {
    throw new Error(`Python agent main.py not found at expected path: ${agentDir}`);
  }
  console.log(`[Main] Desktop app root: ${electron.app.getAppPath()}`);
  console.log(`[Main] Found Python agent at: ${agentDir}`);
  pythonManager = new PythonManager();
  pythonManager.onStdout((line) => {
    console.log(`[Python] ${line}`);
  });
  pythonManager.onStderr((line) => {
    console.error(`[Python:err] ${line}`);
  });
  pythonManager.onExit((code) => {
    console.warn(`[Python] Process exited with code: ${code}`);
    trayManager == null ? void 0 : trayManager.updateStatus("error");
  });
  wsPort = await pythonManager.start(
    agentDir,
    DEFAULT_WS_PORT,
    path.join(electron.app.getPath("userData"), "settings.json")
  );
  console.log("[Main] Python agent started");
}
function setupIPC() {
  if (!exports.floatingWindow || !exports.toolboxWindow) return;
  exports.ipcBridge = new IPCBridge();
  exports.ipcBridge.setupHandlers(exports.floatingWindow, exports.toolboxWindow);
}
async function connectWebSocket(retryCount = 0, maxRetries = 15) {
  if (!exports.ipcBridge) return;
  try {
    await exports.ipcBridge.connectToPython(`ws://127.0.0.1:${wsPort}`);
    console.log("[Main] Connected to Python agent WebSocket");
    trayManager == null ? void 0 : trayManager.updateStatus("idle");
  } catch (err) {
    console.error(`[Main] Could not connect to Python WebSocket (attempt ${retryCount + 1}/${maxRetries}):`, err.message);
    trayManager == null ? void 0 : trayManager.updateStatus("error");
    if (retryCount < maxRetries) {
      const delay = Math.min(2e3 + retryCount * 1e3, 1e4);
      setTimeout(() => connectWebSocket(retryCount + 1, maxRetries), delay);
    } else {
      console.error("[Main] Exhausted WebSocket reconnect attempts. Python agent may not be running.");
    }
  }
}
electron.app.whenReady().then(async () => {
  var _a, _b;
  if (process.platform === "win32") {
    electron.app.setAppUserModelId("com.helix.agent");
  }
  electron.Menu.setApplicationMenu(null);
  exports.floatingWindow = createFloatingWindow();
  exports.toolboxWindow = createToolboxWindow();
  setupIPC();
  const iconPath = path.join(__dirname, "../assets/tray-icon.png");
  trayManager = new TrayManager();
  trayManager.create(iconPath);
  trayManager.setOnLeftClick(() => {
    if (!exports.floatingWindow) return;
    if (exports.floatingWindow.isVisible()) {
      exports.floatingWindow.hide();
    } else {
      exports.floatingWindow.show();
      exports.floatingWindow.focus();
    }
  });
  const buildContextMenu = () => {
    return electron.Menu.buildFromTemplate([
      {
        label: "Open HELIX",
        click: () => {
          var _a2, _b2;
          (_a2 = exports.floatingWindow) == null ? void 0 : _a2.show();
          (_b2 = exports.floatingWindow) == null ? void 0 : _b2.focus();
        }
      },
      {
        label: "Toolbox",
        click: () => {
          var _a2, _b2;
          (_a2 = exports.toolboxWindow) == null ? void 0 : _a2.show();
          (_b2 = exports.toolboxWindow) == null ? void 0 : _b2.focus();
        }
      },
      {
        label: "Task Manager",
        click: () => {
          var _a2, _b2;
          (_a2 = exports.floatingWindow) == null ? void 0 : _a2.show();
          (_b2 = exports.floatingWindow) == null ? void 0 : _b2.webContents.send("helix:show-tasks");
        }
      },
      { type: "separator" },
      {
        label: "Settings",
        click: () => {
          var _a2, _b2;
          (_a2 = exports.toolboxWindow) == null ? void 0 : _a2.show();
          (_b2 = exports.toolboxWindow) == null ? void 0 : _b2.focus();
        }
      },
      { type: "separator" },
      {
        label: "Quit HELIX",
        click: () => {
          electron.app.quit();
        }
      }
    ]);
  };
  trayManager.setContextMenu(buildContextMenu());
  await startPythonAgent();
  connectWebSocket();
  (_a = exports.floatingWindow) == null ? void 0 : _a.show();
  (_b = exports.floatingWindow) == null ? void 0 : _b.focus();
  trayManager.updateStatus("idle");
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[Main] HELIX failed to start:", error);
  electron.dialog.showErrorBox(
    "HELIX could not start its agent",
    `${message}

Check services/agent/requirements.txt and the Python environment, then start HELIX again.`
  );
  electron.app.quit();
});
electron.app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (isQuitting) return;
  isQuitting = true;
  console.log("[Main] Quitting HELIX...");
  void (async () => {
    var _a, _b, _c, _d, _e;
    (_a = exports.floatingWindow) == null ? void 0 : _a.removeAllListeners("close");
    (_b = exports.toolboxWindow) == null ? void 0 : _b.removeAllListeners("close");
    (_c = exports.floatingWindow) == null ? void 0 : _c.destroy();
    (_d = exports.toolboxWindow) == null ? void 0 : _d.destroy();
    trayManager == null ? void 0 : trayManager.destroy();
    (_e = exports.ipcBridge) == null ? void 0 : _e.close();
    await (pythonManager == null ? void 0 : pythonManager.stop());
    shutdownComplete = true;
    electron.app.quit();
  })().catch((error) => {
    console.error("[Main] Failed to shut down HELIX cleanly:", error);
    electron.app.exit(1);
  });
});
electron.app.on("window-all-closed", () => {
});
electron.ipcMain.on("helix:open-toolbox", () => {
  var _a, _b;
  (_a = exports.toolboxWindow) == null ? void 0 : _a.show();
  (_b = exports.toolboxWindow) == null ? void 0 : _b.focus();
});
electron.ipcMain.on("helix:quit", () => {
  electron.app.quit();
});
electron.ipcMain.on("helix:open-external", (_event, url) => {
  if (url.startsWith("https://") || url.startsWith("http://")) {
    electron.shell.openExternal(url);
  }
});
