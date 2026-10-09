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
  emergencyStop: () => {
    electron.ipcRenderer.send("helix:emergency-stop");
  },
  dismissConfirmationToast: (requestId) => {
    electron.ipcRenderer.send("helix:dismiss-confirmation-toast", requestId);
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
  testTts: (text) => electron.ipcRenderer.invoke("helix:test-tts", text),
  getMemoryStatus: () => electron.ipcRenderer.invoke("helix:get-memory-status"),
  clearMemory: () => electron.ipcRenderer.invoke("helix:clear-memory"),
  getTasks: () => electron.ipcRenderer.invoke("helix:get-tasks"),
  getProviders: () => electron.ipcRenderer.invoke("helix:get-providers"),
  getModels: (requirements) => electron.ipcRenderer.invoke("helix:get-models", requirements),
  // Validate an API key — key goes directly to Python, never logged here
  validateKey: (provider, slot, key) => electron.ipcRenderer.invoke("helix:validate-key", provider, slot, key),
  getSkills: () => electron.ipcRenderer.invoke("helix:get-skills"),
  saveSkill: (skill) => electron.ipcRenderer.invoke("helix:save-skill", skill),
  deleteSkill: (name) => electron.ipcRenderer.invoke("helix:delete-skill", name),
  getMcpServers: () => electron.ipcRenderer.invoke("helix:get-mcp-servers"),
  getBrowserExtensionInfo: () => electron.ipcRenderer.invoke("helix:get-browser-extension-info"),
  openBrowserExtensionFolder: () => electron.ipcRenderer.invoke("helix:open-browser-extension-folder"),
  copyTextToClipboard: (text) => electron.ipcRenderer.invoke("helix:copy-text-to-clipboard", text),
  getClipboardHistory: () => electron.ipcRenderer.invoke("helix:get-clipboard-history"),
  getClipboardMonitoring: () => electron.ipcRenderer.invoke("helix:get-clipboard-monitoring"),
  setClipboardMonitoring: (enabled) => electron.ipcRenderer.invoke("helix:set-clipboard-monitoring", enabled),
  clearClipboardHistory: () => electron.ipcRenderer.invoke("helix:clear-clipboard-history"),
  restoreClipboardItem: (id) => electron.ipcRenderer.invoke("helix:restore-clipboard-item", id),
  checkForUpdates: () => electron.ipcRenderer.invoke("helix:updater-check"),
  downloadUpdate: () => electron.ipcRenderer.invoke("helix:updater-download"),
  installUpdate: () => electron.ipcRenderer.invoke("helix:updater-install"),
  // Event subscriptions (return cleanup function)
  onAgentMessage: (fn) => createEventListener("helix:agent-message", fn),
  onVoiceCaptureStarted: (fn) => createEventListener("helix:voice_capture_started", fn),
  onVoiceCaptureStopped: (fn) => createEventListener("helix:voice_capture_stopped", fn),
  onTaskUpdate: (fn) => createEventListener("helix:task-update", fn),
  onStatusUpdate: (fn) => createEventListener("helix:status-update", fn),
  onFallbackEvent: (fn) => createEventListener("helix:fallback-event", fn),
  onModelRequest: (fn) => createEventListener("helix:model_request", fn),
  onConfirmationRequest: (fn) => createEventListener("helix:confirmation-request", fn),
  onConfirmationResolved: (fn) => createEventListener("helix:confirmation-resolved", fn),
  onError: (fn) => createEventListener("helix:error", fn),
  onProviderUpdate: (fn) => createEventListener("helix:provider-update", fn),
  onHandLandmarks: (fn) => createEventListener("helix:hand-landmarks", fn),
  onSettingsApplied: (fn) => createEventListener("helix:settings-applied", fn),
  onShowTasks: (fn) => createEventListener("helix:show-tasks", fn),
  onClipboardHistoryChanged: (fn) => createEventListener("helix:clipboard-history-changed", fn),
  onClipboardMonitoringChanged: (fn) => createEventListener("helix:clipboard-monitoring-changed", fn),
  onUpdaterStatus: (fn) => createEventListener("helix:updater-status", fn),
  onOAuthCallback: (fn) => createEventListener("helix:oauth-callback", fn),
  getAppVersion: () => electron.ipcRenderer.invoke("helix:app-version"),
  getAdminStatus: () => electron.ipcRenderer.invoke("helix:admin-status"),
  validateAdmin: (accessToken) => electron.ipcRenderer.invoke("helix:admin-validate", accessToken),
  getAdminConfig: (accessToken) => electron.ipcRenderer.invoke("helix:admin-config", accessToken),
  saveAdminConfig: (accessToken, config) => electron.ipcRenderer.invoke("helix:admin-save-config", accessToken, config),
  createVersionBackup: (accessToken, version) => electron.ipcRenderer.invoke("helix:admin-backup", accessToken, version)
});
