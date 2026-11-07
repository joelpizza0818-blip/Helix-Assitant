import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedAnnouncementUrl, isExternalAnnouncementUrl, isHttpsUrl } from './url-validation.ts'

test('allows same-origin paths and credential-free HTTPS URLs', () => {
  assert.equal(isAllowedAnnouncementUrl('/download?edition=normal'), true)
  assert.equal(isExternalAnnouncementUrl('/download'), false)
  assert.equal(isExternalAnnouncementUrl(' https://github.com/helix '), true)
  assert.equal(isHttpsUrl('https://github.com/releases'), true)
})

test('rejects script, protocol-relative, backslash, credential and control-character URLs', () => {
  assert.equal(isAllowedAnnouncementUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedAnnouncementUrl('//attacker.example/path'), false)
  assert.equal(isAllowedAnnouncementUrl('/\\\\attacker.example'), false)
  assert.equal(isAllowedAnnouncementUrl('/%5c%5cattacker.example'), false)
  assert.equal(isHttpsUrl('https://user:pass@attacker.example'), false)
  assert.equal(isHttpsUrl('https://safe.example/\r\nheader'), false)
})
