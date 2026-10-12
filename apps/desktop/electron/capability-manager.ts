import { createHash, createPublicKey, verify } from 'crypto'
import { createWriteStream, promises as fs, readFileSync, statSync } from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

export type InstallationProfile = 'progressive' | 'complete'
export type CapabilityPackStatus = 'installed' | 'missing' | 'incompatible' | 'error'

export interface CapabilityPackManifest {
  id: string
  version: string
  capability: string
  format: 'python-plugin'
  requiredForComplete: boolean
  platform: 'win32'
  arch: 'x64' | 'arm64'
  coreVersionRange: string
  sizeBytes: number
  url: string
  sha256: string
  signature: string
}

export interface CapabilityPackState extends CapabilityPackManifest {
  status: CapabilityPackStatus
  installedPath?: string
  error?: string
}

export interface CapabilitySnapshot {
  profile: InstallationProfile
  packs: CapabilityPackState[]
  missingCount: number
  requiredMissingCount: number
  ready: boolean
}

interface PersistedState {
  profile: InstallationProfile
  manifests: CapabilityPackManifest[]
}

interface SignedCatalog {
  version: number
  packs: CapabilityPackManifest[]
  signature: string
}

interface CapabilityManagerOptions {
  publicKey?: string
  manifestUrl?: string
  progressiveEnabled?: boolean
  onProgress?: (progress: CapabilityDownloadProgress) => void
}

export interface CapabilityDownloadProgress {
  id: string
  receivedBytes: number
  totalBytes: number
}

const MAX_PACK_BYTES = 16 * 1024 * 1024
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const CATALOG_ASSET_BASE = 'https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/capability-packs/'

type Semver = [number, number, number]

