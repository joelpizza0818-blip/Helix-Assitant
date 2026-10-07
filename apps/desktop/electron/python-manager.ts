import { execFile, spawn, ChildProcess } from 'child_process'
import { createServer } from 'net'
import path from 'path'
import fs from 'fs'
import WebSocket from 'ws'

type StdoutHandler = (line: string) => void
type ExitHandler = (code: number | null) => void

const RESTART_DELAYS_MS = [1000, 2000, 5000, 10000, 30000]

export class PythonManager {
  private process: ChildProcess | null = null
  private agentDir: string = ''
  private wsPort: number = 8765
  private settingsPath: string = ''
  private restartCount: number = 0
  private maxRestarts: number = 5
  private stopping: boolean = false
  private restartTimer: NodeJS.Timeout | null = null

  private stdoutHandlers: StdoutHandler[] = []
  private stderrHandlers: StdoutHandler[] = []
  private exitHandlers: ExitHandler[] = []

  async start(agentDir: string, wsPort: number, settingsPath: string): Promise<number> {
    this.agentDir = agentDir
    this.wsPort = await this.findAvailablePort(wsPort)
    this.settingsPath = settingsPath
    if (this.wsPort !== wsPort) {
      console.warn(`[PythonManager] Port ${wsPort} is already in use; using ${this.wsPort} instead`)
    }
    this.stopping = false
    this.restartCount = 0
    await this._spawn()
    try {
      await this._waitForReady()
    } catch (error) {
      await this.stop()
      throw error
    }
    return this.wsPort
  }

  private async _waitForReady(timeoutMs = 90000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const child = this.process
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        throw new Error('Python agent exited before its WebSocket became ready')
      }

      const ready = await new Promise<boolean>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${this.wsPort}`)
        let settled = false
        let timeout: NodeJS.Timeout | null = null
        const finish = (connected: boolean) => {
          if (settled) return
          settled = true
          if (timeout) clearTimeout(timeout)
          socket.close()
          resolve(connected)
        }
        timeout = setTimeout(() => finish(false), 1000)
        socket.once('open', () => finish(true))
        socket.once('error', () => finish(false))
      })
      if (ready) {
        console.log(`[PythonManager] Agent WebSocket ready on port ${this.wsPort}`)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(
      `Python agent WebSocket did not become ready on port ${this.wsPort} within ${timeoutMs}ms`
    )
  }

  private findAvailablePort(preferredPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EADDRINUSE') {
          reject(error)
          return
        }

        const fallbackServer = createServer()
        fallbackServer.once('error', reject)
        fallbackServer.listen(0, '127.0.0.1', () => {
          const address = fallbackServer.address()
          if (!address || typeof address === 'string') {
            fallbackServer.close()
            reject(new Error('Could not determine an available agent port'))
            return
          }
          fallbackServer.close((closeError) => {
            if (closeError) reject(closeError)
            else resolve(address.port)
          })
        })
      })
      server.listen(preferredPort, '127.0.0.1', () => {
        server.close((error) => {
          if (error) reject(error)
          else resolve(preferredPort)
        })
      })
    })
  }

  private async _spawn(): Promise<void> {
    const pythonExe = this._findPython()
    if (!pythonExe) {
      throw new Error('Python executable not found. Install Python 3.11+ and ensure it is in PATH.')
    }

    const mainScript = path.join(this.agentDir, 'main.py')
    if (!fs.existsSync(mainScript)) {
      throw new Error(`Python agent main.py not found at: ${mainScript}`)
    }

    console.log(`[PythonManager] Spawning: ${pythonExe} main.py --ws-port ${this.wsPort}`)
    console.log(`[PythonManager] Working dir: ${this.agentDir}`)

    this.process = spawn(pythonExe, ['main.py', '--ws-port', String(this.wsPort)], {
      cwd: this.agentDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONPATH: [
          path.resolve(this.agentDir, '../..'),
          process.env.PYTHONPATH
        ].filter(Boolean).join(path.delimiter),
        HELIX_SETTINGS_PATH: this.settingsPath
      }
    })

    let stdoutBuffer = ''
    this.process.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      lines.forEach((line) => {
        if (line.trim()) {
          this.stdoutHandlers.forEach((h) => h(line))
        }
      })
    })

    let stderrBuffer = ''
    this.process.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString()
      const lines = stderrBuffer.split('\n')
      stderrBuffer = lines.pop() ?? ''
      lines.forEach((line) => {
        if (line.trim()) {
          this.stderrHandlers.forEach((h) => h(line))
        }
      })
    })

    this.process.on('exit', (code) => {
      this.exitHandlers.forEach((h) => h(code))
      this.process = null

      if (!this.stopping && this.restartCount < this.maxRestarts) {
        const delay = RESTART_DELAYS_MS[Math.min(this.restartCount, RESTART_DELAYS_MS.length - 1)]
        console.warn(`[PythonManager] Process exited (code ${code}). Restarting in ${delay}ms... (attempt ${this.restartCount + 1}/${this.maxRestarts})`)
        this.restartCount++
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null
          if (!this.stopping) void this._spawn()
        }, delay)
      } else if (!this.stopping) {
        console.error('[PythonManager] Max restarts reached. Agent is permanently down.')
      }
    })

    this.process.on('error', (err) => {
      console.error('[PythonManager] Spawn error:', err.message)
    })
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const agentProcess = this.process
    if (!agentProcess) return

    if (process.platform === 'win32' && agentProcess.pid) {
      await new Promise<void>((resolve, reject) => {
        execFile(
          'taskkill',
          ['/PID', String(agentProcess.pid), '/T', '/F'],
          { windowsHide: true },
          (error) => {
            if (error && agentProcess.exitCode === null && agentProcess.signalCode === null) {
              reject(new Error(`Could not stop Python agent process tree: ${error.message}`))
              return
            }
            resolve()
          }
        )
      })
      if (!(await this.waitForExit(agentProcess, 5000))) {
        throw new Error('Python agent process did not exit after process-tree shutdown')
      }
      return
    }

    agentProcess.kill('SIGTERM')
    if (await this.waitForExit(agentProcess, 5000)) return

    agentProcess.kill('SIGKILL')

    if (!(await this.waitForExit(agentProcess, 5000))) {
      throw new Error('Python agent process did not exit after forced shutdown')
    }
  }

  private waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.removeListener('exit', onExit)
        resolve(false)
      }, timeoutMs)
      const onExit = () => {
        clearTimeout(timeout)
        resolve(true)
      }
      child.once('exit', onExit)
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    this.stopping = false
    this.restartCount = 0
    await this._spawn()
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  onStdout(fn: StdoutHandler): void {
    this.stdoutHandlers.push(fn)
  }

  onStderr(fn: StdoutHandler): void {
    this.stderrHandlers.push(fn)
  }

  onExit(fn: ExitHandler): void {
    this.exitHandlers.push(fn)
  }

  private _findPython(): string | null {
    const candidates = [
      // Check .venv inside agent dir first
      path.join(this.agentDir, '.venv', 'Scripts', 'python.exe'),
      path.join(this.agentDir, '.venv', 'bin', 'python'),
      // Check workspace-level .venv
      path.join(this.agentDir, '..', '..', '.venv', 'Scripts', 'python.exe'),
      // System Python
      'python',
      'python3',
      'py'
    ]

    for (const candidate of candidates) {
      if (!candidate.includes('python') && !candidate.includes('py')) continue
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    // For system python commands, just return 'python' and let spawn handle it
    return 'python'
  }
}
