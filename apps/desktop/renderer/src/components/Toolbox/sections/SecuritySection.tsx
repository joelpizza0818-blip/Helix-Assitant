import React, { useCallback, useEffect, useState } from 'react'
import type {
  ComputerUseStatus,
  DockerDesktopProgress,
  HelixSettings,
} from '../../../types/global'
import { getUserFacingError } from '../../../lib/userError'
import '../Toolbox.css'

interface Props {
  settings: HelixSettings
  onSave: (partial: Partial<HelixSettings>) => Promise<void>
}

const PERMISSION_LEVELS = [
  { level: 'READ_ONLY', desc: 'Read files, inspect UI hierarchy, inspect windows', defaultReq: 'Auto-granted' },
  { level: 'LOW_RISK', desc: 'Move cursor, standard keyboard typing, take screenshots', defaultReq: 'Auto-granted' },
  { level: 'MODIFY', desc: 'Write files, create directories, adjust window sizes', defaultReq: 'Confirmation Recommended' },
  { level: 'EXECUTE', desc: 'Execute CMD/PowerShell scripts, browser navigation, launch apps', defaultReq: 'Confirmation Required' },
  { level: 'SYSTEM', desc: 'Modify system variables, Windows startup registry entries', defaultReq: 'Confirmation Required' },
  { level: 'CRITICAL', desc: 'Delete files/directories, kill processes, format/destructive commands', defaultReq: 'Mandatory Explicit Confirmation' }
]

function progressLabel(progress: DockerDesktopProgress | null): string {
  return progress?.message ?? 'Preparing the Docker desktop…'
}

