import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isSupportedMediaRequest,
  isSupportedMediaType,
  isTrustedRendererRequest,
} from './media-permissions'

test('only grants permission requests from the configured development origin', () => {
  assert.equal(
    isTrustedRendererRequest(
      'http://127.0.0.1:5173/',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5173',
    ),
    true,
  )
  assert.equal(
    isTrustedRendererRequest(
      'https://untrusted.example/',
      'https://untrusted.example',
      'http://127.0.0.1:5173',
    ),
    false,
  )
  assert.equal(
    isTrustedRendererRequest(
      'http://127.0.0.1:5173/',
      'https://untrusted.example',
      'http://127.0.0.1:5173',
    ),
    false,
  )
})

test('only trusts the packaged renderer file, not another file URL', () => {
  assert.equal(
    isTrustedRendererRequest(
      'file:///C:/Program%20Files/HELIX/dist/index.html',
      'file://',
      'file:///C:/Program%20Files/HELIX/dist/index.html',
    ),
    true,
  )
  assert.equal(
    isTrustedRendererRequest(
      'file:///C:/Users/Public/untrusted.html',
      'file://',
      'file:///C:/Program%20Files/HELIX/dist/index.html',
    ),
    false,
  )
})

test('only requests for audio and video media are eligible', () => {
  assert.equal(isSupportedMediaRequest(['audio', 'video']), true)
  assert.equal(isSupportedMediaRequest([]), false)
  assert.equal(isSupportedMediaRequest(undefined), false)
  assert.equal(isSupportedMediaRequest(['unknown']), false)
  assert.equal(isSupportedMediaType('audio'), true)
  assert.equal(isSupportedMediaType('unknown'), false)
})
