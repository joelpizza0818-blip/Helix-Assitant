import React, { useEffect, useState } from 'react'
import type { DesktopAppRecommendation, HelixSettings } from '../../../types/global'
import { getUserFacingError } from '../../../lib/userError'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

export default function ComputerSection({ settings, onSave }: Props) {
  const savedInterval = Math.max(
    settings.continuous_screen_vision_interval_ms ?? 10000,
    10000,
  )
  const [intervalDraft, setIntervalDraft] = useState(String(savedInterval))
  const [desktopApps, setDesktopApps] = useState<DesktopAppRecommendation[] | null>(null)
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([])
  const [appError, setAppError] = useState<string | null>(null)
  const [appNotice, setAppNotice] = useState<string | null>(null)
  const [isDetectingApps, setIsDetectingApps] = useState(false)
  const [isInstallingApps, setIsInstallingApps] = useState(false)

  useEffect(() => {
    setIntervalDraft(String(savedInterval))
  }, [savedInterval])

  const saveInterval = () => {
    const interval = Number(intervalDraft)
    if (Number.isInteger(interval) && interval >= 10000 && interval <= 60000) {
      void onSave({ continuous_screen_vision_interval_ms: interval })
    } else {
      setIntervalDraft(String(savedInterval))
    }
  }

  const detectDesktopApps = async () => {
    setIsDetectingApps(true)
    setAppError(null)
    try {
      const apps = await window.helix.detectDesktopApps()
      setDesktopApps(apps)
      setSelectedAppIds([...new Set(
        apps.flatMap((item) => item.id ? [item.id] : []),
      )])
    } catch (error) {
      setAppError(getUserFacingError(error, 'Could not detect installed Windows apps.'))
    } finally {
      setIsDetectingApps(false)
    }
  }

  const installSelectedApps = async () => {
    if (selectedAppIds.length === 0 || isInstallingApps) return
    setIsInstallingApps(true)
    setAppError(null)
    setAppNotice(null)
    try {
      const result = await window.helix.installDesktopApps(selectedAppIds)
      if (result.installed) setAppNotice('Approved Linux equivalents were installed in the Docker desktop.')
    } catch (error) {
      setAppError(getUserFacingError(error, 'Could not install the selected Linux apps.'))
    } finally {
      setIsInstallingApps(false)
    }
  }

  const handleEnvChange = async (mode: 'auto' | 'isolated' | 'host') => {
    if (mode === 'host') {
      if (settings.computer_use_host_consent !== true) {
        const consentFn = window.helix?.requestHostDesktopConsent
        if (typeof consentFn !== 'function') return
        const result = await consentFn()
        if (!result?.accepted) return
      }
      await onSave({
        computer_use_mode: 'host',
        computer_use_host_consent: true,
      })
    } else if (mode === 'isolated') {
      await onSave({
        computer_use_mode: 'isolated',
        computer_use_host_consent: false,
      })
    } else {
      await onSave({ computer_use_mode: 'auto' })
    }
  }

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Computer Control & Screen Automation</h2>
      <p className="toolbox-section__desc">
        Configure screen analysis, native window management, mouse coordinates, and keyboard automation. Direct input is executed through isolated OS tools with safety constraints.
      </p>

      {/* ── Computer Use Environment Selector ──────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <div>
            <span className="toolbox-card__title">Entorno de Ejecución (Computer Use)</span>
            <p className="toolbox-card__hint">
              Selecciona el entorno en el que Helix interactuará con la pantalla, teclado y mouse:
            </p>
          </div>
        </div>

        <div
          role="radiogroup"
          aria-label="Entorno de Computer Use"
          style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}
        >
          {/* Opción 1: Automático */}
          <label
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              padding: '12px 14px',
              background: (settings.computer_use_mode ?? 'auto') === 'auto' ? 'rgba(238, 96, 24, 0.08)' : 'var(--color-obsidian)',
              borderRadius: 'var(--radius-buttons)',
              border: `1px solid ${(settings.computer_use_mode ?? 'auto') === 'auto' ? 'var(--color-accent)' : 'var(--color-graphite)'}`,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <input
              type="radio"
              name="computer-env-mode"
              checked={(settings.computer_use_mode ?? 'auto') === 'auto'}
              onChange={() => void handleEnvChange('auto')}
              style={{ marginTop: 3 }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="text-sm weight-medium text-bone">Automático (Recomendado)</span>
                <span className="cap-badge" style={{ fontSize: 10 }}>Auto-detección</span>
              </div>
              <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                Prioriza el entorno principal cuando ya diste permiso; sin ese permiso, usa el escritorio Docker aislado si está listo.
              </p>
            </div>
          </label>

          {/* Opción 2: Entorno Principal (Windows) */}
          <label
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              padding: '12px 14px',
              background: settings.computer_use_mode === 'host' ? 'rgba(238, 96, 24, 0.08)' : 'var(--color-obsidian)',
              borderRadius: 'var(--radius-buttons)',
              border: `1px solid ${settings.computer_use_mode === 'host' ? 'var(--color-accent)' : 'var(--color-graphite)'}`,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <input
              type="radio"
              name="computer-env-mode"
              checked={settings.computer_use_mode === 'host'}
              onChange={() => void handleEnvChange('host')}
              style={{ marginTop: 3 }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="text-sm weight-medium text-bone">Entorno Principal (Escritorio Real de Windows)</span>
                <span className="cap-badge" style={{ fontSize: 10, background: 'rgba(238, 96, 24, 0.15)', color: 'var(--color-accent)' }}>Directo</span>
              </div>
              <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                Controla aplicaciones reales con un cursor visual separado. Primero usa accesibilidad sin mover tu puntero; solo recurre al mouse o teclado físicos si una app lo requiere y diste permiso.
              </p>
            </div>
          </label>

          {/* Private Linux desktop runs in the Docker container. */}
          <label
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              padding: '12px 14px',
              background: settings.computer_use_mode === 'isolated' ? 'rgba(238, 96, 24, 0.08)' : 'var(--color-obsidian)',
              borderRadius: 'var(--radius-buttons)',
              border: `1px solid ${settings.computer_use_mode === 'isolated' ? 'var(--color-accent)' : 'var(--color-graphite)'}`,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <input
              type="radio"
              name="computer-env-mode"
              checked={settings.computer_use_mode === 'isolated'}
              onChange={() => void handleEnvChange('isolated')}
              style={{ marginTop: 3 }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="text-sm weight-medium text-bone">Escritorio aislado en Docker (Debian + XFCE)</span>
                <span className="cap-badge" style={{ fontSize: 10 }}>Sandbox</span>
              </div>
              <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                Un escritorio Linux con estado persistente, mostrado en el preview. No comparte archivos ni aplicaciones instaladas de Windows.
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <div>
            <span className="toolbox-card__title">Apps del escritorio aislado</span>
            <p className="toolbox-card__hint">
              Detecta nombres de apps instaladas en Windows y revisa equivalentes Linux. No se copian ejecutables, configuraciones ni datos personales.
            </p>
          </div>
          <button
            type="button"
            className="validate-btn"
            disabled={isDetectingApps}
            onClick={() => void detectDesktopApps()}
          >
            {isDetectingApps ? 'Detectando…' : 'Detectar apps'}
          </button>
        </div>
        {desktopApps && (
          <>
            <ul aria-label="Detected Windows apps" style={{ maxHeight: 220, overflowY: 'auto', paddingLeft: 20 }}>
              {desktopApps.length === 0 && <li className="text-xs text-muted">No installed apps were found.</li>}
              {desktopApps.map((item, index) => (
                <li key={`${item.sourceName}-${index}`} className="text-xs text-muted" style={{ marginBottom: 6 }}>
                  {item.packageName && item.id ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedAppIds.includes(item.id)}
                        onChange={(event) => {
                          setSelectedAppIds((current) => event.target.checked
                            ? [...new Set([...current, item.id])]
                            : current.filter((id) => id !== item.id))
                        }}
                      />
                      {' '}{item.sourceName} → {item.equivalent}
                    </label>
                  ) : (
                    <span>{item.sourceName} — no safe equivalent is mapped.</span>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="validate-btn"
              disabled={selectedAppIds.length === 0 || isInstallingApps}
              onClick={() => void installSelectedApps()}
            >
              {isInstallingApps ? 'Installing…' : `Install approved equivalents (${selectedAppIds.length})`}
            </button>
          </>
        )}
        {appError && <p className="text-xs" role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>{appError}</p>}
        {appNotice && <p className="text-xs" role="status" style={{ color: 'var(--green)', marginTop: 8 }}>{appNotice}</p>}
      </div>

      {/* ── Screen Capture & Display Settings ──────────────────── */}
      <div className="toolbox-card screen-vision-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Screen Context & Vision</span>
        </div>

        <p className="toolbox-section__desc">
          These options are independent and off by default. Screen capture is only available to HELIX while the relevant option is enabled.
        </p>

        <div className="form-row screen-vision-row">
          <label className="form-label">
            On-demand screen capture + accessibility (UI Automation)
            <small className="toolbox-section__desc screen-vision-description">
              Allows screen capture when you explicitly ask HELIX to inspect the screen. It does not let the model decide to capture on other requests; enable the separate model-decision option for that. No continuous capture. The image and accessibility data may be sent to your selected AI provider.
            </small>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.screen_context_enabled ?? false}
              onChange={(e) => void onSave({ screen_context_enabled: e.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row screen-vision-row">
          <label className="form-label">
            Let the model decide when to inspect the screen
            <small className="toolbox-section__desc screen-vision-description">
              Adds an explicit model-controlled option: HELIX may choose to inspect the screen when it would help, or when you ask. This does not start continuous capture. The image and accessibility data may be sent to your selected AI provider.
            </small>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.model_decides_screen_vision_enabled ?? false}
              aria-label="Let the model decide when to inspect the screen"
              onChange={(e) => void onSave({
                model_decides_screen_vision_enabled: e.target.checked,
              })}
            />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row screen-vision-row">
          <label className="form-label">
            Continuous screen video (vision model + action model)
            <small className="toolbox-section__desc screen-vision-description">
              While enabled, captures and analyzes a compressed screen frame only while HELIX is handling a request, at most once every 10 seconds. If analysis fails, sampling pauses until the request ends instead of repeatedly trying providers. Provider quotas or charges may still apply. Disable this option to stop capture immediately.
            </small>
          </label>
          <label className="toggle" title="Continuous screen captures may consume provider quota or incur charges">
            <input
              type="checkbox"
              checked={settings.continuous_screen_vision_enabled ?? false}
              aria-label="Enable continuous screen vision"
              onChange={(e) => void onSave({
                continuous_screen_vision_enabled: e.target.checked,
              })}
            />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row screen-vision-row">
          <label className="form-label" htmlFor="continuous-screen-vision-interval">
            Frame sampling interval
            <small className="toolbox-section__desc screen-vision-description">
              Default 10 seconds; configurable from 10 to 60 seconds. Sampling pauses while HELIX has no active request.
            </small>
          </label>
          <input
            id="continuous-screen-vision-interval"
            className="form-input screen-vision-interval"
            type="number"
            min={10000}
            max={60000}
            step={1000}
            value={intervalDraft}
            aria-label="Continuous screen vision sampling interval in milliseconds"
            onChange={(e) => setIntervalDraft(e.target.value)}
            onBlur={saveInterval}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveInterval()
            }}
          />
        </div>

        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Display Capture & Vision Coordinates</span>
        </div>

        <div className="form-row">
          <label className="form-label">Primary Display Index</label>
          <select className="form-input" value={String(settings.display_index ?? 0)} onChange={(e) => void onSave({ display_index: Number(e.target.value) })}>
            <option value="0">Display 1 (Primary Windows Desktop)</option>
            <option value="1">Display 2 (Secondary Monitor)</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Screen Capture Rate</label>
          <select className="form-input" value={String(settings.screen_capture_interval_ms ?? 1000)} onChange={(e) => void onSave({ screen_capture_interval_ms: Number(e.target.value) })}>
            <option value="500">Fast (500ms / 2 FPS - High CPU)</option>
            <option value="1000">Balanced (1000ms / 1 FPS)</option>
            <option value="2000">Eco (2000ms / 0.5 FPS)</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">OCR Text Recognition Engine</label>
          <select className="form-input" value={settings.ocr_engine || 'local'} onChange={(e) => void onSave({ ocr_engine: e.target.value as HelixSettings['ocr_engine'] })}>
            <option value="local">Tesseract OCR (Local, CPU)</option>
            <option value="windows_media_ocr">Windows Media OCR (Native Windows Runtime)</option>
          </select>
        </div>
      </div>

      {/* ── Input Safety & Mouse/Keyboard Automation ────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Input Safety & Execution Guardrails</span>
        </div>

        <div className="form-row">
          <label className="form-label">Mouse Move Speed (ms)</label>
          <input className="form-input" type="number" min={50} max={1000} step={50} value={settings.mouse_move_duration_ms ?? 200} onChange={(e) => void onSave({ mouse_move_duration_ms: Number(e.target.value) })} />
        </div>

        <div className="form-row">
          <label className="form-label">Keystroke Delay (ms)</label>
          <input className="form-input" type="number" min={10} max={200} step={10} value={settings.keystroke_delay_ms ?? 30} onChange={(e) => void onSave({ keystroke_delay_ms: Number(e.target.value) })} />
        </div>

        <div className="form-row">
          <label className="form-label">Fail-Safe Cursor Corner (Abort on Mouse in Screen Corner)</label>
          <label className="toggle">
            <input type="checkbox" checked={settings.pyautogui_fail_safe ?? true} onChange={(e) => void onSave({ pyautogui_fail_safe: e.target.checked })} />
            <span className="toggle__slider" />
          </label>
        </div>
      </div>
    </div>
  )
}
