// @ts-nocheck
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl } from '@tauri-apps/plugin-opener'
import type {
  AdminBackup,
  AdminConfig,
  CapabilityPackManifest,
  CapabilityDownloadProgress,
  HelixAPI,
  HelixSettings,
  InstallationProfile,
  MobileDevice,
  MobilePairingInvitation,
  MobilePairingRequest,
  MobileRelayStatus,
  MobileTextRequest,
} from '../types/global'

type EventHandler = (payload: any) => void

const rendererEvents: Record<string, string> = {
  onAgentMessage: 'helix:agent-message',
  onAgentUpdate: 'helix:agent_update',
  onTaskUpdate: 'helix:task-update',
  onStatusUpdate: 'helix:status-update',
  onFallbackEvent: 'helix:fallback-event',
  onConfirmationRequest: 'helix:confirmation-request',
  onConfirmationResolved: 'helix:confirmation-resolved',
  onError: 'helix:error',
  onProviderUpdate: 'helix:provider-update',
  onModelRequest: 'helix:model_request',
  onSettingsApplied: 'helix:settings-applied',
  onVoiceCaptureStarted: 'helix:voice_capture_started',
  onVoiceCaptureStopped: 'helix:voice_capture_stopped',
  onHandLandmarks: 'helix:hand-landmarks',
  onShowTasks: 'helix:show-tasks',
  onUpdaterStatus: 'helix:updater-status',
  onCapabilityDownloadProgress: 'helix:capability-download-progress',
  onOAuthCallback: 'helix:oauth-callback',
  onMobilePairingRequest: 'helix:mobile-pairing-request',
  onMobileTextRequest: 'helix:mobile-text-request',
  onMobileRelayStatus: 'helix:mobile-relay-status',
}

const adminConfigKey = 'helix-lite-admin-config'

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window
}

function getLocalAdminConfig(version: string): AdminConfig {
  const defaults: AdminConfig = {
    autoUpdate: true,
    checkIntervalHours: 24,
    channel: 'stable',
    publicVersion: version,
    backups: [],
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(adminConfigKey) ?? 'null')
    if (parsed === null || typeof parsed !== 'object') return defaults
    const stored = parsed as Partial<AdminConfig>
    return {
      ...defaults,
      ...stored,
      backups: Array.isArray(stored.backups) ? stored.backups : [],
    }
  } catch {
    return defaults
  }
}

function storeAdminConfig(config: AdminConfig): AdminConfig {
  const safe: AdminConfig = {
    ...config,
    checkIntervalHours: Math.max(1, Math.min(720, Number(config.checkIntervalHours) || 24)),
    backups: config.backups.slice(0, 20),
  }
  localStorage.setItem(adminConfigKey, JSON.stringify(safe))
  return safe
}

