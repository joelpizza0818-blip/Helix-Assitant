import assert from 'node:assert/strict'
import fsSync from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { test } from 'node:test'
import { migrateUserData, resolveHelixStoragePaths } from './storage-paths'

test('places generated data under helix-storage on the desktop', () => {
  const desktopPath = path.join('users', 'Helix', 'Desktop')
  const paths = resolveHelixStoragePaths(desktopPath)

  assert.equal(paths.root, path.resolve(desktopPath, 'helix-storage'))
  assert.equal(paths.appData, path.join(paths.root, 'desktop'))
  assert.equal(paths.cache, path.join(paths.root, 'cache'))
  assert.equal(paths.logs, path.join(paths.root, 'logs'))
  assert.equal(paths.temp, path.join(paths.root, 'temp'))
  assert.equal(paths.models, path.join(paths.root, 'models'))
  assert.equal(paths.binaries, path.join(paths.root, 'bin'))
  assert.equal(paths.agent, path.join(paths.root, 'agent'))
  assert.equal(paths.computerHome, path.join(paths.root, 'computer-home'))
})

test('respects an explicitly configured storage root', () => {
  const configuredRoot = path.join('custom-drive', 'HELIX Data')
  const paths = resolveHelixStoragePaths(
    path.join('users', 'Helix', 'Desktop'),
    configuredRoot,
  )

  assert.equal(paths.root, path.resolve(configuredRoot))
  assert.equal(paths.models, path.join(paths.root, 'models'))
})

test('migrates app settings while leaving large model and binary folders in place', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'helix-storage-migration-test-'))
  const source = path.join(root, 'old-user-data')
  const destination = path.join(root, 'helix-storage', 'desktop')
  await fs.mkdir(path.join(source, 'models'), { recursive: true })
  await fs.mkdir(path.join(source, 'bin'), { recursive: true })
  await fs.writeFile(path.join(source, 'settings.json'), '{"theme":"dark"}')
  await fs.writeFile(path.join(source, 'models', 'agent.gguf'), 'large model')
  await fs.writeFile(path.join(source, 'bin', 'llama-server.exe'), 'runtime')

  try {
    assert.equal(migrateUserData(source, destination), true)
    assert.equal(
      await fs.readFile(path.join(destination, 'settings.json'), 'utf8'),
      '{"theme":"dark"}',
    )
    assert.equal(fsSync.existsSync(path.join(destination, 'models')), false)
    assert.equal(fsSync.existsSync(path.join(destination, 'bin')), false)
    assert.equal(fsSync.existsSync(path.join(source, 'models', 'agent.gguf')), true)
    assert.equal(migrateUserData(source, destination), false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
