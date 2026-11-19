import { execFile as execFileCallback } from 'child_process'
import { randomBytes } from 'crypto'
import fs from 'fs/promises'
import net from 'net'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

const execFile = promisify(execFileCallback)
const CONTAINER_NAME = 'helix-computer-desktop'
const IMAGE_NAME = 'helix-computer-use:1'
const HOME_MIGRATION_MARKER = '.helix-volume-migrated'
const CONTAINER_PORT = 8765
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000
const STARTUP_TIMEOUT_MS = 180_000
const MAX_EXEC_BUFFER = 16 * 1024 * 1024

export type DockerDesktopProgress = {
  phase: 'checking' | 'building' | 'starting' | 'ready'
  message: string
}

export interface DockerDesktopStatus {
  supported: boolean
  engineAvailable: boolean
  imageReady: boolean
  containerExists: boolean
  running: boolean
  ready: boolean
  provisioning: boolean
  resourceConflict: boolean
  lastError: string | null
}

export type DockerRunner = (args: string[], timeoutMs?: number) => Promise<string>

const runDocker: DockerRunner = async (args, timeoutMs = 30_000) => {
  const { stdout } = await execFile('docker', args, {
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: MAX_EXEC_BUFFER,
  })
  return stdout.trim()
}

interface SessionConfig {
  endpoint: string
  token: string
  runtime: 'docker'
  container_name: string
  image: string
  installation_complete: true
  last_activity_at?: string
}

export class DockerDesktopManager {
  private readonly sessionPath: string
  private readonly imageResourcesPath: string
  private readonly guestAgentPath: string
  private readonly runner: DockerRunner
  private readonly onProgress: (progress: DockerDesktopProgress) => void
  private readonly storageRoot: string
  private provisioning = false
  private lastError: string | null = null
  private idleTimer: NodeJS.Timeout | null = null

  constructor(
    sessionPath: string,
    imageResourcesPath: string,
    guestAgentPath: string,
    runner: DockerRunner = runDocker,
    onProgress: (progress: DockerDesktopProgress) => void = () => undefined,
    storageRoot = path.join(os.homedir(), 'Desktop', 'helix-storage'),
  ) {
    this.sessionPath = sessionPath
    this.imageResourcesPath = imageResourcesPath
    this.guestAgentPath = guestAgentPath
    this.runner = runner
    this.onProgress = onProgress
    this.storageRoot = path.resolve(storageRoot)
  }

