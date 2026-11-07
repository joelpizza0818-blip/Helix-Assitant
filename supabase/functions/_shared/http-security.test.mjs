import assert from 'node:assert/strict'
import test from 'node:test'
import { withSecureCors } from './http-security.ts'

globalThis.Deno = {
  env: {
    get: () => undefined,
  },
}

test('CORS reflects only explicitly allowed origins and rejects hostile preflight', () => {
  const allowed = withSecureCors(
    new Request('https://supabase.example/function', { headers: { Origin: 'https://helix-assistant.vercel.app' } }),
    new Response('ok'),
    'GET, OPTIONS',
  )
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://helix-assistant.vercel.app')
  assert.equal(allowed.headers.get('X-Content-Type-Options'), 'nosniff')

  const denied = withSecureCors(
    new Request('https://supabase.example/function', {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example' },
    }),
    new Response(null, { status: 204 }),
    'GET, OPTIONS',
  )
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null)
})
