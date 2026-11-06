import React, { useState } from 'react'
import type { HelixSettings } from '../../../types/global'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

export default function WebSection({ settings, onSave }: Props) {
  const [installingChromium, setInstallingChromium] = useState(false)
  const [chromiumInstallMessage, setChromiumInstallMessage] = useState('')
  const isManagedChromium = (settings.browser_channel || 'chrome') === 'bundled'

  const installChromium = async () => {
    const confirmed = window.confirm(
      'Download Playwright Chromium now? This requires an internet connection. The download starts only after you confirm.',
    )
    if (!confirmed) return

    setInstallingChromium(true)
    setChromiumInstallMessage('Downloading and installing Playwright Chromium…')
    try {
      const result = await window.helix.installPlaywrightChromium()
      setChromiumInstallMessage(result.message)
    } catch (error) {
      setChromiumInstallMessage(
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      setInstallingChromium(false)
    }
  }

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Browser Automation & Web Research</h2>
      <p className="toolbox-section__desc">
        Playwright opens a visible HELIX browser window so you can follow browser-control actions live. Configure the isolated browser profile, research, and search preferences.
      </p>

      <div className="toolbox-card" style={{ marginBottom: 16 }}>
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Playwright Browser</span>
        </div>
        <div className="form-row toolbox-browser-row">
          <label className="form-label toolbox-browser-row__label">
            Browser
            <small className="toolbox-browser-row__hint">
              Opens a visible window controlled live by Playwright, using a separate persistent HELIX profile (never your usual browser profile or tabs).
            </small>
          </label>
          <select
            className="form-input"
            value={settings.browser_channel || 'chrome'}
            onChange={(event) => void onSave({
              browser_channel: event.target.value as HelixSettings['browser_channel'],
              browser_headless: false,
            })}
          >
            <option value="bundled">Playwright Chromium (install on demand)</option>
            <option value="chrome">Installed Google Chrome · HELIX profile</option>
            <option value="msedge">Installed Microsoft Edge · HELIX profile</option>
          </select>
        </div>

        {isManagedChromium && (
          <div className="form-row toolbox-browser-row">
            <div className="form-label toolbox-browser-row__label">
              Playwright Chromium
              <small className="toolbox-browser-row__hint">
                Install the browser used for visible Playwright sessions.
              </small>
            </div>
            <div className="toolbox-browser-row__actions">
              <button
                type="button"
                className="validate-btn"
                disabled={installingChromium}
                onClick={() => void installChromium()}
              >
                {installingChromium ? 'Installing…' : 'Download Playwright Chromium'}
              </button>
              {chromiumInstallMessage && (
                <p className="toolbox-browser-row__hint" role="status" aria-live="polite">
                  {chromiumInstallMessage}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="form-row">
          <label className="form-label">Default Search Provider</label>
          <select className="form-input" value={settings.search_provider || 'google'} onChange={(e) => void onSave({ search_provider: e.target.value as HelixSettings['search_provider'] })}>
            <option value="google">Google Search</option>
            <option value="duckduckgo">DuckDuckGo (Privacy Focused)</option>
            <option value="bing">Microsoft Bing</option>
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Maximum Research Traversal Depth</label>
          <select className="form-input" value={String(settings.research_depth ?? 2)} onChange={(e) => void onSave({ research_depth: Number(e.target.value) })}>
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
            <input type="checkbox" checked={settings.block_downloads ?? true} onChange={(e) => void onSave({ block_downloads: e.target.checked })} />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <label className="form-label">Block Crypto / Adult / Malicious Domains</label>
          <label className="toggle">
            <input type="checkbox" checked={settings.block_untrusted_domains ?? true} onChange={(e) => void onSave({ block_untrusted_domains: e.target.checked })} />
            <span className="toggle__slider" />
          </label>
        </div>
      </div>
    </div>
  )
}
