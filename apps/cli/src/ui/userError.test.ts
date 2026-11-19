import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getUserFacingError } from './userError'

test('maps connection errors without exposing exception details', () => {
  const message = getUserFacingError(
    new Error('ECONNREFUSED from internalTransport.connect at C:\\helix\\agent.py:7'),
    'No se pudo consultar la información. Comprueba que HELIX esté conectado.',
  )

  assert.match(message, /Comprueba tu conexión/)
  assert.doesNotMatch(message, /internalTransport|agent\.py/)
})
