import { useCallback, useEffect, useState } from 'react'
import type { BrowserExtensionInfo } from '../../../types/global'
import '../Toolbox.css'
import './BrowserExtensionSection.css'

export default function BrowserExtensionSection() {
  const [info, setInfo] = useState<BrowserExtensionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyingToken, setCopyingToken] = useState(false)
  const [openingFolder, setOpeningFolder] = useState(false)

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await window.helix.getBrowserExtensionInfo())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load browser extension status.')
    }
  }, [])

  useEffect(() => {
    void loadInfo()
    const interval = window.setInterval(() => void loadInfo(), 4000)
    return () => window.clearInterval(interval)
  }, [loadInfo])

  const openExtensionFolder = async () => {
    setOpeningFolder(true)
    setError(null)
    try {
      await window.helix.openBrowserExtensionFolder()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the extension folder.')
    } finally {
      setOpeningFolder(false)
    }
  }

  const copyPairingToken = async () => {
    if (!info?.token) return
    setCopyingToken(true)
    setError(null)
    try {
      await window.helix.copyTextToClipboard(info.token)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not copy the pairing token.')
    } finally {
      setCopyingToken(false)
    }
  }

  return (
    <section className="toolbox-section browser-extension">
      <h2 className="toolbox-section__title">Browser DOM Companion</h2>
      <p className="toolbox-section__desc">
        HELIX can inspect the active page in Chrome or Edge, including visible text, links, and form labels.
      </p>
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Local bridge</span>
          <span className={`browser-extension__status${info?.listening ? ' browser-extension__status--ready' : ''}`}>
            {info?.listening ? 'Bridge ready' : 'Bridge unavailable'}
          </span>
        </div>
        {!info?.listening && info?.error && (
          <p className="toolbox-error" role="alert">{info.error}</p>
        )}
        <p className="text-xs text-muted browser-extension__privacy">
          Page content is sent only to the local HELIX agent and kept in memory. Form values, including passwords, are not collected.
        </p>
        <label className="form-label browser-extension__token-label" htmlFor="browser-pairing-token">
          Extension pairing token
        </label>
        <div className="browser-extension__token-row">
          <input
            id="browser-pairing-token"
            className="form-input browser-extension__token"
            value={info?.token ?? ''}
            readOnly
            aria-label="Browser extension pairing token"
          />
          <button
            type="button"
            className="validate-btn"
            disabled={!info?.token || copyingToken}
            onClick={() => void copyPairingToken()}
          >
            {copyingToken ? 'Copying…' : copied ? 'Copied' : 'Copy token'}
          </button>
        </div>
        <div className="browser-extension__setup">
          <strong>Install in Chrome or Edge</strong>
          <ol>
            <li>Show the extension folder, then open <code>chrome://extensions</code> or <code>edge://extensions</code>.</li>
            <li>Enable Developer mode and choose <em>Load unpacked</em>; select that folder.</li>
            <li>Open the HELIX Desktop Companion extension options and paste the pairing token.</li>
          </ol>
        </div>
        <p className="text-xs text-muted browser-extension__permission">
          This extension requests access to all HTTP/HTTPS sites so it can follow your active tab. Browser-internal pages cannot be read.
        </p>
        <button
          type="button"
          className="validate-btn"
          disabled={openingFolder}
          onClick={() => void openExtensionFolder()}
        >
          {openingFolder ? 'Opening…' : 'Show extension folder'}
        </button>
        {info?.lastPage && (
          <p className="text-xs text-muted browser-extension__last-page">
            Last page received: {info.lastPage.title || info.lastPage.url}
          </p>
        )}
      </div>
    </section>
  )
}
