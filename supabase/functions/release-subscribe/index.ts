import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://helix-assistant.vercel.app'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return response(204, {})
  if (request.method !== 'POST') return response(405, { success: false, error: 'Method not allowed' })

  const origin = request.headers.get('origin')
  if (origin && origin !== ALLOWED_ORIGIN) return response(403, { success: false, error: 'Origin not allowed' })

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return response(400, { success: false, error: 'Invalid JSON body' })
  }

  const email = typeof payload === 'object' && payload !== null && 'email' in payload
    ? String(payload.email).trim().toLowerCase()
    : ''
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    return response(400, { success: false, error: 'Invalid email' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Release subscription function is missing database configuration.')
    return response(503, { success: false, error: 'Subscription service unavailable' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await supabase.from('update_subscribers').upsert(
    { email, is_active: true, unsubscribed_at: null },
    { onConflict: 'email' },
  )
  if (error) {
    console.error('Could not persist release subscriber:', error.message)
    return response(503, { success: false, error: 'Subscription service unavailable' })
  }

  return response(200, {
    success: true,
    message: 'Subscription request accepted by the update service.',
  })
})
