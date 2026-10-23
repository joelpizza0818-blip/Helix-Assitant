import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import {
  CapabilityManager,
  validatePackManifest,
  verifyPackManifest,
  type CapabilityPackManifest,
} from './capability-manager'

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function publicKeyBase64(publicKey: KeyObject): string {
  return publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64')
}

function makeManifest(
  privateKey: KeyObject,
  overrides: Partial<CapabilityPackManifest> = {},
): CapabilityPackManifest {
  const unsigned: Omit<CapabilityPackManifest, 'signature'> = {
    arch: 'x64' as const,
    capability: 'vision',
    coreVersionRange: '*',
    format: 'python-plugin',
    id: 'vision',
    platform: 'win32' as const,
    requiredForComplete: false,
    sha256: 'a'.repeat(64),
    sizeBytes: 4,
    url: 'https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/capability-packs/vision-1.0.0.py',
    version: '1.0.0',
    ...overrides,
  }
  const signature = sign(null, Buffer.from(canonicalJson(unsigned), 'utf8'), privateKey).toString('base64')
  return { ...unsigned, signature }
}

function testManagerOptions(publicKey?: string) {
  return { publicKey, platform: 'win32' as const, arch: 'x64' as const }
}

test('rejects unsigned or unsafe capability manifests', () => {
  assert.throws(() => validatePackManifest({} as CapabilityPackManifest), /invalid capability pack id/i)
  assert.throws(() => validatePackManifest({
    id: '../escape', version: '1', capability: 'vision', platform: 'win32', arch: 'x64',
    format: 'python-plugin', requiredForComplete: false, coreVersionRange: '*', sizeBytes: 1,
    url: 'http://example.test', sha256: 'a'.repeat(64), signature: 'x',
  }), /invalid capability pack id/i)
})

test('rejects capability packs outside the trusted signed release', () => {
  const keys = generateKeyPairSync('ed25519')
  assert.throws(() => validatePackManifest(makeManifest(keys.privateKey, {
    url: 'https://downloads.example.test/vision.py',
  })), /trusted capability release/i)
})

