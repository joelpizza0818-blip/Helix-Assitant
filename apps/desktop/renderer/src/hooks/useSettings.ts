import { useState, useCallback, useEffect } from 'react'
import type { HelixSettings } from '../types/global'

const DEFAULT_SETTINGS: HelixSettings = {
  voice_enabled: true,
  wake_word: 'hey helix',
  wake_word_provider: 'openwakeword',
  wake_word_threshold: 0.5,
  voice_tts_provider: 'edge_tts',
  voice_tts_voice: 'en-US-AndrewMultilingualNeural',
  vad_threshold: 250,
  mcp_servers: [],
  camera_enabled: true,
  camera_device_index: 0,
  gesture_sensitivity: 0.8,
  start_with_windows: true,
  start_minimized: true,
  display_index: 0,
  screen_capture_interval_ms: 1000,
  ocr_engine: 'local',
  mouse_move_duration_ms: 200,
  keystroke_delay_ms: 30,
  pyautogui_fail_safe: true,
  shell_type: 'powershell',
  shell_timeout_seconds: 60,
  block_elevated_execution: true,
  browser_engine: 'chromium',
  browser_headless: true,
  search_provider: 'google',
  research_depth: 2,
  block_downloads: true,
  block_untrusted_domains: true,
  always_on_top: true,
  global_summon_shortcut: 'Alt+Space',
  emergency_stop_shortcut: 'Control+Shift+Escape',
  default_model: null,
  preferred_provider: null,
  fallback_enabled: true,
  cross_provider_fallback: false,
  auto_approve_up_to: 'LOW_RISK',
  permissions_mode: 'SMART_APPROVAL',
  cost_preference: 'balanced',
  speed_preference: 'balanced',
  quality_preference: 'balanced',
  log_level: 'INFO',
  protected_paths: [],
  protected_apps: [],
  agent_ws_port: 8765,
  hand_commands: [],
  application_memory: {},
  memory_context_limit: 20,
  memory_auto_compaction: true,
  embedding_model: 'text-embedding-3-small',
  memory_similarity_threshold: 0.75,
}

interface UseSettingsReturn {
  settings: HelixSettings
  isLoading: boolean
  isSaving: boolean
  isApplied: boolean
  error: string | null
  loadSettings: () => Promise<void>
  saveSettings: (partial: Partial<HelixSettings>) => Promise<void>
  updateLocal: (partial: Partial<HelixSettings>) => void
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<HelixSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isApplied, setIsApplied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.helix?.onSettingsApplied) return
    const cleanup = window.helix.onSettingsApplied((newSettings) => {
      setSettings(newSettings)
      setIsApplied(true)
      setTimeout(() => setIsApplied(false), 2000)
    })
    return cleanup
  }, [])

  const loadSettings = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.helix?.getSettings()
      if (result) {
        setSettings({ ...DEFAULT_SETTINGS, ...(result as Partial<HelixSettings>) })
      }
    } catch (err) {
      setError('Failed to load settings')
      console.error('loadSettings error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const saveSettings = useCallback(async (partial: Partial<HelixSettings>) => {
    setIsSaving(true)
    setError(null)
    const merged = { ...settings, ...partial }
    setSettings(merged) // optimistic update
    try {
      await window.helix?.saveSettings(merged)
    } catch (err) {
      setError('Failed to save settings')
      setSettings(settings) // revert on error
      console.error('saveSettings error:', err)
    } finally {
      setIsSaving(false)
    }
  }, [settings])

  const updateLocal = useCallback((partial: Partial<HelixSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }, [])

  return { settings, isLoading, isSaving, isApplied, error, loadSettings, saveSettings, updateLocal }
}
