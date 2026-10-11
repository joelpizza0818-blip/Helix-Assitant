import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import {
  CapabilityManager,
  validatePackManifest,
  verifyPackManifest,
  type CapabilityPackManifest,
} from './capability-manager'

function makeManifest(publicKeyPem: string): CapabilityPackManifest {
  const unsigned = {
    arch: 'x64' as const,
    capability: 'vision',
    coreVersionRange: '*',
    id: 'vision',
    platform: 'win32' as const,
    sha256: 'a'.repeat(64),
    sizeBytes: 4,
    url: 'https://example.test/vision.pack',
    version: '1.0.0',
  }
  const privateKey = generateKeyPairSync('ed25519').privateKey
  const signature = sign(null, Buffer.from(JSON.stringify(unsigned), 'utf8'), privateKey).toString('base64')
  void publicKeyPem
  return { ...unsigned, signature }
}

test('rejects unsigned or unsafe capability manifests', () => {
  assert.throws(() => validatePackManifest({} as CapabilityPackManifest), /invalid capability pack id/i)
  assert.throws(() => validatePackManifest({
    id: '../escape', version: '1', capability: 'vision', platform: 'win32', arch: 'x64',
    coreVersionRange: '*', sizeBytes: 1, url: 'http://example.test', sha256: 'a'.repeat(64), signature: 'x',
  }), /invalid capability pack id/i)
})

test('persists progressive profile and reports signed catalog entries as missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helix-capability-test-'))
  try {
    const keys = generateKeyPairSync('ed25519')
    const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const manager = new CapabilityManager(root, '0.1.9', { publicKeyPem })
    const manifest = makeManifest(publicKeyPem)
    // Re-sign with the private key matching the public key used by the manager.
    const unsigned = { ...manifest }
    delete (unsigned as Partial<CapabilityPackManifest>).signature
    const signature = sign(null, Buffer.from(JSON.stringify({
      arch: unsigned.arch, capability: unsigned.capability, coreVersionRange: unsigned.coreVersionRange,
      id: unsigned.id, platform: unsigned.platform, sha256: unsigned.sha256, sizeBytes: unsigned.sizeBytes,
      url: unsigned.url, version: unsigned.version,
    }), 'utf8'), keys.privateKey).toString('base64')
    const signed = { ...manifest, signature }
    assert.equal(verifyPackManifest(signed, publicKeyPem), true)
    await manager.load()
    manager.registerManifest(signed)
    const snapshot = await manager.setProfile('progressive')
    assert.equal(snapshot.profile, 'progressive')
    assert.equal(snapshot.missingCount, 1)
    assert.equal(snapshot.packs[0].status, 'missing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('marks packs outside the signed core version range as incompatible', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helix-capability-range-'))
  try {
    const keys = generateKeyPairSync('ed25519')
    const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const manager = new CapabilityManager(root, '0.1.9', { publicKeyPem })
    const manifest = makeManifest(publicKeyPem)
    manifest.coreVersionRange = '^2.0.0'
    const unsigned = { ...manifest }
    delete (unsigned as Partial<CapabilityPackManifest>).signature
    manifest.signature = sign(null, Buffer.from(JSON.stringify({
      arch: unsigned.arch, capability: unsigned.capability, coreVersionRange: unsigned.coreVersionRange,
      id: unsigned.id, platform: unsigned.platform, sha256: unsigned.sha256, sizeBytes: unsigned.sizeBytes,
      url: unsigned.url, version: unsigned.version,
    }), 'utf8'), keys.privateKey).toString('base64')
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
    const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const manager = new CapabilityManager(root, '0.1.9', { publicKeyPem })
    await manager.load()
    await manager.setProfile('complete')
    assert.equal(manager.isPackInstalled('vision'), false)

    manager.registerManifest(makeManifest(publicKeyPem))
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
      releaseManager.installPack(makeManifest('')),
      /not enabled in this build/i,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
