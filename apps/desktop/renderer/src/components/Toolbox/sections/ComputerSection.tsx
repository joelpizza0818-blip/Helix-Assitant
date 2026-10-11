import React, { useEffect, useState } from 'react'
import type { HelixSettings } from '../../../types/global'
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

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Computer Control & Screen Automation</h2>
      <p className="toolbox-section__desc">
        Configure screen analysis, native window management, mouse coordinates, and keyboard automation. Direct input is executed through isolated OS tools with safety constraints.
      </p>

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
              Lets HELIX decide whether to capture a screen observation for a request, and captures when you explicitly ask it to inspect the screen. No continuous capture. The image and accessibility data may be sent to your selected AI provider.
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
