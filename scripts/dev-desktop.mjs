import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDirectory = path.join(repoRoot, 'apps', 'desktop')
const viteCli = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const rendererPort = Number(process.env.HELIX_RENDERER_PORT || 5173)
const rendererUrl = `http://127.0.0.1:${rendererPort}`

async function isHelixDevServer() {
  try {
    const response = await fetch(`${rendererUrl}/__helix_desktop_dev_health`, {
      signal: AbortSignal.timeout(1500)
    })
    return response.ok && (await response.text()) === 'HELIX_DESKTOP_DEV'
  } catch {
    return false
  }
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(1500, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

function runElectronToFocusExistingInstance() {
  const electronPath = require('electron')
  const electron = spawn(electronPath, ['.', '--no-sandbox'], {
    cwd: desktopDirectory,
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit'
  })

  electron.once('error', (error) => {
    console.error(`Could not focus the running HELIX desktop instance: ${error.message}`)
    process.exitCode = 1
  })
  electron.once('exit', (code) => {
    process.exitCode = code ?? 1
  })
}

if (await isHelixDevServer()) {
  console.log(`Reusing HELIX renderer at ${rendererUrl}; focusing its existing desktop instance.`)
  runElectronToFocusExistingInstance()
} else if (await isPortInUse(rendererPort)) {
  console.error(
    `Port ${rendererPort} is occupied by a process that is not the HELIX desktop dev server. ` +
    'Close that process or set HELIX_RENDERER_PORT to a free port before starting HELIX.'
  )
  process.exitCode = 1
} else {
  const vite = spawn(process.execPath, [viteCli], {
    cwd: desktopDirectory,
    env: { ...process.env, HELIX_RENDERER_PORT: String(rendererPort) },
    stdio: 'inherit'
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      if (vite.exitCode === null && !vite.killed) {
        vite.kill(signal)
      }
    })
  }

  vite.once('error', (error) => {
    console.error(`Could not start the HELIX desktop dev server: ${error.message}`)
    process.exitCode = 1
  })
  vite.once('exit', (code) => {
    process.exitCode = code ?? 1
  })
}