export default function SecuritySection({ settings, onSave }: Props) {
  const [newPath, setNewPath] = useState('')
  const [newApp, setNewApp] = useState('')
  const [computerUseStatus, setComputerUseStatus] = useState<ComputerUseStatus | null>(null)
  const [computerUseError, setComputerUseError] = useState<string | null>(null)
  const [computerUseProgress, setComputerUseProgress] = useState<DockerDesktopProgress | null>(null)
  const [isRefreshingComputerUse, setIsRefreshingComputerUse] = useState(false)
  const [isChangingComputerUse, setIsChangingComputerUse] = useState(false)

  const refreshComputerUse = useCallback(async () => {
    setIsRefreshingComputerUse(true)
    setComputerUseError(null)
    try {
      setComputerUseStatus(await window.helix.getComputerUseStatus())
    } catch (error) {
      setComputerUseError(getUserFacingError(
        error,
        'Could not check Computer Use. Try again in a moment.',
      ))
    } finally {
      setIsRefreshingComputerUse(false)
    }
  }, [])

  const startComputerUseSetup = useCallback(async () => {
    setComputerUseError(null)
    setComputerUseProgress(null)
    try {
      await window.helix.startComputerUseSetup()
      await refreshComputerUse()
    } catch (error) {
      setComputerUseError(getUserFacingError(
        error,
        'Could not prepare the private desktop. Try again in a moment.',
      ))
    }
  }, [refreshComputerUse])

  const choosePrivateDesktop = async () => {
    if (isChangingComputerUse) return
    setIsChangingComputerUse(true)
    setComputerUseError(null)
    try {
      await onSave({
        computer_use_mode: 'isolated',
        computer_use_host_consent: false,
      })
      await startComputerUseSetup()
    } catch (error) {
      setComputerUseError(getUserFacingError(
        error,
        'Could not switch to the private desktop. Try again in a moment.',
      ))
    } finally {
      setIsChangingComputerUse(false)
    }
  }

  const chooseWindowsDesktop = async () => {
    if (isChangingComputerUse) return
    setIsChangingComputerUse(true)
    setComputerUseError(null)
    try {
      if (computerUseStatus?.hostConsent) {
        await onSave({ computer_use_mode: 'host' })
      } else {
        const consent = await window.helix.requestHostDesktopConsent()
        if (!consent.accepted) return
        await onSave({
          computer_use_mode: 'host',
          computer_use_host_consent: true,
        })
      }
      await refreshComputerUse()
    } catch (error) {
      setComputerUseError(getUserFacingError(
        error,
        'Could not change Computer Use. Try again in a moment.',
      ))
    } finally {
      setIsChangingComputerUse(false)
    }
  }

  useEffect(() => {
    const unsubscribeProgress = window.helix.onDockerDesktopProgress((progress) => {
      setComputerUseProgress(progress)
      void refreshComputerUse()
    })
    void refreshComputerUse()
    return unsubscribeProgress
  }, [refreshComputerUse])

  useEffect(() => {
    if (!computerUseStatus?.preparing) return
    const timer = window.setInterval(() => {
      void refreshComputerUse()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [computerUseStatus?.preparing, refreshComputerUse])

  const effectiveMode = computerUseStatus?.mode ?? settings.computer_use_mode ?? 'auto'
  const hostSelected = effectiveMode === 'host'
    || (effectiveMode === 'auto' && computerUseStatus?.hostConsent === true)
  const privateDesktopSelected = !hostSelected
  const privateDesktopAvailable = computerUseStatus?.isolatedSupported === true
  const privateDesktopPreparing = computerUseStatus?.preparing === true
  const privateDesktopReady = computerUseStatus?.isolatedReady === true
  const activeProgress = computerUseProgress ?? (
    computerUseStatus?.progressPhase
      ? {
          phase: computerUseStatus.progressPhase,
          message: 'Preparing the Docker desktop…',
        }
      : null
  )

  const handleAddPath = () => {
    if (!newPath.trim()) return
    const updated = [...(settings.protected_paths || []), newPath.trim()]
    onSave({ protected_paths: updated })
    setNewPath('')
  }

  const handleRemovePath = (index: number) => {
    const updated = (settings.protected_paths || []).filter((_, i) => i !== index)
    onSave({ protected_paths: updated })
  }

  const handleAddApp = () => {
    if (!newApp.trim()) return
    const updated = [...(settings.protected_apps || []), newApp.trim()]
    onSave({ protected_apps: updated })
    setNewApp('')
  }

  const handleRemoveApp = (index: number) => {
    const updated = (settings.protected_apps || []).filter((_, i) => i !== index)
    onSave({ protected_apps: updated })
  }

  return (
    <div className="toolbox-section">
      <h2 className="toolbox-section__title">Security & Permission Policies</h2>
      <p className="toolbox-section__desc">
        HELIX enforces strict privilege separation. The AI model never receives unfettered system access; all actions traverse the policy engine and permission manager.
      </p>

      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Computer Use</span>
          <button
            type="button"
            className="validate-btn"
            disabled={isRefreshingComputerUse}
            onClick={() => void refreshComputerUse()}
          >
            {isRefreshingComputerUse ? 'Checking…' : 'Refresh'}
          </button>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Choose where HELIX can work when you ask it to use a computer. The isolated desktop runs Debian Stable with XFCE in a Docker container; it has its own persistent home folder and does not share Windows files.
        </p>
        <div
          role="radiogroup"
          aria-label="Computer Use desktop"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '10px 12px',
              background: 'var(--canvas)',
              borderRadius: 'var(--radius-btn)',
              border: '1px solid var(--border)',
            }}
          >
            <input
              type="radio"
              name="computer-use-mode"
              checked={hostSelected}
              disabled={isChangingComputerUse}
              onChange={() => void chooseWindowsDesktop()}
              style={{ marginTop: 3 }}
            />
            <span>
              <span className="text-sm weight-medium text-bone">This Windows desktop</span>
              <span className="cap-badge" style={{ marginLeft: 8, fontSize: 10 }}>Requires permission</span>
              <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                HELIX sees the screen and works in VS Code, browsers, and any open app with a separate virtual cursor. Your own mouse stays in place unless an app blocks accessibility; that physical fallback is covered by one-time permission and the pointer is restored afterward.
              </p>
            </span>
          </label>
          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '10px 12px',
              background: 'var(--canvas)',
              borderRadius: 'var(--radius-btn)',
              border: '1px solid var(--border)',
              opacity: privateDesktopAvailable ? 1 : 0.6,
            }}
          >
            <input
              type="radio"
              name="computer-use-mode"
              checked={privateDesktopSelected && privateDesktopAvailable}
              disabled={!privateDesktopAvailable || isChangingComputerUse}
              onChange={() => void choosePrivateDesktop()}
              style={{ marginTop: 3 }}
            />
            <span>
              <span className="text-sm weight-medium text-bone">Private desktop</span>
              <span className="cap-badge" style={{ marginLeft: 8, fontSize: 10 }}>Default without host permission</span>
              <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                {privateDesktopAvailable
                  ? 'An isolated Debian XFCE desktop in Docker. Its screen is shown in the desktop preview, and it cannot see your Windows apps or files.'
                  : 'Not available on this PC.'}
              </p>
            </span>
          </label>
        </div>

        <div aria-live="polite" style={{ marginTop: 12 }}>
          {!computerUseStatus && isRefreshingComputerUse && (
            <p className="text-xs text-muted">Checking what this PC supports…</p>
          )}
          {privateDesktopPreparing && (
            <>
              <p className="text-sm" style={{ color: 'var(--orange)' }}>
                {progressLabel(activeProgress)}
              </p>
              <p className="text-xs text-muted">
                The first setup builds the Debian desktop image and downloads its packages. It may take several minutes.
              </p>
            </>
          )}
          {!privateDesktopPreparing && privateDesktopReady && privateDesktopSelected && (
            <p className="text-sm" style={{ color: 'var(--green)' }}>
              Your private desktop is ready.
            </p>
          )}
          {!privateDesktopPreparing && !privateDesktopReady && privateDesktopAvailable && privateDesktopSelected && (
            <p className="text-xs text-muted">
              Your private desktop is not ready yet.
            </p>
          )}
          {!privateDesktopAvailable && privateDesktopSelected && (
            <p className="text-xs" style={{ color: 'var(--orange)' }}>
              Start Docker Desktop’s Linux container engine, then retry setup. You can also use this Windows desktop after granting consent.
            </p>
          )}
          {hostSelected && (
            <p className="text-xs text-muted">
              HELIX works on this Windows desktop only when you ask it to. Its virtual cursor is separate from yours, and accessibility actions do not move your physical pointer.
            </p>
          )}
        </div>

        {computerUseError && (
          <p className="text-xs" role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>
            {computerUseError}
          </p>
        )}
        {!computerUseError && computerUseStatus?.lastError && (
          <p className="text-xs" role="alert" style={{ color: 'var(--red)', marginTop: 8 }}>
            {computerUseStatus.lastError}
          </p>
        )}
        {!privateDesktopPreparing && privateDesktopAvailable && !privateDesktopReady && effectiveMode !== 'host' && (
          <button
            type="button"
            className="validate-btn"
            disabled={isChangingComputerUse}
            onClick={() => void startComputerUseSetup()}
            style={{ marginTop: 10 }}
          >
            {computerUseStatus?.installationComplete ? 'Start private desktop' : 'Set up Docker desktop'}
          </button>
        )}
      </div>

      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Confirmation Policy</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Choose how HELIX evaluates tool risk. Protected paths, protected processes, and destructive operations remain gated in every mode.
        </p>
        <label className="form-label" htmlFor="permissions-mode">
          Approval mode
        </label>
        <select
          id="permissions-mode"
          className="form-input"
          value={settings.permissions_mode || 'SMART_APPROVAL'}
          onChange={(event) => onSave({
            permissions_mode: event.target.value as HelixSettings['permissions_mode']
          })}
        >
          <option value="ALWAYS_ASK">Always Ask — confirm non-routine actions</option>
          <option value="AUTO_APPROVE">Auto Approve — gate system and critical actions</option>
          <option value="SMART_APPROVAL">Smart Approval — gate modifications and risky context</option>
          <option value="ALLOW_ALL">Allow All — no confirmation prompts</option>
        </select>
        <div style={{ height: 10 }} />
        <label className="form-label" htmlFor="auto-approve-up-to">
          Allow without confirmation up to
        </label>
        <select
          id="auto-approve-up-to"
          className="form-input"
          value={settings.auto_approve_up_to}
          disabled={(settings.permissions_mode || 'SMART_APPROVAL') !== 'SMART_APPROVAL'}
          onChange={(event) => onSave({
            auto_approve_up_to: event.target.value as HelixSettings['auto_approve_up_to']
          })}
        >
          <option value="READ_ONLY">Read only</option>
          <option value="LOW_RISK">Low risk</option>
          <option value="MODIFY">Modify</option>
        </select>
        <p className="text-xs text-muted" style={{ marginTop: 8 }}>
          This limit applies only to Smart Approval. Always Ask confirms non-routine actions;
          Auto Approve runs non-system actions without repeated prompts; Allow All bypasses every
          confirmation prompt, including shell, system, and protected actions. Commands rejected
          by the shell security filter remain blocked. Use Allow All only when you trust the task.
        </p>
        {settings.permissions_mode === 'ALLOW_ALL' && (
          <p className="text-xs" role="alert" style={{ marginTop: 8, color: 'var(--orange)' }}>
            Allow All is active. HELIX will run supported tools without asking for approval.
          </p>
        )}
      </div>

      {/* ── Command Sandboxing & Isolation ───────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Command Sandboxing & Isolation</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Execute system commands in an isolated sandbox with sanitized environment variables, stripped sensitive credentials/tokens, clean system PATH, and restricted execution privileges.
        </p>

        <div className="form-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <label className="form-label" style={{ marginBottom: 2 }}>Enable Command Sandboxing</label>
            <p className="text-xs text-muted">Isolate shell, cmd, and terminal executions from the host system environment</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.sandbox_enabled ?? false}
              onChange={(e) => void onSave({ sandbox_enabled: e.target.checked })}
            />
            <span className="toggle__slider" />
          </label>
        </div>

        <div className="form-row">
          <label className="form-label" htmlFor="sandbox-mode">
            Sandbox Isolation Mode
          </label>
          <select
            id="sandbox-mode"
            className="form-input"
            value={settings.sandbox_mode === 'isolated' ? 'isolated' : 'restricted'}
            disabled={!settings.sandbox_enabled}
            onChange={(e) => void onSave({
              sandbox_mode: e.target.value as HelixSettings['sandbox_mode']
            })}
          >
            <option value="restricted">Restricted Environment — Process isolation & sanitized environment (Default)</option>
            <option value="isolated">Isolated Subprocess — Clean system PATH & cleared environment variables</option>
          </select>
        </div>
      </div>

      {/* ── Permission Hierarchy ──────────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Permission Tiers</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PERMISSION_LEVELS.map((p) => (
            <div
              key={p.level}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                background: 'var(--canvas)',
                borderRadius: 'var(--radius-btn)',
                border: '1px solid var(--border)'
              }}
            >
              <div>
                <span className="text-mono text-sm weight-medium text-bone">{p.level}</span>
                <p className="text-xs text-muted">{p.desc}</p>
              </div>
              <span className="text-xs text-orange text-mono">{p.defaultReq}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Protected Paths ──────────────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Protected System Paths</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          HELIX filesystem tools will automatically refuse write or deletion operations on these paths without explicit critical overrides.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. C:\Windows, C:\Program Files"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
          />
          <button className="validate-btn" onClick={handleAddPath}>Add Path</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['C:\\Windows', 'C:\\Windows\\System32', ...(settings.protected_paths || [])].map((path, idx) => (
            <span key={idx} className="cap-badge" style={{ padding: '4px 8px', fontSize: 11 }}>
              {path}
              {idx >= 2 && (
                <button
                  onClick={() => handleRemovePath(idx - 2)}
                  style={{ marginLeft: 6, color: 'var(--red)', cursor: 'pointer' }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* ── Protected Applications ───────────────────────────── */}
      <div className="toolbox-card">
        <div className="toolbox-card__header">
          <span className="toolbox-card__title">Protected Processes</span>
        </div>
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Processes that cannot be terminated or killed by HELIX process tools.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. explorer.exe, antivirus.exe"
            value={newApp}
            onChange={(e) => setNewApp(e.target.value)}
          />
          <button className="validate-btn" onClick={handleAddApp}>Add Process</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['explorer.exe', 'lsass.exe', 'winlogon.exe', 'csrss.exe', ...(settings.protected_apps || [])].map((app, idx) => (
            <span key={idx} className="cap-badge" style={{ padding: '4px 8px', fontSize: 11 }}>
              {app}
              {idx >= 4 && (
                <button
                  onClick={() => handleRemoveApp(idx - 4)}
                  style={{ marginLeft: 6, color: 'var(--red)', cursor: 'pointer' }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