test('drops cached manifests whose signatures no longer verify', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helix-capability-tampered-state-'))
  try {
    const keys = generateKeyPairSync('ed25519')
    const publicKey = publicKeyBase64(keys.publicKey)
    const manifest = makeManifest(keys.privateKey, { sha256: 'b'.repeat(64) })
    manifest.sha256 = 'c'.repeat(64)
    const stateDirectory = path.join(root, 'capabilities')
    await mkdir(stateDirectory, { recursive: true })
    await writeFile(path.join(stateDirectory, 'state.json'), JSON.stringify({
      profile: 'progressive',
      manifests: [manifest],
    }))

    const manager = new CapabilityManager(root, '0.1.9', testManagerOptions(publicKey))
    await manager.load()

    assert.equal(manager.getProfile(), 'progressive')
    assert.equal(manager.getManifest('vision'), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('persists progressive profile and reports signed catalog entries as missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helix-capability-test-'))
  try {
    const keys = generateKeyPairSync('ed25519')
    const publicKey = publicKeyBase64(keys.publicKey)
    const manager = new CapabilityManager(root, '0.1.9', testManagerOptions(publicKey))
    const signed = makeManifest(keys.privateKey)
    assert.equal(verifyPackManifest(signed, publicKey), true)
    await manager.load()
    manager.registerManifest(signed)
    const snapshot = await manager.setProfile('progressive')
    assert.equal(snapshot.profile, 'progressive')
    assert.equal(snapshot.missingCount, 1)
    assert.equal(snapshot.requiredMissingCount, 0)
    assert.equal(snapshot.packs[0].status, 'missing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('marks packs outside the signed core version range as incompatible', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helix-capability-range-'))
  try {
    const keys = generateKeyPairSync('ed25519')
    const publicKey = publicKeyBase64(keys.publicKey)
    const manager = new CapabilityManager(root, '0.1.9', testManagerOptions(publicKey))
    const manifest = makeManifest(keys.privateKey, { coreVersionRange: '^2.0.0' })
    manager.registerManifest(manifest)
    assert.equal((await manager.setProfile('progressive')).packs[0].status, 'incompatible')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('does not treat a complete profile as proof that a capability pack is installed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helix-capability-complete-'))
  try {
    const keys = generateKeyPairSync('ed25519')
    const publicKey = publicKeyBase64(keys.publicKey)
    const manager = new CapabilityManager(root, '0.1.9', testManagerOptions(publicKey))
    await manager.load()
    await manager.setProfile('complete')
    assert.equal(manager.isPackInstalled('vision'), false)

    manager.registerManifest(makeManifest(keys.privateKey))
    assert.equal(manager.isPackInstalled('vision'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('complete release builds reject progressive selection and normalize saved profiles', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helix-capability-release-'))
  try {
    const developmentManager = new CapabilityManager(root, '0.1.9', testManagerOptions())
    await developmentManager.load()
    await developmentManager.setProfile('progressive')

    const releaseManager = new CapabilityManager(root, '0.1.9', { ...testManagerOptions(), progressiveEnabled: false })
    await releaseManager.load()
    assert.equal(releaseManager.getProfile(), 'complete')
    await assert.rejects(releaseManager.setProfile('progressive'), /not enabled in this build/i)
    await assert.rejects(
      releaseManager.installPack(makeManifest(generateKeyPairSync('ed25519').privateKey)),
      /not enabled in this build/i,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('coalesces simultaneous installs and reuses the verified installed pack', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helix-capability-coalesced-'))
  const originalFetch = globalThis.fetch
  try {
    const keys = generateKeyPairSync('ed25519')
    const publicKey = publicKeyBase64(keys.publicKey)
    const bytes = Buffer.from('signed plugin fixture')
    const manifest = makeManifest(keys.privateKey, {
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    const manager = new CapabilityManager(root, '0.1.9', testManagerOptions(publicKey))
    await manager.load()
    await manager.setProfile('progressive')
    let downloadCount = 0
    globalThis.fetch = async (_input, init) => {
      downloadCount += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(init?.signal?.aborted, false)
      return new Response(bytes)
    }

    const [first, second] = await Promise.all([
      manager.installPack(manifest),
      manager.installPack(manifest),
    ])

    assert.equal(downloadCount, 1)
    assert.equal(first.status, 'installed')
    assert.equal(second.status, 'installed')
    assert.equal(first.installedPath, second.installedPath)
    assert.deepEqual(await readFile(first.installedPath!), bytes)

    globalThis.fetch = async () => {
      throw new Error('An already verified pack should not be downloaded again.')
    }
    const reused = await manager.installPack(manifest)
    assert.equal(reused.status, 'installed')
    assert.equal(downloadCount, 1)
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})

test('cancels an in-flight install and removes its staged file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helix-capability-cancel-'))
  const originalFetch = globalThis.fetch
  try {
    const keys = generateKeyPairSync('ed25519')
    const publicKey = publicKeyBase64(keys.publicKey)
    const bytes = Buffer.from('signed plugin fixture')
    const manifest = makeManifest(keys.privateKey, {
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    const manager = new CapabilityManager(root, '0.1.9', testManagerOptions(publicKey))
    await manager.load()
    await manager.setProfile('progressive')
    let signal: AbortSignal | undefined
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      signal = init?.signal as AbortSignal
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })

    const install = manager.installPack(manifest)
    while (!signal) await new Promise((resolve) => setTimeout(resolve, 1))
    assert.equal(manager.cancelPack(manifest.id), true)
    await assert.rejects(install, /installation was canceled/i)
    assert.equal(manager.cancelPack(manifest.id), false)
    await assert.rejects(readFile(path.join(root, 'capabilities', 'staging', `${manifest.id}-${manifest.version}.download`)))
    assert.equal(manager.isPackInstalled(manifest.id), false)
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})
