import React from 'react'
import type { HelixSettings } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

export default function WebSection({ settings, onSave }: Props) {
  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Browser Automation & Web Research</h2>
      <p className="toolbox-section__desc">
        Configure Playwright-driven autonomous browsing, deep web research, data extraction, and search engine preferences.
      </p>

      {/* ── Browser Execution Mode ─────────────────────────────── */}
      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Playwright Engine Configuration</span>
        </div>

        <div className="form-row">
          <label className="form-label">Browser Engine</label>
          <select className="form-input" defaultValue="chromium">
            <option value="chromium">Chromium (Google Chrome / Microsoft Edge)</option>
            <option value="firefox">Firefox</option>
            <option value="webkit">WebKit (Safari engine)</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Headless Mode (Silent Background Execution)</label>
          <label className="toggle">
            <input type="checkbox" defaultChecked={true} />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <label className="form-label">Default Search Provider</label>
          <select className="form-input" defaultValue="google">
            <option value="google">Google Search</option>
            <option value="duckduckgo">DuckDuckGo (Privacy Focused)</option>
            <option value="bing">Microsoft Bing</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Maximum Research Traversal Depth</label>
          <select className="form-input" defaultValue="2">
            <option value="1">Level 1 (Direct search results only)</option>
            <option value="2">Level 2 (Follow up to 3 links per result - Recommended)</option>
            <option value="3">Level 3 (Deep multi-page fact synthesis)</option>
          </select>
        </div>
      </div>

      {/* ── Privacy & Safety Filters ────────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Web Security & Privacy Guardrails</span>
        </div>

        <div className="form-row">
          <label className="form-label">Block Untrusted File Downloads</label>
          <label className="toggle">
            <input type="checkbox" defaultChecked={true} />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <label className="form-label">Block Crypto / Adult / Malicious Domains</label>
          <label className="toggle">
            <input type="checkbox" defaultChecked={true} />
            <span className="toggle__slider" />
          </label>
        </div>
      </div>
    </div>
  )
}
