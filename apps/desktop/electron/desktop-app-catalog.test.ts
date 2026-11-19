import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  detectDesktopApps,
  getApprovedDesktopAppPackages,
} from './desktop-app-catalog'

test('detects installed apps from registry, Start Menu, and Appx sources without exposing paths', async () => {
  let script = ''
  const apps = await detectDesktopApps('win32', async (encodedCommand) => {
    script = Buffer.from(encodedCommand, 'base64').toString('utf16le')
    return JSON.stringify([
      'Google Chrome',
      'Microsoft Office 365',
      'Google Chrome',
      'Unknown Tool',
    ])
  })

  assert.match(script, /CurrentVersion\\Uninstall/)
  assert.match(script, /Start Menu\\Programs/)
  assert.match(script, /Get-AppxPackage/)
  assert.deepEqual(apps.map((app) => [app.sourceName, app.equivalent, app.packageName]), [
    ['Google Chrome', 'Firefox ESR', 'firefox-esr'],
    ['Microsoft Office 365', 'LibreOffice', 'libreoffice'],
    ['Unknown Tool', null, null],
  ])
})

test('rejects unknown Linux application package identifiers', () => {
  assert.deepEqual(
    getApprovedDesktopAppPackages(['gimp', 'gimp', 'vlc']),
    ['gimp', 'vlc'],
  )
  assert.throws(
    () => getApprovedDesktopAppPackages(['curl']),
    /not supported/,
  )
  assert.throws(
    () => getApprovedDesktopAppPackages(['gimp; rm -rf /']),
    /invalid/,
  )
})

test('does not run Windows app detection on a different host OS', async () => {
  await assert.rejects(
    detectDesktopApps('linux', async () => {
      throw new Error('must not invoke Windows commands')
    }),
    /only on Windows/,
  )
})
