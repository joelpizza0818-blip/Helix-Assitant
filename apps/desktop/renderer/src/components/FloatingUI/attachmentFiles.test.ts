mport test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_ATTACHMENT_ACCEPT,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENTS,
  getAttachmentMimeType,
  validateAttachmentSelection,
} from './attachmentFiles'

test('attachment picker includes supported multimodal image formats', () => {
  assert.match(CHAT_ATTACHMENT_ACCEPT, /image\/jpeg/)
  assert.match(CHAT_ATTACHMENT_ACCEPT, /image\/png/)
  assert.match(CHAT_ATTACHMENT_ACCEPT, /image\/webp/)
  assert.match(CHAT_ATTACHMENT_ACCEPT, /image\/gif/)
})

test('attachment validation enforces the bridge file-count and byte limits', () => {
  const existing = Array.from({ length: MAX_CHAT_ATTACHMENTS }, () => ({
    name: 'note.txt',
    size: 1,
    type: 'text/plain',
  }))
  assert.match(
    validateAttachmentSelection(existing, [
      { name: 'photo.png', size: 1, type: 'image/png' },
    ]) ?? '',
    /no more than/,
  )

  assert.match(
    validateAttachmentSelection([], [
      {
        name: 'large.png',
        size: MAX_CHAT_ATTACHMENT_BYTES + 1,
        type: 'image/png',
      },
    ]) ?? '',
    /8 MB/,
  )

  assert.equal(
    validateAttachmentSelection([], [
      { name: 'photo.png', size: 10, type: 'image/png' },
    ]),
    null,
  )
})

test('attachment validation rejects image formats unsupported by model APIs', () => {
  assert.match(
    validateAttachmentSelection([], [
      { name: 'photo.tiff', size: 10, type: 'image/tiff' },
    ]) ?? '',
    /JPEG, PNG, GIF, or WebP/,
  )
})

test('image MIME type falls back to a known extension when the browser omits it', () => {
  assert.equal(
    getAttachmentMimeType({ name: 'photo.jpeg', size: 10, type: '' }),
    'image/jpeg',
  )
  assert.equal(
    getAttachmentMimeType({ name: 'document.bin', size: 10, type: '' }),
    'application/octet-stream',
  )
})
