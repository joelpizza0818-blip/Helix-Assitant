import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, rm } from 'node:fs/promises'
import { createServer, connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const repoRoot = path.resolve(import.meta.dirname, '..')
const executable = path.resolve(
  process.env.HELIX_AGENT_EXECUTABLE
    ?? path.join(repoRoot, 'apps', 'desktop', 'agent-runtime', 'helix-agent', 'helix-agent.exe'),
)
const idleMs = Number(process.env.HELIX_BASELINE_IDLE_MS ?? 10_000)
const activeMs = Number(process.env.HELIX_BASELINE_ACTIVE_MS ?? 15_000)
const sampleIntervalMs = Number(process.env.HELIX_BASELINE_SAMPLE_MS ?? 1_000)
const requestsPerSecond = Number(process.env.HELIX_BASELINE_REQUESTS_PER_SECOND ?? 4)
const token = randomBytes(32).toString('hex')
const runDirectory = path.join(os.tmpdir(), 'helix-agent-resources-' + randomUUID())
const settingsPath = path.join(runDirectory, 'settings.json')
const childEnvironment = {
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  PATH: process.env.PATH,
  TEMP: runDirectory,
  TMP: runDirectory,
  HELIX_WS_TOKEN: token,
  HELIX_SETTINGS_PATH: settingsPath,
}

let child
let childExit
let socket
let activeRequestsSent = 0
let activeRequestsSucceeded = 0
let activeRequestsFailed = 0
const pendingRequests = new Map()

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function getUnusedPort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

function tcpReady(port, timeoutMs = 350) {
  return new Promise((resolve) => {
    const probe = connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (ready) => {
      if (settled) return
      settled = true
      probe.destroy()
      resolve(ready)
    }
    probe.setTimeout(timeoutMs, () => finish(false))
    probe.once('connect', () => finish(true))
    probe.once('error', () => finish(false))
  })
}

function probeAuthorization(port, authorization) {
  return new Promise((resolve) => {
    const headers = authorization ? { Authorization: 'Bearer ' + authorization } : {}
    const probe = new WebSocket('ws://127.0.0.1:' + port, {
      headers,
      handshakeTimeout: 1_000,
    })
    const timer = setTimeout(() => {
      probe.terminate()
      resolve({ status: null, error: 'handshake timeout' })
    }, 1_500)
    probe.once('open', () => {
      clearTimeout(timer)
      probe.close()
      resolve({ status: 101 })
    })
    probe.once('unexpected-response', (_request, response) => {
      clearTimeout(timer)
      const status = response.statusCode ?? null
      response.resume()
      resolve({ status })
    })
    probe.once('error', (error) => {
      clearTimeout(timer)
      resolve({ status: null, error: error.message })
    })
  })
}

function readProcessSample(pid) {
  const command = '(Get-Process -Id ' + pid
    + ' | Select-Object WorkingSet64,PrivateMemorySize64,CPU | ConvertTo-Json -Compress)'
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
  }).trim()
  const value = JSON.parse(raw)
  return {
    timestampMs: Date.now(),
    cpuSeconds: Number(value.CPU) || 0,
    workingSetBytes: Number(value.WorkingSet64) || 0,
    privateBytes: Number(value.PrivateMemorySize64) || 0,
  }
}

function summarizeSamples(samples, requestCount = 0) {
  const first = samples[0]
  const last = samples.at(-1)
  const elapsedSeconds = Math.max((last.timestampMs - first.timestampMs) / 1_000, 0.001)
  const cpuDeltaSeconds = Math.max(last.cpuSeconds - first.cpuSeconds, 0)
  const average = (field) => samples.reduce((sum, sample) => sum + sample[field], 0) / samples.length
  return {
    elapsedMs: last.timestampMs - first.timestampMs,
    sampleCount: samples.length,
    cpuPercentOfOneCore: Math.round((cpuDeltaSeconds / elapsedSeconds) * 10_000) / 100,
    averageWorkingSetBytes: Math.round(average('workingSetBytes')),
    peakWorkingSetBytes: Math.max(...samples.map((sample) => sample.workingSetBytes)),
    averagePrivateBytes: Math.round(average('privateBytes')),
    peakPrivateBytes: Math.max(...samples.map((sample) => sample.privateBytes)),
    requestCount,
  }
}

async function measurePhase(durationMs, active = false) {
  const samples = [readProcessSample(child.pid)]
  const activeInterval = active
    ? setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN || pendingRequests.size >= 16) return
        const requestId = 'resource-' + randomUUID()
        pendingRequests.set(requestId, Date.now())
        activeRequestsSent += 1
        socket.send(JSON.stringify({ type: 'GET_SETTINGS', payload: {}, request_id: requestId }))
      }, Math.max(50, Math.round(1_000 / requestsPerSecond)))
    : null
  const sampleInterval = setInterval(() => {
    try {
      samples.push(readProcessSample(child.pid))
    } catch {
      // A process exit is reported by the readiness/response checks below.
    }
  }, sampleIntervalMs)
  await delay(durationMs)
  clearInterval(sampleInterval)
  if (activeInterval) clearInterval(activeInterval)
  samples.push(readProcessSample(child.pid))
  return summarizeSamples(samples, active ? activeRequestsSent : 0)
}

