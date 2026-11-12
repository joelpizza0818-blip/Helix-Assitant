import assert from 'node:assert/strict'
import test from 'node:test'
import { getHyperVPreflight } from './hyperv-preflight'

test('Hyper-V preflight rejects non-Windows hosts without invoking PowerShell', async () => {
  let invoked = false
  const result = await getHyperVPreflight('linux', async () => {
    invoked = true
    return ''
  })

  assert.equal(invoked, false)
  assert.equal(result.ready, false)
  assert.equal(result.supportedHost, false)
})

test('Hyper-V preflight reports a fully available Windows host', async () => {
  const result = await getHyperVPreflight('win32', async (encodedCommand) => {
    assert.ok(Buffer.from(encodedCommand, 'base64').toString('utf16le').includes('Get-WindowsOptionalFeature'))
    return JSON.stringify({
      edition: 'Professional',
      feature_state: 'Enabled',
      module_available: true,
      service_running: true,
    })
  })

  assert.equal(result.ready, true)
  assert.deepEqual(result.blockers, [])
})

test('Hyper-V preflight reports disabled features and their actionable blocker', async () => {
  const result = await getHyperVPreflight('win32', async () => JSON.stringify({
    edition: 'Professional',
    feature_state: 'Disabled',
    module_available: false,
    service_running: false,
    feature_error: 'Feature query requires elevation.',
  }))

  assert.equal(result.ready, false)
  assert.equal(result.featureCheckError, 'Feature query requires elevation.')
  assert.ok(result.blockers.some((blocker) => blocker.includes('Enable Hyper-V')))
  assert.ok(result.blockers.some((blocker) => blocker.includes('management tools')))
})

test('Hyper-V preflight does not guess when Windows feature state is unavailable', async () => {
  const result = await getHyperVPreflight('win32', async () => JSON.stringify({
    edition: 'Professional',
    feature_state: 'Unknown',
    module_available: false,
    service_running: null,
    feature_error: 'Access denied.',
  }))

  assert.equal(result.featureState, 'Unknown')
  assert.equal(result.ready, false)
  assert.ok(result.blockers.some((blocker) => blocker.includes('could not be verified')))
})
