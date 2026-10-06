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
    return this.wsPort;
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
        setTimeout(() => this._spawn(), delay);
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
    if (!this.process) return;
    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        var _a;
        (_a = this.process) == null ? void 0 : _a.kill("SIGKILL");
        resolve();
      }, 5e3);
      this.process.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.process.kill("SIGTERM");
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
const MAX_RECONNECT_ATTEMPTS = 10;
class IPCBridge {
  constructor() {
    this.ws = null;
    this.mainWindow = null;
    this.toolboxWindow = null;
    this.pendingRequests = /* @__PURE__ */ new Map();
    this.queuedRequests = /* @__PURE__ */ new Map();
    this.reconnectAttempts = 0;
    this.wsUrl = "";
    this.reconnecting = false;
  }
  setupHandlers(mainWindow, toolboxWindow) {
    this.mainWindow = mainWindow;
    this.toolboxWindow = toolboxWindow;
    electron.ipcMain.on("helix:send-message", (_event, text) => {
      this._sendToPython({ type: "USER_TEXT", payload: { text }, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
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
    electron.ipcMain.handle("helix:save-settings", async (_event, settings) => {
      return this._request({ type: "SAVE_SETTINGS", payload: { settings } });
    });
    electron.ipcMain.handle("helix:validate-key", async (_event, provider, slot, key) => {
      return this._request({ type: "VALIDATE_KEY", payload: { provider, slot, key } });
    });
  }
  async connectToPython(wsUrl) {
    this.wsUrl = wsUrl;
    return this._connect();
  }
  _connect() {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.wsUrl);
        this.ws = ws;
        ws.on("open", () => {
          console.log("[IPCBridge] Connected to Python agent WebSocket");
          this.reconnectAttempts = 0;
          this.reconnecting = false;
          for (const [requestId, message] of this.queuedRequests) {
            if (!this.pendingRequests.has(requestId)) {
              this.queuedRequests.delete(requestId);
              continue;
            }
            ws.send(JSON.stringify(message));
            this.queuedRequests.delete(requestId);
          }
          resolve();
        });
        ws.on("message", (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.request_id && this.pendingRequests.has(message.request_id)) {
              const resolver = this.pendingRequests.get(message.request_id);
              this.pendingRequests.delete(message.request_id);
              resolver(message.payload, message.error);
              return;
            }
            this._forwardToRenderer(message);
          } catch (err) {
            console.error("[IPCBridge] Failed to parse message from Python:", err);
          }
        });
        ws.on("error", (err) => {
          console.error("[IPCBridge] WebSocket error:", err.message);
          if (!this.reconnecting) reject(err);
        });
        ws.on("close", () => {
          console.warn("[IPCBridge] WebSocket connection closed");
          this.ws = null;
          this._scheduleReconnect();
        });
      } catch (err) {
        reject(err);
      }
    });
  }
  _scheduleReconnect() {
    if (this.reconnecting) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error("[IPCBridge] Max reconnect attempts reached.");
      this._sendToAll("helix:error", { message: "Lost connection to HELIX agent. Please restart." });
      return;
    }
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
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.queuedRequests.delete(requestId);
        reject(new Error(`Request timeout: ${message.type}`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, (data, error) => {
        clearTimeout(timeout);
        if (error) reject(new Error(error));
        else resolve(data);
      });
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(messageWithId));
      } else {
        this.queuedRequests.set(requestId, messageWithId);
      }
    });
  }
  _forwardToRenderer(message) {
    var _a;
    const typeMap = {
      "agent_message": "helix:agent-message",
      "task_update": "helix:task-update",
      "status_update": "helix:status-update",
      "fallback_event": "helix:fallback-event",
      "confirmation_request": "helix:confirmation-request",
      "error": "helix:error",
      "provider_update": "helix:provider-update",
      "model_update": "helix:model-update"
    };
    const channel = typeMap[message.type] ?? `helix:${message.type}`;
    if (["helix:agent-message", "helix:confirmation-request"].includes(channel)) {
      (_a = this.mainWindow) == null ? void 0 : _a.webContents.send(channel, message.payload);
    }
    this._sendToAll(channel, message.payload);
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
const RENDERER_URL = isDev ? "http://127.0.0.1:5173" : `file://${path.join(__dirname, "../dist/index.html")}`;
const DEFAULT_WS_PORT = parseInt(process.env.AGENT_WS_PORT || "8765", 10);
let wsPort = DEFAULT_WS_PORT;
exports.floatingWindow = null;
exports.toolboxWindow = null;
let trayManager = null;
let pythonManager = null;
exports.ipcBridge = null;
if (electron.app.isPackaged) {
  const gotLock = electron.app.requestSingleInstanceLock();
  if (!gotLock) {
    electron.app.quit();
    process.exit(0);
  }
  electron.app.on("second-instance", () => {
    if (exports.floatingWindow) {
      if (exports.floatingWindow.isMinimized()) exports.floatingWindow.restore();
      exports.floatingWindow.show();
      exports.floatingWindow.focus();
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
  const candidates = isDev ? [
    // process.cwd() is typically the workspace root (apps/desktop)
    path.resolve(process.cwd(), "../../services/agent"),
    // From dist-electron/ go up to monorepo root
    path.resolve(__dirname, "../../../services/agent"),
    // From apps/desktop/ go up to monorepo root
    path.resolve(__dirname, "../../services/agent"),
    // Absolute fallback
    path.resolve(process.cwd(), "services/agent")
  ] : [path.join(process.resourcesPath, "agent")];
  let agentDir = "";
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "main.py"))) {
      agentDir = candidate;
      break;
    }
  }
  if (!agentDir) {
    console.error("[Main] Python agent main.py not found in any candidate path:");
    candidates.forEach((c) => console.error(`  - ${c}`));
    console.error("[Main] Python agent will NOT start. The app will run without backend.");
    return;
  }
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
  try {
    wsPort = await pythonManager.start(
      agentDir,
      DEFAULT_WS_PORT,
      path.join(electron.app.getPath("userData"), "settings.json")
    );
    console.log("[Main] Python agent started");
  } catch (err) {
    console.error("[Main] Failed to start Python agent:", err);
  }
}
function setupIPC() {
  if (!exports.floatingWindow || !exports.toolboxWindow) return;
  exports.ipcBridge = new IPCBridge();
  exports.ipcBridge.setupHandlers(exports.floatingWindow, exports.toolboxWindow);
}
async function connectWebSocket(retryCount = 0, maxRetries = 15) {
  if (!exports.ipcBridge) return;
  if (retryCount === 0) {
    await new Promise((resolve) => setTimeout(resolve, 3e3));
  }
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
  setupIPC();
  connectWebSocket();
  (_a = exports.floatingWindow) == null ? void 0 : _a.show();
  (_b = exports.floatingWindow) == null ? void 0 : _b.focus();
  trayManager.updateStatus("idle");
});
electron.app.on("before-quit", async () => {
  var _a, _b, _c, _d;
  console.log("[Main] Quitting HELIX...");
  (_a = exports.floatingWindow) == null ? void 0 : _a.removeAllListeners("close");
  (_b = exports.toolboxWindow) == null ? void 0 : _b.removeAllListeners("close");
  (_c = exports.floatingWindow) == null ? void 0 : _c.destroy();
  (_d = exports.toolboxWindow) == null ? void 0 : _d.destroy();
  trayManager == null ? void 0 : trayManager.destroy();
  await (pythonManager == null ? void 0 : pythonManager.stop());
});
electron.app.on("window-all-closed", () => {
});
electron.ipcMain.on("helix:open-toolbox", () => {
  var _a, _b;
  (_a = exports.toolboxWindow) == null ? void 0 : _a.show();
  (_b = exports.toolboxWindow) == null ? void 0 : _b.focus();
});
electron.ipcMain.on("helix:open-external", (_event, url) => {
  if (url.startsWith("https://") || url.startsWith("http://")) {
    electron.shell.openExternal(url);
  }
});
