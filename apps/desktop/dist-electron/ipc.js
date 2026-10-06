"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPCBridge = void 0;
const electron_1 = require("electron");
const WebSocket = __importStar(require("ws"));
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;
class IPCBridge {
    constructor() {
        this.ws = null;
        this.mainWindow = null;
        this.toolboxWindow = null;
        this.pendingRequests = new Map();
        this.reconnectAttempts = 0;
        this.wsUrl = '';
        this.reconnecting = false;
    }
    setupHandlers(mainWindow, toolboxWindow) {
        this.mainWindow = mainWindow;
        this.toolboxWindow = toolboxWindow;
        // Renderer -> Python (fire and forget)
        electron_1.ipcMain.on('helix:send-message', (_event, text) => {
            this._sendToPython({ type: 'USER_TEXT', payload: { text }, timestamp: new Date().toISOString() });
        });
        electron_1.ipcMain.on('helix:cancel-task', (_event, taskId) => {
            this._sendToPython({ type: 'TASK_CANCEL', payload: { task_id: taskId }, timestamp: new Date().toISOString() });
        });
        electron_1.ipcMain.on('helix:confirm-action', (_event, requestId) => {
            this._sendToPython({ type: 'CONFIRMATION_GRANTED', payload: { request_id: requestId }, timestamp: new Date().toISOString() });
        });
        electron_1.ipcMain.on('helix:reject-action', (_event, requestId) => {
            this._sendToPython({ type: 'CONFIRMATION_REJECTED', payload: { request_id: requestId }, timestamp: new Date().toISOString() });
        });
        // Renderer -> Python (request/response via invoke)
        electron_1.ipcMain.handle('helix:get-tasks', async () => {
            return this._request({ type: 'GET_TASKS', payload: {} });
        });
        electron_1.ipcMain.handle('helix:get-providers', async () => {
            return this._request({ type: 'GET_PROVIDERS', payload: {} });
        });
        electron_1.ipcMain.handle('helix:get-models', async (_event, requirements) => {
            return this._request({ type: 'GET_MODELS', payload: { requirements: requirements ?? {} } });
        });
        electron_1.ipcMain.handle('helix:get-settings', async () => {
            return this._request({ type: 'GET_SETTINGS', payload: {} });
        });
        electron_1.ipcMain.handle('helix:save-settings', async (_event, settings) => {
            return this._request({ type: 'SAVE_SETTINGS', payload: { settings } });
        });
        electron_1.ipcMain.handle('helix:validate-key', async (_event, provider, slot, key) => {
            // SECURITY: key goes directly to Python for validation, never stored in main process logs
            return this._request({ type: 'VALIDATE_KEY', payload: { provider, slot, key } });
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
                ws.on('open', () => {
                    console.log('[IPCBridge] Connected to Python agent WebSocket');
                    this.reconnectAttempts = 0;
                    this.reconnecting = false;
                    resolve();
                });
                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        // Handle request/response pairing
                        if (message.request_id && this.pendingRequests.has(message.request_id)) {
                            const resolver = this.pendingRequests.get(message.request_id);
                            this.pendingRequests.delete(message.request_id);
                            resolver(message.payload);
                            return;
                        }
                        // Forward event messages to renderer windows
                        this._forwardToRenderer(message);
                    }
                    catch (err) {
                        console.error('[IPCBridge] Failed to parse message from Python:', err);
                    }
                });
                ws.on('error', (err) => {
                    console.error('[IPCBridge] WebSocket error:', err.message);
                    if (!this.reconnecting)
                        reject(err);
                });
                ws.on('close', () => {
                    console.warn('[IPCBridge] WebSocket connection closed');
                    this.ws = null;
                    this._scheduleReconnect();
                });
            }
            catch (err) {
                reject(err);
            }
        });
    }
    _scheduleReconnect() {
        if (this.reconnecting)
            return;
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error('[IPCBridge] Max reconnect attempts reached.');
            this._sendToAll('helix:error', { message: 'Lost connection to HELIX agent. Please restart.' });
            return;
        }
        this.reconnecting = true;
        this.reconnectAttempts++;
        console.log(`[IPCBridge] Reconnecting in ${RECONNECT_DELAY_MS}ms (attempt ${this.reconnectAttempts})...`);
        setTimeout(async () => {
            try {
                await this._connect();
            }
            catch {
                this.reconnecting = false;
                this._scheduleReconnect();
            }
        }, RECONNECT_DELAY_MS);
    }
    _sendToPython(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
        else {
            console.warn('[IPCBridge] Cannot send: WebSocket not connected');
        }
    }
    _request(message, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const messageWithId = { ...message, request_id: requestId };
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`Request timeout: ${message.type}`));
            }, timeoutMs);
            this.pendingRequests.set(requestId, (data) => {
                clearTimeout(timeout);
                resolve(data);
            });
            this._sendToPython(messageWithId);
        });
    }
    _forwardToRenderer(message) {
        const typeMap = {
            'agent_message': 'helix:agent-message',
            'task_update': 'helix:task-update',
            'status_update': 'helix:status-update',
            'fallback_event': 'helix:fallback-event',
            'confirmation_request': 'helix:confirmation-request',
            'error': 'helix:error',
            'provider_update': 'helix:provider-update',
            'model_update': 'helix:model-update'
        };
        const channel = typeMap[message.type] ?? `helix:${message.type}`;
        // confirmation requests and agent messages go to floating window
        if (['helix:agent-message', 'helix:confirmation-request'].includes(channel)) {
            this.mainWindow?.webContents.send(channel, message.payload);
        }
        // Everything else goes to both windows
        this._sendToAll(channel, message.payload);
    }
    _sendToAll(channel, data) {
        this.mainWindow?.webContents.send(channel, data);
        if (this.toolboxWindow && !this.toolboxWindow.isDestroyed()) {
            this.toolboxWindow.webContents.send(channel, data);
        }
    }
}
exports.IPCBridge = IPCBridge;
//# sourceMappingURL=ipc.js.map