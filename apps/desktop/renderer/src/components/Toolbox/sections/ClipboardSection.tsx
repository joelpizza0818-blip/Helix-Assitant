import { useEffect, useState } from 'react'
import type { ClipboardHistoryItem } from '../../../types/global'
import '../Toolbox.css'
import './ClipboardSection.css'

export default function ClipboardSection() {
  const [items, setItems] = useState<ClipboardHistoryItem[]>([])
  const [monitoring, setMonitoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    const cleanups = [
      window.helix.onClipboardHistoryChanged((nextItems) => setItems(nextItems)),
      window.helix.onClipboardMonitoringChanged((enabled) => setMonitoring(enabled)),
    ]
    void Promise.all([
      window.helix.getClipboardHistory(),
      window.helix.getClipboardMonitoring(),
    ]).then(([history, enabled]) => {
      if (!active) return
      setItems(history)
      setMonitoring(enabled)
      setError(null)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load clipboard history.')
    })
    return () => {
      active = false
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [])

  const toggleMonitoring = async () => {
    const next = !monitoring
    setBusy(true)
    setError(null)
    try {
      await window.helix.setClipboardMonitoring(next)
      setMonitoring(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update clipboard monitoring.')
    } finally {
      setBusy(false)
    }
  }

  const clearHistory = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.helix.clearClipboardHistory()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not clear clipboard history.')
    } finally {
      setBusy(false)
    }
  }

  const restoreItem = async (id: string) => {
    setError(null)
    try {
      await window.helix.restoreClipboardItem(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore clipboard item.')
    }
  }

  return (
    <section className="toolbox-section">
      <h2 className="toolbox-section__title">Clipboard history</h2>
      <p className="toolbox-section__desc">
        Keep recent text and images copied from any app while HELIX is running.
      </p>
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <div>
            <span className="toolbox-card__title">
              Monitoring {monitoring ? 'on' : 'off'}
            </span>
            <p className="text-xs text-muted clipboard-section__privacy">
              Up to 30 items stay in memory only and are erased when HELIX closes.
            </p>
          </div>
          <div className="clipboard-section__controls">
            <button
              type="button"
              className="validate-btn"
              aria-pressed={monitoring}
              disabled={busy}
              onClick={() => void toggleMonitoring()}
            >
              {monitoring ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              className="validate-btn toolbox-danger-button"
              disabled={busy || items.length === 0}
              onClick={() => void clearHistory()}
            >
              Clear
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted">Copy text or an image in any app to start a session history.</p>
        ) : (
          <div className="clipboard-section__list">
            {items.map((item) => (
              <article className="clipboard-section__item" key={item.id}>
                <div className="clipboard-section__item-meta">
                  <span>{item.kind === 'image' ? 'Image' : 'Text'}</span>
                  <time dateTime={item.timestamp}>{new Date(item.timestamp).toLocaleTimeString()}</time>
                </div>
                {item.kind === 'image' && item.dataUrl ? (
                  <img className="clipboard-section__image" src={item.dataUrl} alt="Clipboard history preview" />
                ) : (
                  <p className="clipboard-section__text selectable">{item.text}</p>
                )}
                <button
                  type="button"
                  className="validate-btn clipboard-section__copy"
                  onClick={() => void restoreItem(item.id)}
                >
                  Copy back to clipboard
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
