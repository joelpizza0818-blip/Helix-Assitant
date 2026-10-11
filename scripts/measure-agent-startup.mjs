import { execFileSync, spawn } from 'node:child_process'
import { connect } from 'node:net'
import path from 'node:path'
import WebSocket from 'ws'

const repoRoot = path.resolve(import.meta.dirname, '..')
const executable = path.join(repoRoot, 'apps', 'desktop', 'agent-runtime', 'helix-agent', 'helix-agent.exe')
const port = Number(process.env.HELIX_BASELINE_PORT ?? 18765)
const startedAt = Date.now()
const memorySnapshot = () => {
  if (!child.pid) return {}
  try {
    const raw = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `(Get-Process -Id ${child.pid} | Select-Object WorkingSet64,PeakWorkingSet64 | ConvertTo-Json -Compress)`,
    ], { encoding: 'utf8', windowsHide: true }).trim()
    const value = JSON.parse(raw)
    return {
      workingSetBytes: Number(value.WorkingSet64) || 0,
      peakWorkingSetBytes: Number(value.PeakWorkingSet64) || 0,
    }
  } catch {
    return {}
  }
}
const child = spawn(executable, ['--ws-port', String(port)], {
  cwd: path.dirname(executable),
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    HELIX_WS_TOKEN: 'baseline-local-token',
    HELIX_SETTINGS_PATH: path.join(process.env.TEMP ?? process.env.TMP ?? repoRoot, 'helix-baseline-settings.json'),
  },
})

let finished = false
const finish = (result) => {
  if (finished) return
  finished = true
  console.log(JSON.stringify(result))
  child.kill()
  process.exit(0)
}

const finishAfterActiveRequest = (readyMs) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { Authorization: `Bearer ${process.env.HELIX_WS_TOKEN}` },
    handshakeTimeout: 5000,
  })
  const activeTimeout = setTimeout(() => {
    socket.terminate()
    finish({ ready: true, readyMs, activeRequest: false, activeError: 'timeout', pid: child.pid, ...memorySnapshot() })
  }, 5000)
  socket.once('open', () => {
    socket.send(JSON.stringify({ type: 'GET_SETTINGS', request_id: `baseline-${Date.now()}` }))
  })
  socket.once('message', () => {
    clearTimeout(activeTimeout)
    const activeMemory = memorySnapshot()
    socket.close()
    finish({ ready: true, readyMs, activeRequest: true, pid: child.pid, ...activeMemory })
  })
  socket.once('error', (error) => {
    clearTimeout(activeTimeout)
    finish({ ready: true, readyMs, activeRequest: false, activeError: error.message, pid: child.pid, ...memorySnapshot() })
  })
}

const probe = () => {
  if (child.exitCode !== null) {
    finish({ ready: false, readyMs: Date.now() - startedAt, exitCode: child.exitCode, pid: child.pid })
    return
  }
  const socket = connect({ host: '127.0.0.1', port })
  socket.once('connect', () => {
    socket.destroy()
    finishAfterActiveRequest(Date.now() - startedAt)
  })
  socket.setTimeout(500, () => socket.destroy())
  socket.on('error', () => {})
}

child.once('error', (error) => finish({ ready: false, readyMs: Date.now() - startedAt, error: error.message }))
child.once('exit', () => {
  if (finished) process.exit(0)
})

const interval = setInterval(probe, 250)
setTimeout(() => {
  clearInterval(interval)
  finish({ ready: false, readyMs: Date.now() - startedAt, pid: child.pid, timeout: true, ...memorySnapshot() })
}, 30_000)
