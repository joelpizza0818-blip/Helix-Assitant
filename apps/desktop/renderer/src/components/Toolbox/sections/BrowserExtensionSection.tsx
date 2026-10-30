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
        HELIX reuses an open tab from the same website when possible; otherwise, it opens a new tab in your paired Chrome or Edge browser.
      </p>
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Local bridge</span>
          <span className={`browser-extension__status${info?.extensionConnected ? ' browser-extension__status--ready' : ''}`}>
            {info?.extensionConnected
              ? 'Extension connected'
              : info?.connectionIssue === 'invalid_token'
                ? 'Pairing token rejected'
                : 'Waiting for extension'}
          </span>
        </div>
        {!info?.listening && info?.error && (
          <p className="toolbox-error" role="alert">{info.error}</p>
        )}
        {info?.listening && !info.extensionConnected && (
          <p className="toolbox-error" role="status">
            {info.connectionIssue === 'invalid_token'
              ? 'The installed extension reached HELIX, but its pairing token was rejected. Copy the current token below, open the extension options, save it, and use Test connection.'
              : 'No extension connection has reached HELIX yet. Open Chrome or Edge, check that HELIX Desktop Companion is enabled, then save the current token in its options and use Test connection.'}
          </p>
        )}
        <p className="text-xs text-muted browser-extension__privacy">
          Only the selected tab is shared with the agent; other tabs are not inspected or controlled. Reusing an existing tab gives HELIX access to its page and regular browser session. Snapshots omit form values, but page content may be sent to your configured AI provider as part of a request.
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
            <li>Open HELIX Desktop Companion options, paste the token shown above, save it, then use <em>Test connection</em>.</li>
          </ol>
        </div>
        <p className="text-xs text-muted browser-extension__permission">
          The extension needs site access to inspect HELIX tabs on HTTP/HTTPS pages. It does not send content from your other tabs. Browser-internal pages cannot be read.
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