  startIdleMonitor(): void {
    if (this.idleTimer) return
    this.idleTimer = setInterval(() => {
      void this.stopIfIdle().catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        console.error('[DockerDesktop] Idle shutdown failed:', error)
      })
    }, 60_000)
    this.idleTimer.unref()
  }

  dispose(): void {
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = null
  }

  async getStatus(): Promise<DockerDesktopStatus> {
    let engineAvailable = false
    try {
      await this.runner(['info', '--format', '{{.ServerVersion}}'])
      engineAvailable = true
    } catch (error) {
      return {
        supported: process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin',
        engineAvailable: false,
        imageReady: false,
        containerExists: false,
        running: false,
        ready: false,
        provisioning: this.provisioning,
        resourceConflict: false,
        lastError: dockerUnavailableMessage(error),
      }
    }

    const imageReady = await this._imageExists()
    const container = await this._inspectContainer()
    const containerExists = container !== null
    const resourceConflict = containerExists && container?.owned !== true
    const running = container?.running === true && !resourceConflict
    const session = containerExists && !resourceConflict
      ? await this._readSessionConfig().catch(() => null)
      : null
    const ready = imageReady && running && session !== null
    return {
      supported: true,
      engineAvailable,
      imageReady,
      containerExists,
      running,
      ready,
      provisioning: this.provisioning,
      resourceConflict,
      lastError: this.lastError ?? (resourceConflict
        ? 'A container with HELIX’s desktop name already exists and was left unchanged.'
        : null),
    }
  }

  async prepare(): Promise<DockerDesktopStatus> {
    if (this.provisioning) throw new Error('The Docker desktop is already being prepared.')
    this.provisioning = true
    this.lastError = null
    try {
      this.onProgress({ phase: 'checking', message: 'Checking Docker Engine…' })
      await this.runner(['info', '--format', '{{.ServerVersion}}'])
      const current = await this._inspectContainer()
      if (current && !current.owned) {
        throw new Error(
          'A container named helix-computer-desktop already exists and was not changed.',
        )
      }
      if (current && current.homeMount !== 'bind') {
        await this._migrateContainerHome()
      }
      if (!(await this._imageExists())) {
        await this._buildImage()
      }
      if (!current || current.homeMount !== 'bind') await this._createContainer()
      await this.start()
      this.onProgress({ phase: 'ready', message: 'Docker desktop is ready.' })
      return this.getStatus()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      this.provisioning = false
    }
  }

  async start(): Promise<DockerDesktopStatus> {
    const container = await this._inspectContainer()
    if (!container) throw new Error('The Docker desktop has not been prepared yet.')
    if (!container.owned) {
      throw new Error('The named container is not HELIX’s desktop and was left unchanged.')
    }
    if (container.homeMount !== 'bind') {
      throw new Error('Run Docker desktop setup to migrate its home folder into helix-storage.')
    }
    if (!container.running) {
      this.onProgress({ phase: 'starting', message: 'Starting the isolated desktop…' })
      await this.runner(['start', CONTAINER_NAME])
    }
    const config = await this._readSessionConfig()
    const port = await this._getHostPort()
    config.endpoint = `ws://127.0.0.1:${port}`
    config.last_activity_at = new Date().toISOString()
    await this._writeSessionConfig(config)
    await this._waitForAgent(port)
    return this.getStatus()
  }

  async stop(): Promise<DockerDesktopStatus> {
    const container = await this._inspectContainer()
    if (!container || !container.running) return this.getStatus()
    if (!container.owned) throw new Error('The named container is not HELIX’s desktop.')
    await this.runner(['stop', '--time', '10', CONTAINER_NAME])
    return this.getStatus()
  }

  async installApps(packageNames: string[]): Promise<void> {
    const allowedPackages = new Set([
      'firefox-esr',
      'libreoffice',
      'gimp',
      'evince',
      'mousepad',
      'vlc',
      'xarchiver',
      'gnome-calculator',
      'shotwell',
    ])
    if (
      !Array.isArray(packageNames)
      || packageNames.length === 0
      || packageNames.length > allowedPackages.size
      || packageNames.some((name) => typeof name !== 'string' || !allowedPackages.has(name))
    ) {
      throw new TypeError('The approved Linux app selection is invalid.')
    }
    const status = await this.getStatus()
    if (!status.ready) throw new Error('Start the Docker desktop before installing Linux apps.')
    await this.runner([
      'exec',
      '--user',
      '0',
      '--env',
      'DEBIAN_FRONTEND=noninteractive',
      CONTAINER_NAME,
      'apt-get',
      'update',
      '-qq',
    ], 300_000)
    await this.runner([
      'exec',
      '--user',
      '0',
      '--env',
      'DEBIAN_FRONTEND=noninteractive',
      CONTAINER_NAME,
      'apt-get',
      'install',
      '-y',
      '--no-install-recommends',
      ...[...new Set(packageNames)],
    ], 600_000)
    const config = await this._readSessionConfig()
    config.last_activity_at = new Date().toISOString()
    await this._writeSessionConfig(config)
  }

  private async _buildImage(): Promise<void> {
    this.onProgress({ phase: 'building', message: 'Building the Debian XFCE desktop image…' })
    const buildCache = path.join(this.storageRoot, 'cache', 'docker-image-build')
    await fs.mkdir(buildCache, { recursive: true })
    const context = await fs.mkdtemp(path.join(buildCache, 'context-'))
    try {
      await Promise.all([
        fs.copyFile(path.join(this.imageResourcesPath, 'Dockerfile'), path.join(context, 'Dockerfile')),
        fs.copyFile(path.join(this.imageResourcesPath, 'start-desktop.sh'), path.join(context, 'start-desktop.sh')),
        fs.copyFile(this.guestAgentPath, path.join(context, 'guest_agent.py')),
      ])
      await this.runner([
        'build',
        '--pull',
        '--tag',
        IMAGE_NAME,
        '--file',
        path.join(context, 'Dockerfile'),
        context,
      ], 30 * 60_000)
    } finally {
      await fs.rm(context, { recursive: true, force: true })
    }
  }

  private async _createContainer(): Promise<void> {
    const computerHome = path.join(this.storageRoot, 'computer-home')
    await fs.mkdir(computerHome, { recursive: true })
    const config: SessionConfig = {
      endpoint: 'ws://127.0.0.1:1',
      token: randomBytes(32).toString('hex'),
      runtime: 'docker',
      container_name: CONTAINER_NAME,
      image: IMAGE_NAME,
      installation_complete: true,
      last_activity_at: new Date().toISOString(),
    }
    await this._writeSessionConfig(config)
    await this.runner([
      'run',
      '--detach',
      '--name',
      CONTAINER_NAME,
      '--label',
      'com.helix.desktop=1',
      '--restart',
      'no',
      '--init',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--pids-limit',
      '512',
      '--mount',
      `type=bind,source=${computerHome},target=/home/helix`,
      '--publish',
      `127.0.0.1::${CONTAINER_PORT}`,
      '--env',
      `HELIX_GUEST_TOKEN=${config.token}`,
      IMAGE_NAME,
    ], 120_000)
  }

  private async _migrateContainerHome(): Promise<void> {
    const computerHome = path.join(this.storageRoot, 'computer-home')
    await fs.mkdir(computerHome, { recursive: true })
    const markerPath = path.join(computerHome, HOME_MIGRATION_MARKER)
    const entries = await fs.readdir(computerHome)
    if (entries.includes(HOME_MIGRATION_MARKER)) {
      await this.runner(['rm', '--force', CONTAINER_NAME], 120_000)
      return
    }
    if (entries.length > 0) {
      throw new Error(
        'The HELIX desktop home folder already contains files; refusing to merge Docker desktop data.',
      )
    }
    await this.runner([
      'cp',
      `${CONTAINER_NAME}:/home/helix/.`,
      computerHome,
    ], 300_000)
    await fs.writeFile(markerPath, 'Migrated from the previous HELIX Docker volume.\n', {
      flag: 'wx',
    })
    await this.runner(['rm', '--force', CONTAINER_NAME], 120_000)
  }

  private async _imageExists(): Promise<boolean> {
    try {
      await this.runner(['image', 'inspect', '--format', '{{.Id}}', IMAGE_NAME])
      return true
    } catch (error) {
      if (isDockerNotFound(error)) return false
      throw error
    }
  }

  private async _inspectContainer(): Promise<{
    owned: boolean
    running: boolean
    homeMount: string | null
  } | null> {
    let output: string
    try {
      output = await this.runner([
        'inspect',
        '--format',
        '{{.Config.Labels}}|{{.State.Running}}|{{range .Mounts}}{{.Type}}:{{.Name}}:{{.Destination}};{{end}}',
        CONTAINER_NAME,
      ])
    } catch (error) {
      if (isDockerNotFound(error)) return null
      throw error
    }
    const [labels, running, mounts = ''] = output.split('|')
    const homeMount = mounts
      .split(';')
      .find((mount) => mount.endsWith(':/home/helix'))
    return {
      owned: typeof labels === 'string' && labels.includes('com.helix.desktop:1'),
      running: running === 'true',
      homeMount: homeMount?.split(':', 1)[0] ?? null,
    }
  }

  private async _getHostPort(): Promise<number> {
    const output = await this.runner(['port', CONTAINER_NAME, `${CONTAINER_PORT}/tcp`])
    const match = /^127\.0\.0\.1:(\d+)$/.exec(output.trim().split(/\r?\n/)[0] ?? '')
    if (!match) throw new Error('Docker did not return a loopback-only desktop port mapping.')
    const port = Number(match[1])
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('Docker returned an invalid desktop port.')
    }
    return port
  }

  private async _waitForAgent(port: number): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await canConnect(port)) return
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('The Docker desktop agent did not become reachable within 180 seconds.')
  }

  private async _readSessionConfig(): Promise<SessionConfig> {
    const raw = JSON.parse(await fs.readFile(this.sessionPath, 'utf8')) as Partial<SessionConfig>
    if (
      raw.runtime !== 'docker'
      || raw.container_name !== CONTAINER_NAME
      || raw.image !== IMAGE_NAME
      || typeof raw.token !== 'string'
      || !/^[a-f0-9]{64}$/.test(raw.token)
    ) {
      throw new Error('The saved Docker desktop session settings are invalid.')
    }
    return raw as SessionConfig
  }

  private async _writeSessionConfig(config: SessionConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.sessionPath), { recursive: true })
    const temporaryPath = `${this.sessionPath}.${randomBytes(8).toString('hex')}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(config), { mode: 0o600 })
    await fs.rename(temporaryPath, this.sessionPath)
  }

  private async stopIfIdle(): Promise<void> {
    const status = await this.getStatus()
    if (!status.running || !status.ready) return
    const config = await this._readSessionConfig()
    const lastActivity = Date.parse(config.last_activity_at ?? '')
    if (Number.isFinite(lastActivity) && Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
      await this.stop()
    }
  }
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const finish = (connected: boolean) => {
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

function dockerUnavailableMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  if (/ENOENT|not recognized|not found/i.test(detail)) {
    return 'Docker CLI is not installed. Install Docker Desktop and start its Linux container engine.'
  }
  return 'Docker Desktop’s Linux container engine is not running. Start Docker Desktop and retry.'
}

function isDockerNotFound(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error)
  return /no such (?:object|image|container)|not found/i.test(detail)
}
