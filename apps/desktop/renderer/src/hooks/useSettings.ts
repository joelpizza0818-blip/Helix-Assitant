import { useState, useCallback, useEffect } from 'react'
import type { HelixSettings } from '../types/global'

const DEFAULT_SETTINGS: HelixSettings = {
  voice_enabled: true,
  wake_word: 'hey helix',
  wake_word_provider: 'openwakeword',
  camera_enabled: true,
  camera_device_index: 0,
  gesture_sensitivity: 0.8,
  start_with_windows: true,
  default_model: null,
  preferred_provider: null,
  fallback_enabled: true,
  cross_provider_fallback: false,
  cost_preference: 'balanced',
  speed_preference: 'balanced',
  quality_preference: 'balanced',
  log_level: 'INFO',
  protected_paths: [],
  protected_apps: [],
  agent_ws_port: 8765
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

