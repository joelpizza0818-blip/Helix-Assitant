import React from 'react'
import type { HelixSettings } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

export default function ComputerSection({ settings, onSave }: Props) {
  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Computer Control & Screen Automation</h2>
      <p className="toolbox-section__desc">
        Configure screen analysis, native window management, mouse coordinates, and keyboard automation. Direct input is executed through isolated OS tools with safety constraints.
      </p>

      {/* ── Screen Capture & Display Settings ──────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Display Capture & Vision Coordinates</span>
        </div>

        <div className="form-row">
          <label className="form-label">Primary Display Index</label>
          <select className="form-input" defaultValue="0">
            <option value="0">Display 1 (Primary Windows Desktop)</option>
            <option value="1">Display 2 (Secondary Monitor)</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Screen Capture Rate</label>
          <select className="form-input" defaultValue="1000">
            <option value="500">Fast (500ms / 2 FPS - High CPU)</option>
            <option value="1000">Balanced (1000ms / 1 FPS)</option>
            <option value="2000">Eco (2000ms / 0.5 FPS)</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">OCR Text Recognition Engine</label>
          <select className="form-input" defaultValue="tesseract">
            <option value="tesseract">Tesseract OCR (Local, CPU)</option>
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
          <input className="form-input" type="number" min={50} max={1000} step={50} defaultValue={200} />
        </div>

        <div className="form-row">
          <label className="form-label">Keystroke Delay (ms)</label>
          <input className="form-input" type="number" min={10} max={200} step={10} defaultValue={30} />
        </div>

        <div className="form-row">
          <label className="form-label">Fail-Safe Cursor Corner (Abort on Mouse in Screen Corner)</label>
          <label className="toggle">
            <input type="checkbox" defaultChecked={true} />
            <span className="toggle__slider" />
          </label>
        </div>
      </div>
    </div>
  )
}
