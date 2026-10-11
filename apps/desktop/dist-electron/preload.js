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
    sendMessage: (payload) => {
        electron_1.ipcRenderer.send('helix:send-message', payload);
    },
    // Cancel a running background task
    cancelTask: (taskId) => {
        electron_1.ipcRenderer.send('helix:cancel-task', taskId);
    },
    emergencyStop: () => {
        electron_1.ipcRenderer.send('helix:emergency-stop');
    },
    dismissConfirmationToast: (requestId) => {
        electron_1.ipcRenderer.send('helix:dismiss-confirmation-toast', requestId);
    },
    // Confirm a pending action
    confirmAction: (requestId) => {
        electron_1.ipcRenderer.send('helix:confirm-action', requestId);
    },
    // Reject a pending action
    rejectAction: (requestId) => {
        electron_1.ipcRenderer.send('helix:reject-action', requestId);
    },
    quit: () => {
        electron_1.ipcRenderer.send('helix:quit');
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
    testTts: (text) => electron_1.ipcRenderer.invoke('helix:test-tts', text),
    getMemoryStatus: () => electron_1.ipcRenderer.invoke('helix:get-memory-status'),
    clearMemory: () => electron_1.ipcRenderer.invoke('helix:clear-memory'),
    getTasks: () => electron_1.ipcRenderer.invoke('helix:get-tasks'),
    getProviders: () => electron_1.ipcRenderer.invoke('helix:get-providers'),
    getModels: (requirements) => electron_1.ipcRenderer.invoke('helix:get-models', requirements),
    getCapabilities: () => electron_1.ipcRenderer.invoke('helix:get-capabilities'),
    refreshCapabilities: () => electron_1.ipcRenderer.invoke('helix:refresh-capabilities'),
    setInstallationProfile: (profile) => electron_1.ipcRenderer.invoke('helix:set-installation-profile', profile),
    installCapability: (manifest) => electron_1.ipcRenderer.invoke('helix:install-capability', manifest),
    cancelCapability: (id) => electron_1.ipcRenderer.invoke('helix:cancel-capability', id),
    // Validate an API key — key goes directly to Python, never logged here
    validateKey: (provider, slot, key) => electron_1.ipcRenderer.invoke('helix:validate-key', provider, slot, key),
    getSkills: () => electron_1.ipcRenderer.invoke('helix:get-skills'),
    saveSkill: (skill) => electron_1.ipcRenderer.invoke('helix:save-skill', skill),
    deleteSkill: (name) => electron_1.ipcRenderer.invoke('helix:delete-skill', name),
    getMcpServers: () => electron_1.ipcRenderer.invoke('helix:get-mcp-servers'),
    getBrowserExtensionInfo: () => electron_1.ipcRenderer.invoke('helix:get-browser-extension-info'),
    openBrowserExtensionFolder: () => electron_1.ipcRenderer.invoke('helix:open-browser-extension-folder'),
    copyTextToClipboard: (text) => electron_1.ipcRenderer.invoke('helix:copy-text-to-clipboard', text),
    getClipboardHistory: () => electron_1.ipcRenderer.invoke('helix:get-clipboard-history'),
    getClipboardMonitoring: () => electron_1.ipcRenderer.invoke('helix:get-clipboard-monitoring'),
    setClipboardMonitoring: (enabled) => electron_1.ipcRenderer.invoke('helix:set-clipboard-monitoring', enabled),
    clearClipboardHistory: () => electron_1.ipcRenderer.invoke('helix:clear-clipboard-history'),
    restoreClipboardItem: (id) => electron_1.ipcRenderer.invoke('helix:restore-clipboard-item', id),
    checkForUpdates: () => electron_1.ipcRenderer.invoke('helix:updater-check'),
    downloadUpdate: () => electron_1.ipcRenderer.invoke('helix:updater-download'),
    installUpdate: () => electron_1.ipcRenderer.invoke('helix:updater-install'),
    // Event subscriptions (return cleanup function)
    onAgentMessage: (fn) => createEventListener('helix:agent-message', fn),
    onVoiceCaptureStarted: (fn) => createEventListener('helix:voice_capture_started', fn),
    onVoiceCaptureStopped: (fn) => createEventListener('helix:voice_capture_stopped', fn),
    onTaskUpdate: (fn) => createEventListener('helix:task-update', fn),
    onStatusUpdate: (fn) => createEventListener('helix:status-update', fn),
    onFallbackEvent: (fn) => createEventListener('helix:fallback-event', fn),
    onModelRequest: (fn) => createEventListener('helix:model_request', fn),
    onConfirmationRequest: (fn) => createEventListener('helix:confirmation-request', fn),
    onConfirmationResolved: (fn) => createEventListener('helix:confirmation-resolved', fn),
    onError: (fn) => createEventListener('helix:error', fn),
    onProviderUpdate: (fn) => createEventListener('helix:provider-update', fn),
    onHandLandmarks: (fn) => createEventListener('helix:hand-landmarks', fn),
    onSettingsApplied: (fn) => createEventListener('helix:settings-applied', fn),
    onShowTasks: (fn) => createEventListener('helix:show-tasks', fn),
    onClipboardHistoryChanged: (fn) => createEventListener('helix:clipboard-history-changed', fn),
    onClipboardMonitoringChanged: (fn) => createEventListener('helix:clipboard-monitoring-changed', fn),
    onUpdaterStatus: (fn) => createEventListener('helix:updater-status', fn),
    onOAuthCallback: (fn) => createEventListener('helix:oauth-callback', fn),
    getAppVersion: () => electron_1.ipcRenderer.invoke('helix:app-version'),
    getAdminStatus: () => electron_1.ipcRenderer.invoke('helix:admin-status'),
    validateAdmin: (accessToken) => electron_1.ipcRenderer.invoke('helix:admin-validate', accessToken),
    getAdminConfig: (accessToken) => electron_1.ipcRenderer.invoke('helix:admin-config', accessToken),
    saveAdminConfig: (accessToken, config) => electron_1.ipcRenderer.invoke('helix:admin-save-config', accessToken, config),
    createVersionBackup: (accessToken, version) => electron_1.ipcRenderer.invoke('helix:admin-backup', accessToken, version),
});
//# sourceMappingURL=preload.js.map