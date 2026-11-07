import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { DeveloperTerminalShell } from '../../../types/global'
import {
  createDeveloperTerminalInputHandler,
  prefixDeveloperCommandWithProjectPath,
} from './developerTerminalInput'

interface CommandSuggestion {
  label: string
  command: string
}

interface Props {
  projectId: string
  projectRootPath: string
  shell: DeveloperTerminalShell
  shells: DeveloperTerminalShell[]
  suggestions: CommandSuggestion[]
  onShellChange: (shell: DeveloperTerminalShell) => void
  onRestart: () => void
}

export default function DeveloperTerminal({
  projectId,
  projectRootPath,
  shell,
  shells,
  suggestions,
  onShellChange,
  onRestart,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Starting')
  const [sessionActive, setSessionActive] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let active = true
    let sessionId: string | null = null
    const pendingOutput = new Map<string, string[]>()
    const overflowedSessions = new Set<string>()
    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      fontFamily: 'Consolas, "Cascadia Mono", "SFMono-Regular", monospace',
      fontSize: 12,
      scrollback: 5000,
      theme: {
        background: '#111214',
        foreground: '#e8e8e8',
        cursor: '#ee6018',
        selectionBackground: '#5c351f',
        black: '#151515',
        red: '#e06c75',
        green: '#98c379',
        yellow: '#e5c07b',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#dcdfe4',
        brightBlack: '#5c6370',
        brightRed: '#e06c75',
        brightGreen: '#98c379',
        brightYellow: '#e5c07b',
        brightBlue: '#61afef',
        brightMagenta: '#c678dd',
        brightCyan: '#56b6c2',
        brightWhite: '#ffffff',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    terminalRef.current = terminal

    const reportError = (reason: unknown) => {
      if (!active) return
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      setStatus('Error')
      terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`)
    }

    const removeDataListener = window.helix.onDeveloperTerminalData(({ session_id, data }) => {
      if (session_id === sessionId) {
        terminal.write(data)
      } else {
        const buffered = pendingOutput.get(session_id) ?? []
        if (buffered.length < 100) {
          buffered.push(data)
          pendingOutput.set(session_id, buffered)
        } else {
          overflowedSessions.add(session_id)
        }
      }
    })
    const removeExitListener = window.helix.onDeveloperTerminalExit(({ session_id, exit_code, signal }) => {
      if (session_id !== sessionId) return
      sessionId = null
      sessionIdRef.current = null
      setSessionActive(false)
      terminal.writeln(`\r\n[Process exited${exit_code === null ? '' : ` with code ${exit_code}`}${signal ? `, signal ${signal}` : ''}]`)
      setStatus('Stopped')
    })
    const handleInput = createDeveloperTerminalInputHandler(
      (command) => {
        if (sessionId) void window.helix.writeDeveloperTerminal(sessionId, command).catch(reportError)
      },
      (text) => terminal.write(text),
    )
    const inputSubscription = terminal.onData(handleInput)

    const fitAndResize = () => {
      try {
        if (container.clientWidth === 0 || container.clientHeight === 0) return
        fit.fit()
      } catch (reason) {
        reportError(reason)
      }
    }
    const resizeObserver = new ResizeObserver(fitAndResize)
    resizeObserver.observe(container)
    if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit()
    const fitFrame = window.requestAnimationFrame(fitAndResize)

    setError(null)
    setStatus('Starting')
    void window.helix.startDeveloperTerminal({
      project_id: projectId,
      shell,
      cols: Math.max(20, terminal.cols),
      rows: Math.max(5, terminal.rows),
    }).then((result) => {
      if (!active) {
        void window.helix.closeDeveloperTerminal(result.session_id).catch(() => {})
        return
      }
      sessionId = result.session_id
      sessionIdRef.current = result.session_id
      setSessionActive(true)
      setStatus('Running')
      const buffered = pendingOutput.get(sessionId) ?? []
      buffered.forEach((data) => terminal.write(data))
      if (overflowedSessions.has(sessionId)) terminal.writeln('\r\n[Some initial shell output was omitted.]')
      pendingOutput.clear()
      overflowedSessions.clear()
      fitAndResize()
      terminal.focus()
    }).catch(reportError)

    return () => {
      active = false
      window.cancelAnimationFrame(fitFrame)
      resizeObserver.disconnect()
      inputSubscription.dispose()
      removeDataListener()
      removeExitListener()
      if (sessionId) void window.helix.closeDeveloperTerminal(sessionId).catch(() => {})
      sessionIdRef.current = null
      if (terminalRef.current === terminal) terminalRef.current = null
      terminal.dispose()
    }
  }, [projectId, shell])

  const pasteSuggestion = (command: string) => {
    terminalRef.current?.paste(prefixDeveloperCommandWithProjectPath(shell, projectRootPath, command))
    terminalRef.current?.focus()
  }

  const stop = () => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    sessionIdRef.current = null
    void window.helix.closeDeveloperTerminal(sessionId)
      .then(() => {
        setSessionActive(false)
        setStatus('Stopped')
        terminalRef.current?.writeln('\r\n[Shell stopped. Restart to open a new session.]')
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(message)
        setStatus('Error')
      })
  }

  return (
    <div className="developer-workspace__terminal-body">
      <div className="developer-workspace__terminal-toolbar">
        <label>
          Shell
          <select value={shell} onChange={(event) => onShellChange(event.target.value as DeveloperTerminalShell)}>
            {shells.map((availableShell) => (
              <option key={availableShell} value={availableShell}>
                {availableShell === 'powershell' ? 'PowerShell' : availableShell === 'cmd' ? 'Command Prompt' : 'Bash'}
              </option>
            ))}
          </select>
        </label>
        <span role="status">{status}</span>
        <button type="button" disabled={!sessionActive} onClick={stop}>Stop</button>
        <button type="button" onClick={() => terminalRef.current?.clear()}>Clear</button>
        <button type="button" onClick={onRestart}>Restart</button>
      </div>
      {suggestions.length > 0 && (
        <details className="developer-workspace__suggestions">
          <summary>Project tasks</summary>
          <div className="developer-workspace__suggestion-list" aria-label="Project test suggestions">
            {suggestions.map((suggestion) => (
              <button
                type="button"
                key={`${suggestion.label}:${suggestion.command}`}
                title={`Insert command: ${suggestion.command}`}
                onClick={() => pasteSuggestion(suggestion.command)}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </details>
      )}
      {error && <p className="toolbox-error developer-workspace__terminal-error" role="alert">{error}</p>}
      <div
        ref={containerRef}
        className="developer-workspace__terminal-emulator"
        aria-label="Interactive project terminal"
        onClick={() => terminalRef.current?.focus()}
      />
      <details className="developer-workspace__terminal-security">
        <summary>Security</summary>
        <span>Commands run with your user account privileges and are not sandboxed to this project. Input and output are not sent to the HELIX agent.</span>
      </details>
    </div>
  )
}
