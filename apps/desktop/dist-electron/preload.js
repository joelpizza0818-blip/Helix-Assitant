"use strict";
const electron = require("electron");
function createEventListener(channel, fn) {
  const listener = (_event, data) => fn(data);
  electron.ipcRenderer.on(channel, listener);
  return () => electron.ipcRenderer.removeListener(channel, listener);
}
electron.contextBridge.exposeInMainWorld("helix", {
  // Send text command to agent
  sendMessage: (payload) => {
    electron.ipcRenderer.send("helix:send-message", payload);
  },
  // Cancel a running background task
  cancelTask: (taskId) => {
    electron.ipcRenderer.send("helix:cancel-task", taskId);
  },
  // Confirm a pending action
  confirmAction: (requestId) => {
    electron.ipcRenderer.send("helix:confirm-action", requestId);
  },
  // Reject a pending action
  rejectAction: (requestId) => {
    electron.ipcRenderer.send("helix:reject-action", requestId);
  },
  quit: () => {
    electron.ipcRenderer.send("helix:quit");
  },
  // Open the Toolbox window
  openToolbox: () => {
    electron.ipcRenderer.send("helix:open-toolbox");
  },
  // Open external URL in default browser
  openExternal: (url) => {
    electron.ipcRenderer.send("helix:open-external", url);
  },
  // Request/response operations
  getSettings: () => electron.ipcRenderer.invoke("helix:get-settings"),
  saveSettings: (settings) => electron.ipcRenderer.invoke("helix:save-settings", settings),
  getTasks: () => electron.ipcRenderer.invoke("helix:get-tasks"),
  getProviders: () => electron.ipcRenderer.invoke("helix:get-providers"),
  getModels: (requirements) => electron.ipcRenderer.invoke("helix:get-models", requirements),
  // Validate an API key — key goes directly to Python, never logged here
  validateKey: (provider, slot, key) => electron.ipcRenderer.invoke("helix:validate-key", provider, slot, key),
  // Event subscriptions (return cleanup function)
  onAgentMessage: (fn) => createEventListener("helix:agent-message", fn),
  onTaskUpdate: (fn) => createEventListener("helix:task-update", fn),
  onStatusUpdate: (fn) => createEventListener("helix:status-update", fn),
  onFallbackEvent: (fn) => createEventListener("helix:fallback-event", fn),
  onModelRequest: (fn) => createEventListener("helix:model_request", fn),
  onConfirmationRequest: (fn) => createEventListener("helix:confirmation-request", fn),
  onConfirmationResolved: (fn) => createEventListener("helix:confirmation-resolved", fn),
  onError: (fn) => createEventListener("helix:error", fn),
  onProviderUpdate: (fn) => createEventListener("helix:provider-update", fn),
  onSettingsApplied: (fn) => createEventListener("helix:settings-applied", fn),
  onShowTasks: (fn) => createEventListener("helix:show-tasks", fn)
});
