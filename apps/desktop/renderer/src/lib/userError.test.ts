import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getUserFacingError } from './userError'

test('maps common technical failures to clear user-facing guidance', () => {
  assert.match(
    getUserFacingError(new Error('ETIMEDOUT in internalCall()'), 'Fallback'),
    /tardó demasiado/,
  )
  assert.match(
    getUserFacingError(new Error('ECONNREFUSED internal_module.run'), 'Fallback'),
    /Comprueba tu conexión/,
  )
})

test('does not expose raw exception text or code symbols', () => {
  const message = getUserFacingError(
    new Error('internal_module.run failed at C:\\agent\\private.py:42'),
    'No se pudo completar la operación. Revisa la configuración e inténtalo de nuevo.',
  )

  assert.equal(
    message,
    'No se pudo completar la operación. Revisa la configuración e inténtalo de nuevo.',
  )
  assert.doesNotMatch(message, /internal_module|private\.py|run failed/)
})

test('turns Docker desktop failures into clear, safe guidance', () => {
  assert.equal(
    getUserFacingError(
      new Error('Docker Desktop’s Linux container engine is not running.'),
      'Fallback',
    ),
    'Inicia Docker Desktop y espera a que el motor de contenedores Linux esté listo; después, vuelve a intentarlo.',
  )
  assert.match(
    getUserFacingError(
      new Error('Docker CLI is not installed.'),
      'Fallback',
    ),
    /Instala Docker Desktop/,
  )
  assert.match(
    getUserFacingError(
      new Error('A container named helix-computer-desktop already exists and was not changed.'),
      'Fallback',
    ),
    /no se modificó/,
  )
})
