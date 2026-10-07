import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopDirectory = path.join(repoRoot, 'apps', 'desktop')
const viteCli = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const requestedRendererPort = Number(process.env.HELIX_RENDERER_PORT || 5173)
let rendererPort = requestedRendererPort
const rendererUrl = () => `http://127.0.0.1:${rendererPort}`

async function isHelixDevServer() {
  try {
    const response = await fetch(`${rendererUrl()}/__helix_desktop_dev_health`, {
      signal: AbortSignal.timeout(1500)
    })
    return response.ok && path.resolve(await response.text()) === repoRoot
  } catch {
    return false
  }
}

function findAvailablePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', (error) => {
      if (error.code !== 'EADDRINUSE') {
        reject(error)
        return
      }
      server.listen(0, '127.0.0.1')
    })
    server.once('listening', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not determine an available HELIX renderer port.'))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
    server.listen(preferredPort, '127.0.0.1')
  })
}

function runElectronToFocusExistingInstance() {
  const electronPath = require('electron')
  const electron = spawn(electronPath, ['.', '--no-sandbox'], {
    cwd: desktopDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      HELIX_RENDERER_PORT: String(rendererPort)
    },
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
  console.log(`Reusing this checkout's HELIX renderer at ${rendererUrl()}.`)
  runElectronToFocusExistingInstance()
} else {
  try {
    rendererPort = await findAvailablePort(requestedRendererPort)
  } catch (error) {
    console.error(`Could not select a HELIX renderer port: ${error.message}`)
    process.exitCode = 1
    process.exit()
  }
  if (rendererPort !== requestedRendererPort) {
    console.warn(
      `Renderer port ${requestedRendererPort} is occupied by another checkout; using ${rendererPort}.`
    )
  }
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
