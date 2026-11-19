import assert from 'node:assert/strict'
import { createServer } from 'net'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { test } from 'node:test'
import { DockerDesktopManager, type DockerRunner } from './docker-desktop-manager'

async function listenOnLoopback(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const server = createServer((socket) => socket.end())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return { server, port: address.port }
}

test('builds and starts a persistent, loopback-only desktop container', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'helix-docker-desktop-test-'))
  const imageResources = path.join(root, 'image')
  const agentDirectory = path.join(root, 'agent')
  await fs.mkdir(imageResources)
  await fs.mkdir(agentDirectory)
  await fs.writeFile(path.join(imageResources, 'Dockerfile'), 'FROM debian:trixie-slim\n')
  await fs.writeFile(path.join(imageResources, 'start-desktop.sh'), '#!/bin/sh\n')
  await fs.writeFile(path.join(agentDirectory, 'guest_agent.py'), 'agent-source\n')
  const { server, port } = await listenOnLoopback()
  let imageReady = false
  let containerExists = false
  let containerRunning = false
  let containerHasBindMount = false
  const buildContexts: string[] = []
  let runArguments: string[] = []
  const runner: DockerRunner = async (args) => {
    if (args[0] === 'info') return '27.0.0'
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (!imageReady) throw new Error('No such image')
      return 'sha256:image'
    }
    if (args[0] === 'inspect') {
      if (!containerExists) throw new Error('No such container')
      const mount = containerHasBindMount ? 'bind::/home/helix;' : ''
      return `map[com.helix.desktop:1]|${containerRunning}|${mount}`
    }
    if (args[0] === 'build') {
      imageReady = true
      const buildContext = args[args.length - 1]
      buildContexts.push(buildContext)
      assert.equal(await fs.readFile(path.join(buildContext, 'guest_agent.py'), 'utf8'), 'agent-source\n')
      return 'built'
    }
    if (args[0] === 'run') {
      runArguments = args
      containerExists = true
      containerHasBindMount = true
      return 'container-id'
    }
    if (args[0] === 'start') {
      containerRunning = true
      return 'helix-computer-desktop'
    }
    if (args[0] === 'port') return `127.0.0.1:${port}`
    throw new Error(`Unexpected Docker command: ${args.join(' ')}`)
  }
  const manager = new DockerDesktopManager(
    path.join(root, 'session.json'),
    imageResources,
    path.join(agentDirectory, 'guest_agent.py'),
    runner,
    undefined,
    root,
  )

  try {
    const status = await manager.prepare()
    assert.equal(status.ready, true)
    assert.equal(buildContexts.length, 1)
    assert.equal(runArguments[runArguments.indexOf('--publish') + 1], '127.0.0.1::8765')
    assert.ok(runArguments.includes(
      `type=bind,source=${path.join(root, 'computer-home')},target=/home/helix`,
    ))
    assert.equal(await fs.stat(path.join(root, 'computer-home')).then(() => true), true)
    assert.ok(buildContexts[0]?.startsWith(path.join(root, 'cache', 'docker-image-build')))
    const config = JSON.parse(await fs.readFile(path.join(root, 'session.json'), 'utf8'))
    assert.equal(config.runtime, 'docker')
    assert.equal(config.endpoint, `ws://127.0.0.1:${port}`)
    assert.match(config.token, /^[a-f0-9]{64}$/)
  } finally {
    manager.dispose()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('leaves an unrelated container with the reserved name untouched', async () => {
  const calls: string[][] = []
  const runner: DockerRunner = async (args) => {
    calls.push(args)
    if (args[0] === 'info') return '27.0.0'
    if (args[0] === 'inspect') return 'map[other.owner:1]|true'
    throw new Error(`Unexpected Docker command: ${args.join(' ')}`)
  }
  const manager = new DockerDesktopManager('C:\\session.json', 'C:\\image', 'C:\\agent.py', runner)

  await assert.rejects(manager.prepare(), /already exists and was not changed/)
  assert.deepEqual(calls.map((args) => args[0]), ['info', 'inspect'])
})

test('migrates the previous Docker volume into helix-storage before recreating the container', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'helix-docker-home-migration-test-'))
  const imageResources = path.join(root, 'image')
  const agentDirectory = path.join(root, 'agent')
  await fs.mkdir(imageResources)
  await fs.mkdir(agentDirectory)
  await fs.writeFile(path.join(imageResources, 'Dockerfile'), 'FROM debian:trixie-slim\n')
  await fs.writeFile(path.join(imageResources, 'start-desktop.sh'), '#!/bin/sh\n')
  await fs.writeFile(path.join(agentDirectory, 'guest_agent.py'), 'agent-source\n')
  const { server, port } = await listenOnLoopback()
  let containerExists = true
  let containerRunning = false
  let copiedHome = false
  let imageReady = true
  const calls: string[][] = []
  const runner: DockerRunner = async (args) => {
    calls.push(args)
    if (args[0] === 'info') return '27.0.0'
    if (args[0] === 'image' && args[1] === 'inspect') {
      if (!imageReady) throw new Error('No such image')
      return 'sha256:image'
    }
    if (args[0] === 'inspect') {
      if (!containerExists) throw new Error('No such container')
      const mount = copiedHome
        ? `bind::${path.join(root, 'computer-home')}`
        : 'volume:helix-computer-desktop-home:/home/helix'
      return `map[com.helix.desktop:1]|${containerRunning}|${mount.replace(path.join(root, 'computer-home'), '/home/helix')}`
    }
    if (args[0] === 'cp') {
      assert.deepEqual(args.slice(1), [
        'helix-computer-desktop:/home/helix/.',
        path.join(root, 'computer-home'),
      ])
      await fs.writeFile(path.join(root, 'computer-home', 'migrated.txt'), 'saved desktop')
      copiedHome = true
      return ''
    }
    if (args[0] === 'rm') {
      containerExists = false
      return ''
    }
    if (args[0] === 'run') {
      assert.ok(args.includes(
        `type=bind,source=${path.join(root, 'computer-home')},target=/home/helix`,
      ))
      containerExists = true
      return 'container-id'
    }
    if (args[0] === 'start') {
      containerRunning = true
      return 'helix-computer-desktop'
    }
    if (args[0] === 'port') return `127.0.0.1:${port}`
    throw new Error(`Unexpected Docker command: ${args.join(' ')}`)
  }
  const manager = new DockerDesktopManager(
    path.join(root, 'session.json'),
    imageResources,
    path.join(agentDirectory, 'guest_agent.py'),
    runner,
    undefined,
    root,
  )

  try {
    const status = await manager.prepare()
    assert.equal(status.ready, true)
    assert.equal(await fs.readFile(path.join(root, 'computer-home', 'migrated.txt'), 'utf8'), 'saved desktop')
    assert.ok(await fs.readFile(path.join(root, 'computer-home', '.helix-volume-migrated'), 'utf8'))
    assert.deepEqual(calls.map((args) => args[0]).slice(0, 4), ['info', 'inspect', 'cp', 'rm'])
  } finally {
    manager.dispose()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('does not merge old Docker home data into a non-empty helix-storage folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'helix-docker-home-conflict-test-'))
  const computerHome = path.join(root, 'computer-home')
  await fs.mkdir(computerHome)
  await fs.writeFile(path.join(computerHome, 'keep.txt'), 'existing data')
  const calls: string[][] = []
  const runner: DockerRunner = async (args) => {
    calls.push(args)
    if (args[0] === 'info') return '27.0.0'
    if (args[0] === 'inspect') {
      return 'map[com.helix.desktop:1]|false|volume:helix-computer-desktop-home:/home/helix;'
    }
    throw new Error(`Unexpected Docker command: ${args.join(' ')}`)
  }
  const manager = new DockerDesktopManager(
    path.join(root, 'session.json'),
    path.join(root, 'image'),
    path.join(root, 'guest_agent.py'),
    runner,
    undefined,
    root,
  )

  try {
    await assert.rejects(manager.prepare(), /refusing to merge Docker desktop data/)
    assert.deepEqual(calls.map((args) => args[0]), ['info', 'inspect'])
    assert.equal(await fs.readFile(path.join(computerHome, 'keep.txt'), 'utf8'), 'existing data')
  } finally {
    manager.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('installs only packages in the approved application catalog', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'helix-docker-app-install-test-'))
  const sessionPath = path.join(root, 'session.json')
  await fs.writeFile(sessionPath, JSON.stringify({
    endpoint: 'ws://127.0.0.1:49152',
    token: 'a'.repeat(64),
    runtime: 'docker',
    container_name: 'helix-computer-desktop',
    image: 'helix-computer-use:1',
    installation_complete: true,
  }))
  const calls: string[][] = []
  const runner: DockerRunner = async (args) => {
    calls.push(args)
    if (args[0] === 'info') return '27.0.0'
    if (args[0] === 'image') return 'sha256:image'
    if (args[0] === 'inspect') return 'map[com.helix.desktop:1]|true'
    return ''
  }
  const manager = new DockerDesktopManager(sessionPath, root, path.join(root, 'agent.py'), runner)
  try {
    await manager.installApps(['gimp', 'vlc'])
    assert.deepEqual(calls[4].slice(-2), ['gimp', 'vlc'])
    await assert.rejects(manager.installApps(['curl']), /approved Linux app selection is invalid/)
    assert.equal(calls.length, 5)
  } finally {
    manager.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})
