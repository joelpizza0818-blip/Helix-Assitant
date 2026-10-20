mport test from 'node:test'
import assert from 'node:assert/strict'
import { mcpSaveErrorMessage, saveMcpServerDraft } from './mcpDraft.ts'
import { prepareSettingsSave } from '../../../hooks/settingsSave.ts'
import type { HelixSettings } from '../../../types/global'

const legacyServer = {
  name: 'legacy',
  server_url: 'https://secret.example/mcp',
  enabled: true,
}

const settingsWithLegacy = {
  mcp_servers: [legacyServer],
} as unknown as HelixSettings

test('failed MCP persistence keeps the draft and does not reset editing state', async () => {
  const draft = { name: 'remote', command: 'npx -y local-server' }
  let editingName: string | null = 'remote'
  let saved = false

  const succeeded = await saveMcpServerDraft(
    draft,
    [],
    editingName,
    async () => ({ ok: false, error: new Error('save failed') }),
    () => {
      saved = true
      editingName = null
    },
  )

  assert.equal(succeeded, false)
  assert.deepEqual(draft, { name: 'remote', command: 'npx -y local-server' })
  assert.equal(editingName, 'remote')
  assert.equal(saved, false)
})

test('non-MCP save omits legacy MCP servers from the payload and keeps them locally', () => {
  const prepared = prepareSettingsSave(settingsWithLegacy, { voice_enabled: false })

  assert.equal(prepared.ok, true)
  if (!prepared.ok) return
  assert.equal(prepared.merged.mcp_servers?.[0], legacyServer)
  assert.equal(Object.prototype.hasOwnProperty.call(prepared.payload, 'mcp_servers'), false)
})

test('explicit MCP save that retains a legacy URL fails and preserves the draft', async () => {
  const draft = { name: 'new-server', command: 'npx -y local-server' }
  let editingName: string | null = null
  let saved = false
  const prepared = prepareSettingsSave(settingsWithLegacy, {
    mcp_servers: [...settingsWithLegacy.mcp_servers!, { ...draft, enabled: true }],
  })

  assert.equal(prepared.ok, false)
  if (prepared.ok) return
  assert.match(prepared.error.message, /MCP URL transport is not supported/)
  const succeeded = await saveMcpServerDraft(
    draft,
    settingsWithLegacy.mcp_servers!,
    editingName,
    async (next) => prepareSettingsSave(settingsWithLegacy, { mcp_servers: next }),
    () => {
      saved = true
      editingName = null
    },
  )

  assert.equal(succeeded, false)
  assert.deepEqual(draft, { name: 'new-server', command: 'npx -y local-server' })
  assert.equal(editingName, null)
  assert.equal(saved, false)
})

test('stdio MCP configuration is included in explicit save payload', () => {
  const stdioServer = { name: 'local', command: 'npx -y local-server', enabled: true }
  const prepared = prepareSettingsSave(
    { mcp_servers: [] } as unknown as HelixSettings,
    { mcp_servers: [stdioServer] },
  )

  assert.equal(prepared.ok, true)
  if (!prepared.ok) return
  assert.deepEqual(prepared.payload.mcp_servers, [stdioServer])
})

test('URL transport save failures explain stdio-only support', () => {
  assert.equal(
    mcpSaveErrorMessage(new Error('MCP URL transport is not supported; configure stdio')),
    'URL-based MCP servers are not supported. Configure a local stdio launch command.',
  )
})