async function waitForInitialRequest() {
  return new Promise((resolve, reject) => {
    const requestId = 'readiness-' + randomUUID()
    const timeout = setTimeout(() => reject(new Error('GET_SETTINGS request timed out')), 5_000)
    const onMessage = (data) => {
      let message
      try {
        message = JSON.parse(data.toString())
      } catch {
        return
      }
      if (message.request_id !== requestId) return
      clearTimeout(timeout)
      socket.off('message', onMessage)
      resolve({ success: !message.error, error: message.error })
    }
    socket.on('message', onMessage)
    socket.send(JSON.stringify({ type: 'GET_SETTINGS', payload: {}, request_id: requestId }))
  })
}

async function waitForRequestsToDrain(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (pendingRequests.size > 0 && Date.now() < deadline) await delay(25)
}

async function terminateChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  await Promise.race([childExit?.catch(() => {}), delay(5_000)])
}

let result
try {
  if (process.platform !== 'win32') throw new Error('This measurement requires Windows process counters.')
  if (![idleMs, activeMs, sampleIntervalMs, requestsPerSecond].every(Number.isFinite)
      || idleMs < sampleIntervalMs || activeMs < sampleIntervalMs
      || sampleIntervalMs < 250 || requestsPerSecond <= 0) {
    throw new Error('Invalid measurement duration, sample interval, or request rate.')
  }
  await mkdir(runDirectory, { recursive: true })
  const port = await getUnusedPort()
  child = spawn(executable, ['--ws-port', String(port)], {
    cwd: path.dirname(executable),
    windowsHide: true,
    stdio: 'ignore',
    env: childEnvironment,
  })
  childExit = once(child, 'exit').catch(() => {})
  const startedAt = Date.now()
  const readyDeadline = startedAt + 30_000
  let tcpListening = false
  while (Date.now() < readyDeadline) {
    if (child.exitCode !== null) throw new Error('Agent exited before readiness (code ' + child.exitCode + ').')
    if (await tcpReady(port)) {
      tcpListening = true
      break
    }
    await delay(250)
  }
  const readyMs = Date.now() - startedAt
  if (!tcpListening) throw new Error('Agent did not open its local WebSocket port within 30 seconds.')

  const unauthorized = await probeAuthorization(port, '')
  if (unauthorized.status !== 401) {
    throw new Error('Unauthenticated WebSocket handshake was not rejected with HTTP 401.')
  }
  const authenticated = await probeAuthorization(port, token)
  if (authenticated.status !== 101) {
    throw new Error('Authenticated WebSocket handshake failed (HTTP ' + (authenticated.status ?? 'unavailable') + ').')
  }
  socket = new WebSocket('ws://127.0.0.1:' + port, {
    headers: { Authorization: 'Bearer ' + token },
    handshakeTimeout: 5_000,
  })
  await once(socket, 'open')
  const initialRequest = await waitForInitialRequest()
  if (!initialRequest.success) throw new Error('GET_SETTINGS returned an application error.')

  socket.on('message', (data) => {
    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      return
    }
    if (!message.request_id || !pendingRequests.has(message.request_id)) return
    pendingRequests.delete(message.request_id)
    if (message.error) activeRequestsFailed += 1
    else activeRequestsSucceeded += 1
  })

  await delay(Number(process.env.HELIX_BASELINE_WARMUP_MS ?? 2_000))
  const idle = await measurePhase(idleMs)
  const active = await measurePhase(activeMs, true)
  await waitForRequestsToDrain()

  result = {
    schema: 1,
    executable,
    readiness: { ready: true, readyMs },
    authentication: {
      unauthenticatedHttpStatus: unauthorized.status,
      unauthenticatedRejected: unauthorized.status === 401,
      authenticatedHttpStatus: authenticated.status,
    },
    applicationRequest: { type: 'GET_SETTINGS', success: true },
    workload: {
      activeRequestType: 'GET_SETTINGS',
      requestedPerSecond: requestsPerSecond,
      sent: activeRequestsSent,
      succeeded: activeRequestsSucceeded,
      failed: activeRequestsFailed,
      pendingAfterDrain: pendingRequests.size,
    },
    phases: { idleNoRequests: idle, loopbackGetSettings: active },
    cleanup: { temporarySettingsDirectoryRemoved: true },
  }
} catch (error) {
  result = {
    schema: 1,
    executable,
    readiness: { ready: false },
    error: error instanceof Error ? error.message : String(error),
  }
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  else if (socket?.readyState === WebSocket.CONNECTING) socket.terminate()
  await terminateChild()
  const tempRoot = path.resolve(os.tmpdir())
  const resolvedRunDirectory = path.resolve(runDirectory)
  if (path.relative(tempRoot, resolvedRunDirectory).startsWith('..')) {
    throw new Error('Refusing to clean a measurement directory outside the system temporary folder.')
  }
  await rm(runDirectory, { recursive: true, force: true })
}

console.log(JSON.stringify(result))
if (!result?.readiness?.ready) process.exitCode = 1
