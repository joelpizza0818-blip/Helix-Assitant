"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Type-safe event listener cleanup
function createEventListener(channel, fn) {
    const listener = (_event, data) => fn(data);
    electron_1.ipcRenderer.on(channel, listener);
    return () => electron_1.ipcRenderer.removeListener(channel, listener);
}
// Expose HELIX API to renderer via contextBridge
// NEVER expose raw ipcRenderer — only specific allowed methods
electron_1.contextBridge.exposeInMainWorld('helix', {
    // Send text command to agent
    sendMessage: (text) => {
        electron_1.ipcRenderer.send('helix:send-message', text);
    },
    // Cancel a running background task
    cancelTask: (taskId) => {
        electron_1.ipcRenderer.send('helix:cancel-task', taskId);
    },
    // Confirm a pending action
    confirmAction: (requestId) => {
        electron_1.ipcRenderer.send('helix:confirm-action', requestId);
    },
    // Reject a pending action
    rejectAction: (requestId) => {
        electron_1.ipcRenderer.send('helix:reject-action', requestId);
    },
    // Open the Toolbox window
    openToolbox: () => {
        electron_1.ipcRenderer.send('helix:open-toolbox');
    },
    // Open external URL in default browser
    openExternal: (url) => {
        electron_1.ipcRenderer.send('helix:open-external', url);
    },
    // Request/response operations
    getSettings: () => electron_1.ipcRenderer.invoke('helix:get-settings'),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke('helix:save-settings', settings),
    getTasks: () => electron_1.ipcRenderer.invoke('helix:get-tasks'),
    getProviders: () => electron_1.ipcRenderer.invoke('helix:get-providers'),
    getModels: (requirements) => electron_1.ipcRenderer.invoke('helix:get-models', requirements),
    // Validate an API key — key goes directly to Python, never logged here
    validateKey: (provider, slot, key) => electron_1.ipcRenderer.invoke('helix:validate-key', provider, slot, key),
    // Event subscriptions (return cleanup function)
    onAgentMessage: (fn) => createEventListener('helix:agent-message', fn),
    onTaskUpdate: (fn) => createEventListener('helix:task-update', fn),
    onStatusUpdate: (fn) => createEventListener('helix:status-update', fn),
    onFallbackEvent: (fn) => createEventListener('helix:fallback-event', fn),
    onConfirmationRequest: (fn) => createEventListener('helix:confirmation-request', fn),
    onError: (fn) => createEventListener('helix:error', fn),
    onProviderUpdate: (fn) => createEventListener('helix:provider-update', fn),
    onShowTasks: (fn) => createEventListener('helix:show-tasks', fn),
});
//# sourceMappingURL=preload.js.map