export async function installTauriBridge(): Promise<void> {
  if (!isTauriRuntime()) return

  const handlers = new Map<string, Set<EventHandler>>()
  const pendingOAuthCallbacks: string[] = []
  const notifyError = (error: unknown) => {
    handlers.get('onError')?.forEach((handler) => handler({
      message: error instanceof Error ? error.message : String(error),
    }))
  }
  let startup: Promise<void> | null = null
  const ensureStarted = () => {
    if (!startup) {
      startup = invoke<void>('start_agent').catch((error: unknown) => {
        startup = null
        notifyError(error)
        throw error
      })
      void startup.catch(() => {})
    }
    return startup
  }
  const subscribe = (name: string, handler: EventHandler): (() => void) => {
    const listeners = handlers.get(name) ?? new Set<EventHandler>()
    listeners.add(handler)
    handlers.set(name, listeners)
    return () => {
      listeners.delete(handler)
      if (listeners.size === 0) handlers.delete(name)
    }
  }
  const request = async (messageType: string, payload: object = {}, timeoutMs?: number) => {
    await ensureStarted()
    return invoke('agent_request', {
      messageType,
      payload,
      timeoutMs,
    })
  }
  const send = (messageType: string, payload: object = {}) => {
    void ensureStarted()
      .then(() => invoke('agent_send', { messageType, payload }))
      .catch(notifyError)
  }
  await Promise.all([
    ...new Set(Object.values(rendererEvents)),
    'helix:agent-status',
  ].map((eventName) => listen(eventName, (event) => {
    if (eventName === 'helix:agent-status') {
      const status = (event.payload as { status?: string }).status
      if (status === 'error' || status === 'disconnected') {
        notifyError(status === 'error'
          ? 'Python agent could not start'
          : 'Python agent disconnected')
      }
      return
    }
    const name = Object.keys(rendererEvents).find((key) => rendererEvents[key] === eventName)
    if (name) handlers.get(name)?.forEach((handler) => handler(event.payload))
  })))

  const handleOAuthUrls = (urls: string[]) => {
    for (const url of urls) {
      const listeners = handlers.get('onOAuthCallback')
      if (listeners?.size) listeners.forEach((handler) => handler(url))
      else pendingOAuthCallbacks.push(url)
      void invoke('open_toolbox').catch(notifyError)
    }
  }
  await onOpenUrl(handleOAuthUrls)
  handleOAuthUrls(await getCurrent() ?? [])

  const api = {
    sendMessage: (payload: Parameters<HelixAPI['sendMessage']>[0]) =>
      send('USER_TEXT', payload),
    cancelTask: (taskId: string) => send('TASK_CANCEL', { task_id: taskId }),
    emergencyStop: () => send('TASK_CANCEL_ALL'),
    confirmAction: (requestId: string) =>
      send('CONFIRMATION_GRANTED', { request_id: requestId }),
    rejectAction: (requestId: string) =>
      send('CONFIRMATION_REJECTED', { request_id: requestId }),
    getAppVersion: () => invoke<string>('app_version'),
    createMobilePairing: async () => {
      const invitation = await invoke<
        Omit<MobilePairingInvitation, 'expiresAt'> & { expiresAt: number }
      >('create_mobile_pairing')
      return {
        ...invitation,
        expiresAt: new Date(invitation.expiresAt * 1000).toISOString(),
      }
    },
    getMobileRelayUrl: () => Promise.resolve(''),
    setMobileRelayUrl: () => Promise.reject(new Error('La configuración de Relay requiere HELIX Desktop con el agente Electron.')),
    getMobileWorkerUrl: () => invoke<string>('get_mobile_worker_url'),
    setMobileWorkerUrl: (url: string) =>
      invoke<string>('set_mobile_worker_url', { value: url }),
    getMobileRelayStatus: () =>
      invoke<{ configured: boolean; connected: boolean }>('get_mobile_relay_status'),
    getMobileDevices: () => invoke<MobileDevice[]>('get_mobile_devices'),
    revokeMobileDevice: (deviceId: string) =>
      invoke<void>('revoke_mobile_device', { deviceId }),
    getMobilePairings: () => invoke<MobilePairingRequest[]>('get_mobile_pairings'),
    resolveMobilePairing: (requestId: string, approved: boolean) =>
      invoke<void>('resolve_mobile_pairing', { requestId, approved }),
    getMobileTextRequests: () => invoke<MobileTextRequest[]>('get_mobile_text_requests'),
    resolveMobileTextRequest: (requestId: string, approved: boolean) =>
      invoke<void>('resolve_mobile_text_request', { requestId, approved }),
    getSettings: () => request('GET_SETTINGS') as ReturnType<HelixAPI['getSettings']>,
    saveSettings: async (settings: Partial<HelixSettings>) => {
      await request('SAVE_SETTINGS', { settings })
    },
    testTts: (text?: string) => request('TEST_TTS', { text }, 30000) as ReturnType<HelixAPI['testTts']>,
    getMemoryStatus: () => request('GET_MEMORY_STATUS') as ReturnType<HelixAPI['getMemoryStatus']>,
    clearMemory: () => request('CLEAR_MEMORY') as ReturnType<HelixAPI['clearMemory']>,
    getProviders: () => request('GET_PROVIDERS') as ReturnType<HelixAPI['getProviders']>,
    getModels: (requirements?: Parameters<HelixAPI['getModels']>[0]) =>
      request('GET_MODELS', { requirements: requirements ?? {} }) as ReturnType<HelixAPI['getModels']>,
    getTasks: () => request('GET_TASKS') as ReturnType<HelixAPI['getTasks']>,
    getCapabilities: () => invoke('get_capabilities') as ReturnType<HelixAPI['getCapabilities']>,
    refreshCapabilities: () => invoke('get_capabilities') as ReturnType<HelixAPI['refreshCapabilities']>,
    setInstallationProfile: (profile: InstallationProfile) =>
      invoke('set_installation_profile', { profile }) as ReturnType<HelixAPI['setInstallationProfile']>,
    installCapability: (manifest: CapabilityPackManifest) =>
      invoke('install_capability', { packId: manifest.id }) as ReturnType<HelixAPI['installCapability']>,
    cancelCapability: (id: string) => invoke<boolean>('cancel_capability', { packId: id }),
    validateKey: (provider: string, slot: number, key: string) =>
      request('VALIDATE_KEY', { provider, slot, key }) as ReturnType<HelixAPI['validateKey']>,
    getSkills: () => request('GET_SKILLS') as ReturnType<HelixAPI['getSkills']>,
    saveSkill: (skill: Parameters<HelixAPI['saveSkill']>[0]) =>
      request('SAVE_SKILL', { skill }) as ReturnType<HelixAPI['saveSkill']>,
    deleteSkill: async (name: string) => { await request('DELETE_SKILL', { name }) },
    getMcpServers: () => request('GET_MCP_SERVERS') as ReturnType<HelixAPI['getMcpServers']>,
    openToolbox: () => invoke<void>('open_toolbox').catch(notifyError),
    setFloatingWindowMode: () => Promise.resolve(),
    quit: () => invoke<void>('quit_app').catch(notifyError),
    openExternal: (url: string) => {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') throw new Error('Only HTTPS external links can be opened.')
      return openUrl(url)
    },
    copyTextToClipboard: (text: string) => writeText(text),
    onSettingsApplied: (handler: EventHandler) => subscribe('onSettingsApplied', handler),
    onVoiceCaptureStarted: (handler: EventHandler) => subscribe('onVoiceCaptureStarted', handler),
    onVoiceCaptureStopped: (handler: EventHandler) => subscribe('onVoiceCaptureStopped', handler),
    onShowTasks: (handler: EventHandler) => subscribe('onShowTasks', handler),
    onAgentMessage: (handler: EventHandler) => subscribe('onAgentMessage', handler),
    onTaskUpdate: (handler: EventHandler) => subscribe('onTaskUpdate', handler),
    onStatusUpdate: (handler: EventHandler) => subscribe('onStatusUpdate', handler),
    onFallbackEvent: (handler: EventHandler) => subscribe('onFallbackEvent', handler),
    onConfirmationRequest: (handler: EventHandler) => subscribe('onConfirmationRequest', handler),
    onConfirmationResolved: (handler: EventHandler) =>
      subscribe('onConfirmationResolved', handler),
    onError: (handler: EventHandler) => subscribe('onError', handler),
    onModelRequest: (handler: EventHandler) => subscribe('onModelRequest', handler),
    onProviderUpdate: (handler: EventHandler) => subscribe('onProviderUpdate', handler),
    onHandLandmarks: (handler: EventHandler) => subscribe('onHandLandmarks', handler),
    onUpdaterStatus: (handler: EventHandler) => subscribe('onUpdaterStatus', handler),
    onCapabilityDownloadProgress: (handler: (progress: CapabilityDownloadProgress) => void) =>
      subscribe('onCapabilityDownloadProgress', handler),
    onOAuthCallback: (handler: EventHandler) => {
      pendingOAuthCallbacks.splice(0).forEach((url) => handler(url))
      return subscribe('onOAuthCallback', handler)
    },
    onMobilePairingRequest: (handler: EventHandler) =>
      subscribe('onMobilePairingRequest', handler),
    onMobileTextRequest: (handler: EventHandler) =>
      subscribe('onMobileTextRequest', handler),
    onMobileRelayStatus: (handler: EventHandler) =>
      subscribe('onMobileRelayStatus', handler),
    dismissConfirmationToast: () => {},
    getBrowserExtensionInfo: () => Promise.reject(new Error('Browser Companion is not bundled with HELIX Lite.')),
    openBrowserExtensionFolder: () => Promise.reject(new Error('Browser Companion is not bundled with HELIX Lite.')),
    getClipboardHistory: () => Promise.reject(new Error('Clipboard history is not available in HELIX Lite.')),
    getClipboardMonitoring: () => Promise.reject(new Error('Clipboard monitoring is not available in HELIX Lite.')),
    setClipboardMonitoring: () => Promise.reject(new Error('Clipboard monitoring is not available in HELIX Lite.')),
    clearClipboardHistory: () => Promise.reject(new Error('Clipboard history is not available in HELIX Lite.')),
    restoreClipboardItem: () => Promise.reject(new Error('Clipboard history is not available in HELIX Lite.')),
    onClipboardHistoryChanged: () => () => {},
    onClipboardMonitoringChanged: () => () => {},
    checkForUpdates: () => invoke<{ status: string; version: string }>('check_for_updates'),
    downloadUpdate: () => invoke<void>('download_update'),
    installUpdate: () => invoke<void>('install_update'),
    getAdminStatus: async () => ({ configured: true, authenticated: false }),
    validateAdmin: async (accessToken: string) => {
      const response = await invoke<{ success?: boolean; authenticated?: boolean }>('admin_request', {
        method: 'GET',
        path: '/authorization',
        accessToken,
      })
      return { authenticated: response.success === true && response.authenticated === true }
    },
    getAdminConfig: async (accessToken: string) => {
      const local = getLocalAdminConfig(await invoke<string>('app_version'))
      try {
        const response = await invoke<{ success?: boolean; authenticated?: boolean }>('admin_request', {
          method: 'GET',
          path: '/authorization',
          accessToken,
        })
        if (response.success !== true || response.authenticated !== true) {
          return { ...local, synced: false, syncError: 'Admin authentication is required.' }
        }
        return {
          ...local,
          synced: false,
          syncError: 'Lite-specific release policy is not provisioned; Electron policy was not read.',
        }
      } catch (error) {
        return {
          ...local,
          synced: false,
          syncError: error instanceof Error ? error.message : 'Could not load admin policy.',
        }
      }
    },
    saveAdminConfig: async (accessToken: string, config: AdminConfig) => {
      const version = await invoke<string>('app_version')
      const auth = await invoke<{ success?: boolean; authenticated?: boolean }>('admin_request', {
        method: 'GET',
        path: '/authorization',
        accessToken,
      })
      if (auth.success !== true || auth.authenticated !== true) {
        throw new Error('Admin authentication is required.')
      }
      const local = storeAdminConfig({
        ...config,
        publicVersion: config.publicVersion || version,
        synced: false,
        syncError: 'Saved locally only; Lite-specific release policy is not provisioned.',
      })
      return local
    },
    createVersionBackup: async (accessToken: string, version: string) => {
      if (!/^\d+(?:\.\d+){1,3}$/.test(version)) throw new Error('Invalid version.')
      const auth = await invoke<{ success?: boolean; authenticated?: boolean }>('admin_request', {
        method: 'GET',
        path: '/authorization',
        accessToken,
      })
      if (auth.success !== true || auth.authenticated !== true) {
        throw new Error('Admin authentication is required.')
      }
      const currentVersion = await invoke<string>('app_version')
      const backup: AdminBackup = { version, createdAt: new Date().toISOString(), currentVersion }
      const local = getLocalAdminConfig(currentVersion)
      storeAdminConfig({
        ...local,
        backups: [backup, ...local.backups.filter((item) => item.version !== version)],
      })
      return {
        ...backup,
        synced: false,
        syncError: 'Saved locally only; Lite release backups are not provisioned.',
      }
    },
    getAdminLogs: async (accessToken: string) => {
      const auth = await invoke<{ success?: boolean; authenticated?: boolean }>('admin_request', {
        method: 'GET',
        path: '/authorization',
        accessToken,
      })
      if (auth.success !== true || auth.authenticated !== true) {
        throw new Error('Admin authentication is required.')
      }
      return {
        success: true,
        logs: ['[Lite] Registros de Lite gestionados a través de la consola nativa del sistema.'],
        logPath: 'HELIX Lite',
        totalCount: 1,
      }
    },
    clearAdminLogs: async (accessToken: string) => {
      const auth = await invoke<{ success?: boolean; authenticated?: boolean }>('admin_request', {
        method: 'GET',
        path: '/authorization',
        accessToken,
      })
      if (auth.success !== true || auth.authenticated !== true) {
        throw new Error('Admin authentication is required.')
      }
      return { success: true }
    },
  }

  window.helix = api as unknown as HelixAPI
  void ensureStarted()
}
