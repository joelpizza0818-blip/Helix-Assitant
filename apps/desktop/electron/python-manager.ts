import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'

type StdoutHandler = (line: string) => void
type ExitHandler = (code: number | null) => void

const RESTART_DELAYS_MS = [1000, 2000, 5000, 10000, 30000]

export class PythonManager {
  private process: ChildProcess | null = null
  private agentDir: string = ''
  private wsPort: number = 8765
  private restartCount: number = 0
  private maxRestarts: number = 5
  private stopping: boolean = false

  private stdoutHandlers: StdoutHandler[] = []
  private stderrHandlers: StdoutHandler[] = []
  private exitHandlers: ExitHandler[] = []

  async start(agentDir: string, wsPort: number): Promise<void> {
    this.agentDir = agentDir
    this.wsPort = wsPort
    this.stopping = false
    this.restartCount = 0
    return this._spawn()
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
      windowsHide: true
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
        setTimeout(() => this._spawn(), delay)
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
    if (!this.process) return

    return new Promise((resolve) => {
      if (!this.process) { resolve(); return }

      const timeout = setTimeout(() => {
        this.process?.kill('SIGKILL')
        resolve()
      }, 5000)

      this.process.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })

      this.process.kill('SIGTERM')
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
