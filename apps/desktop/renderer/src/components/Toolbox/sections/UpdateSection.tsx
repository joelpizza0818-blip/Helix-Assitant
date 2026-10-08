import { useEffect, useState } from 'react'
import type { UpdaterStatus } from '../../../types/global'
import './UpdateSection.css'

const INITIAL_STATUS: UpdaterStatus = { status: 'unsupported' }

function isUpdaterStatus(value: unknown): value is UpdaterStatus {
  if (value === null || typeof value !== 'object') return false
  const status = value as Record<string, unknown>
  switch (status.status) {
    case 'checking':
      return typeof status.currentVersion === 'string'
    case 'available':
    case 'current':
    case 'downloaded':
      return typeof status.currentVersion === 'string' && typeof status.version === 'string'
    case 'downloading':
      return typeof status.percent === 'number'
        && typeof status.transferred === 'number'
        && typeof status.total === 'number'
    case 'error':
      return typeof status.message === 'string'
    case 'unsupported':
      return true
    default:
      return false
  }
}

export default function UpdateSection() {
  const [status, setStatus] = useState<UpdaterStatus>(INITIAL_STATUS)
  const [busy, setBusy] = useState(false)

  useEffect(() => window.helix.onUpdaterStatus((value) => {
    if (isUpdaterStatus(value)) setStatus(value)
  }), [])

  const checkForUpdates = async () => {
    setBusy(true)
    setStatus({ status: 'checking', currentVersion: '' })
    try {
      const result = await window.helix.checkForUpdates()
      if (result.status === 'unsupported') setStatus({ status: 'unsupported' })
      else if (result.status === 'checking') {
        setStatus((current) => current.status === 'checking'
          ? { status: 'checking', currentVersion: result.version }
          : current)
      }
    } catch (cause) {
      setStatus({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'Could not check for updates.',
      })
    } finally {
      setBusy(false)
    }
  }

  const downloadUpdate = async () => {
    setBusy(true)
    try {
      await window.helix.downloadUpdate()
    } catch (cause) {
      setStatus({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'Could not download the update.',
      })
    } finally {
      setBusy(false)
    }
  }

  const renderStatus = () => {
    switch (status.status) {
      case 'checking':
        return <p role="status">Checking for updates{status.currentVersion ? ` (current version ${status.currentVersion})` : ''}…</p>
      case 'current':
        return <p role="status">HELIX is up to date (version {status.currentVersion}).</p>
      case 'available':
        return <p role="status">Version {status.version} is available. Your settings and data will be kept.</p>
      case 'downloading':
        return (
          <div className="updates__progress" role="status">
            <progress value={status.percent} max={100} />
            <span>{Math.floor(status.percent)}% downloaded</span>
          </div>
        )
      case 'downloaded':
        return <p role="status">Version {status.version} is ready to install.</p>
      case 'error':
        return <p className="toolbox-error" role="alert">{status.message}</p>
      case 'unsupported':
        return <p role="status">Updates are available in the installed Windows version of HELIX.</p>
    }
  }

  return (
    <section className="toolbox-section updates">
      <h2 className="toolbox-section__title">HELIX Updates</h2>
      <p className="toolbox-section__desc">
        Check for a newer version and install it without downloading the setup manually.
      </p>
      <div className="toolbox-card">
        <div className="updates__status">{renderStatus()}</div>
        {status.status === 'available' && (
          <button type="button" className="validate-btn" disabled={busy} onClick={() => void downloadUpdate()}>
            {busy ? 'Starting download…' : `Download version ${status.version}`}
          </button>
        )}
        {status.status === 'downloaded' && (
          <button type="button" className="validate-btn" onClick={() => void window.helix.installUpdate()}>
            Restart and install
          </button>
        )}
        {status.status !== 'downloading' && status.status !== 'downloaded' && (
          <button type="button" className="validate-btn" disabled={busy || status.status === 'checking'} onClick={() => void checkForUpdates()}>
            {status.status === 'checking' || busy ? 'Checking…' : 'Check for updates'}
          </button>
        )}
        <p className="text-xs text-muted updates__note">
          Updates are checked automatically when HELIX starts. Installation happens only after you choose to restart.
        </p>
      </div>
    </section>
  )
}