function parseSemver(value: string): Semver | null {
  const match = value.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compareSemver(left: Semver, right: Semver): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function satisfiesCoreVersion(version: string, range: string): boolean {
  if (range.trim() === '*' || range.trim() === '') return true
  const current = parseSemver(version)
  if (!current) return false
  return range.trim().split(/\s+/).every((constraint) => {
    const match = constraint.match(/^(\^|~|>=|<=|>|<|=)?(.+)$/)
    if (!match) return false
    const operator = match[1] || '='
    const target = parseSemver(match[2])
    if (!target) return false
    const comparison = compareSemver(current, target)
    if (operator === '^') {
      const sameCompatibleLine = target[0] > 0
        ? current[0] === target[0]
        : target[1] > 0
          ? current[0] === 0 && current[1] === target[1]
          : current[0] === 0 && current[1] === 0 && current[2] === target[2]
      return comparison >= 0 && sameCompatibleLine
    }
    if (operator === '~') return comparison >= 0 && current[0] === target[0] && current[1] === target[1]
    if (operator === '>=') return comparison >= 0
    if (operator === '<=') return comparison <= 0
    if (operator === '>') return comparison > 0
    if (operator === '<') return comparison < 0
    return comparison === 0
  })
}

function canonicalManifest(manifest: CapabilityPackManifest): string {
  const { signature: _signature, ...unsignedManifest } = manifest
  return canonicalJson(unsignedManifest)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function safePackId(id: string): boolean {
  return ID_PATTERN.test(id) && id !== '.' && id !== '..'
}

export function validatePackManifest(manifest: CapabilityPackManifest): void {
  if (!manifest || typeof manifest.id !== 'string' || !safePackId(manifest.id)) throw new Error('Invalid capability pack id.')
  if (typeof manifest.version !== 'string' || typeof manifest.capability !== 'string' || !manifest.version || !manifest.capability) {
    throw new Error('Capability pack metadata is incomplete.')
  }
  if (manifest.format !== 'python-plugin') throw new Error('Unsupported capability pack format.')
  if (manifest.platform !== 'win32' || !['x64', 'arm64'].includes(manifest.arch)) {
    throw new Error('Capability pack platform or architecture is not supported.')
  }
  if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes <= 0 || manifest.sizeBytes > MAX_PACK_BYTES) {
    throw new Error('Capability pack size is outside the allowed limit.')
  }
  if (!/^https:\/\//i.test(manifest.url)) throw new Error('Capability pack URL must use HTTPS.')
  if (!SHA256_PATTERN.test(manifest.sha256)) throw new Error('Capability pack hash is invalid.')
  if (!manifest.signature) throw new Error('Capability pack signature is missing.')
}

export function verifyPackManifest(manifest: CapabilityPackManifest, publicKey: string): boolean {
  validatePackManifest(manifest)
  if (!publicKey.trim()) throw new Error('Capability pack public key is not configured.')
  try {
    return verify(
      null,
      Buffer.from(canonicalManifest(manifest), 'utf8'),
      createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          Buffer.from(publicKey, 'base64'),
        ]),
        format: 'der',
        type: 'spki',
      }),
      Buffer.from(manifest.signature, 'base64'),
    )
  } catch (error) {
    throw new Error(`Capability pack signature could not be verified: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export class CapabilityManager {
  private readonly statePath: string
  private readonly packsRoot: string
  private readonly publicKey: string
  private readonly manifestUrl: string
  private readonly coreVersion: string
  private readonly progressiveEnabled: boolean
  private readonly onProgress?: (progress: CapabilityDownloadProgress) => void
  private state: PersistedState = { profile: 'complete', manifests: [] }
  private activeDownloads = new Map<string, AbortController>()

  constructor(
    userDataPath: string,
    coreVersion: string,
    options: CapabilityManagerOptions = {},
  ) {
    this.statePath = path.join(userDataPath, 'capabilities', 'state.json')
    this.packsRoot = path.join(userDataPath, 'capabilities', 'packs')
    this.publicKey = options.publicKey ?? process.env.HELIX_CAPABILITY_PUBLIC_KEY ?? ''
    this.manifestUrl = options.manifestUrl ?? process.env.HELIX_CAPABILITY_MANIFEST_URL ?? ''
    this.coreVersion = coreVersion
    this.progressiveEnabled = options.progressiveEnabled ?? true
    this.onProgress = options.onProgress
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8')) as Partial<PersistedState>
      this.state = {
        profile: this.progressiveEnabled && parsed.profile === 'progressive' ? 'progressive' : 'complete',
        manifests: Array.isArray(parsed.manifests) ? parsed.manifests : [],
      }
    } catch {
      this.state = { profile: 'complete', manifests: [] }
    }
  }

  async setProfile(profile: InstallationProfile): Promise<CapabilitySnapshot> {
    if (profile === 'progressive' && !this.progressiveEnabled) {
      throw new Error('Progressive installation is not enabled in this build.')
    }
    this.state.profile = profile
    await this.persist()
    return this.snapshot()
  }

  getProfile(): InstallationProfile { return this.state.profile }

  getManifest(id: string): CapabilityPackManifest | null {
    return this.state.manifests.find((manifest) => manifest.id === id) ?? null
  }

  isPackInstalled(id: string): boolean {
    return this.snapshot().packs.some((pack) => pack.id === id && pack.status === 'installed')
  }

  registerManifest(manifest: CapabilityPackManifest): void {
    validatePackManifest(manifest)
    const current = this.state.manifests.filter((item) => item.id !== manifest.id)
    this.state.manifests = [...current, manifest]
  }

  async saveManifestCatalog(manifests: CapabilityPackManifest[]): Promise<CapabilitySnapshot> {
    manifests.forEach((manifest) => {
      if (!verifyPackManifest(manifest, this.publicKey)) throw new Error(`Invalid signature for pack ${manifest.id}.`)
    })
    this.state.manifests = manifests
    await this.persist()
    return this.snapshot()
  }

  async refreshCatalog(): Promise<CapabilitySnapshot> {
    if (!this.manifestUrl) return this.snapshot()
    if (!/^https:\/\//i.test(this.manifestUrl)) throw new Error('Capability catalog URL must use HTTPS.')
    const response = await fetch(this.manifestUrl, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`Capability catalog failed with HTTP ${response.status}.`)
    const payload = await response.json() as Partial<SignedCatalog>
    if (payload.version !== 1 || !Array.isArray(payload.packs) || typeof payload.signature !== 'string') {
      throw new Error('Capability catalog has an invalid shape.')
    }
    const { signature, ...unsignedCatalog } = payload as SignedCatalog
    if (!this.verifySignature(canonicalJson(unsignedCatalog), signature)) {
      throw new Error('Capability catalog signature verification failed.')
    }
    for (const manifest of payload.packs) {
      if (!manifest.url.startsWith(CATALOG_ASSET_BASE)) {
        throw new Error(`Pack ${manifest.id} is not hosted in the trusted capability release.`)
      }
    }
    return this.saveManifestCatalog(payload.packs)
  }

  snapshot(): CapabilitySnapshot {
    const packs = this.state.manifests.map((manifest): CapabilityPackState => {
      const installedPath = this.packPath(manifest)
      const status = this.isCompatible(manifest)
        ? this.isPackFileValid(installedPath, manifest) ? 'installed' : 'missing'
        : 'incompatible'
      return { ...manifest, status, ...(status === 'installed' ? { installedPath } : {}) }
    })
    const missingCount = packs.filter((pack) => pack.status !== 'installed').length
    const requiredMissingCount = packs.filter(
      (pack) => pack.requiredForComplete && pack.status !== 'installed',
    ).length
    return {
      profile: this.state.profile,
      packs,
      missingCount,
      requiredMissingCount,
      ready: requiredMissingCount === 0,
    }
  }

  async installPack(manifest: CapabilityPackManifest): Promise<CapabilityPackState> {
    if (!this.progressiveEnabled) throw new Error('Capability pack installation is not enabled in this build.')
    if (!verifyPackManifest(manifest, this.publicKey)) throw new Error(`Invalid signature for pack ${manifest.id}.`)
    if (!this.isCompatible(manifest)) throw new Error(`Pack ${manifest.id} is incompatible with this HELIX build.`)
    const existing = this.snapshot().packs.find((pack) => pack.id === manifest.id && pack.status === 'installed')
    if (existing?.version === manifest.version) return existing
    if (this.activeDownloads.has(manifest.id)) throw new Error(`Pack ${manifest.id} is already downloading.`)

    const controller = new AbortController()
    this.activeDownloads.set(manifest.id, controller)
    const stagingRoot = path.join(path.dirname(this.packsRoot), 'staging')
    const temporaryPath = path.join(stagingRoot, `${manifest.id}-${manifest.version}.download`)
    try {
      await fs.mkdir(stagingRoot, { recursive: true })
      await fs.rm(temporaryPath, { force: true })
      const response = await fetch(manifest.url, { signal: controller.signal })
      if (!response.ok || !response.body) throw new Error(`Pack download failed with HTTP ${response.status}.`)
      const contentLength = Number(response.headers.get('content-length') || 0)
      if (contentLength > MAX_PACK_BYTES || (contentLength > 0 && contentLength !== manifest.sizeBytes)) {
        throw new Error('Pack download size does not match its signed manifest.')
      }
      let received = 0
      let lastProgressAt = 0
      const hasher = createHash('sha256')
      const source = Readable.fromWeb(response.body as never)
      source.on('data', (chunk: Buffer) => {
        received += chunk.length
        hasher.update(chunk)
        const now = Date.now()
        if (now - lastProgressAt >= 100) {
          lastProgressAt = now
          this.onProgress?.({ id: manifest.id, receivedBytes: received, totalBytes: manifest.sizeBytes })
        }
        if (received > manifest.sizeBytes || received > MAX_PACK_BYTES) controller.abort()
      })
      await pipeline(source, createWriteStream(temporaryPath, { flags: 'wx' }))
      this.onProgress?.({ id: manifest.id, receivedBytes: received, totalBytes: manifest.sizeBytes })
      if (received !== manifest.sizeBytes || hasher.digest('hex').toLowerCase() !== manifest.sha256.toLowerCase()) {
        throw new Error('Pack hash or size verification failed.')
      }
      const destination = this.packPath(manifest)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      const backupPath = `${destination}.backup`
      await fs.rm(backupPath, { force: true })
      let backedUp = false
      try {
        await fs.rename(destination, backupPath)
        backedUp = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      try {
        await fs.rename(temporaryPath, destination)
      } catch (error) {
        if (backedUp) {
          try {
            await fs.rename(backupPath, destination)
          } catch (restoreError) {
            throw new Error(
              `Could not activate capability pack ${manifest.id}: ${String(error)}. `
              + `Restoring the previous version also failed: ${String(restoreError)}`,
            )
          }
        }
        throw error
      }
      if (backedUp) await fs.rm(backupPath, { force: true })
      this.registerManifest(manifest)
      await this.persist()
      return { ...manifest, status: 'installed', installedPath: destination }
    } finally {
      this.activeDownloads.delete(manifest.id)
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  cancelPack(id: string): boolean {
    const controller = this.activeDownloads.get(id)
    if (!controller) return false
    controller.abort()
    return true
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true })
    const temporaryPath = `${this.statePath}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8')
    await fs.rm(this.statePath, { force: true })
    await fs.rename(temporaryPath, this.statePath)
  }

  private packPath(manifest: CapabilityPackManifest): string {
    if (!safePackId(manifest.id)) throw new Error('Unsafe capability pack path.')
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid capability pack version.')
    return path.join(this.packsRoot, manifest.id, `${manifest.version}.py`)
  }

  private isCompatible(manifest: CapabilityPackManifest): boolean {
    return manifest.platform === process.platform
      && manifest.arch === process.arch
      && satisfiesCoreVersion(this.coreVersion, manifest.coreVersionRange)
  }

  private verifySignature(message: string, signature: string): boolean {
    if (!this.publicKey.trim()) throw new Error('Capability pack public key is not configured.')
    try {
      return verify(
        null,
        Buffer.from(message, 'utf8'),
        createPublicKey({
          key: Buffer.concat([
            Buffer.from('302a300506032b6570032100', 'hex'),
            Buffer.from(this.publicKey, 'base64'),
          ]),
          format: 'der',
          type: 'spki',
        }),
        Buffer.from(signature, 'base64'),
      )
    } catch (error) {
      throw new Error(`Capability signature could not be verified: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private isPackFileValid(filePath: string, manifest: CapabilityPackManifest): boolean {
    try {
      const stats = statSync(filePath)
      if (!stats.isFile() || stats.size !== manifest.sizeBytes) return false
      return createHash('sha256').update(readFileSync(filePath)).digest('hex').toLowerCase()
        === manifest.sha256.toLowerCase()
    } catch {
      return false
    }
  }
}
