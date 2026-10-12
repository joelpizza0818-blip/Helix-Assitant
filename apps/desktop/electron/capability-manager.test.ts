import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
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

test('rejects unsigned or unsafe capability manifests', () => {
  assert.throws(() => validatePackManifest({} as CapabilityPackManifest), /invalid capability pack id/i)
  assert.throws(() => validatePackManifest({
    id: '../escape', version: '1', capability: 'vision', platform: 'win32', arch: 'x64',
    format: 'python-plugin', requiredForComplete: false, coreVersionRange: '*', sizeBytes: 1,
    url: 'http://example.test', sha256: 'a'.repeat(64), signature: 'x',
  }), /invalid capability pack id/i)
})

test('persists progressive profile and reports signed catalog entries as missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helix-capability-test-'))
  try {
    const keys = generateKeyPairSync('ed25519')
    const publicKey = publicKeyBase64(keys.publicKey)
    const manager = new CapabilityManager(root, '0.1.9', { publicKey })
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
    const manager = new CapabilityManager(root, '0.1.9', { publicKey })
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
    const manager = new CapabilityManager(root, '0.1.9', { publicKey })
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
    const developmentManager = new CapabilityManager(root, '0.1.9')
    await developmentManager.load()
    await developmentManager.setProfile('progressive')

    const releaseManager = new CapabilityManager(root, '0.1.9', { progressiveEnabled: false })
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
