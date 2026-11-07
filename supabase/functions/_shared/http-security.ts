const DEFAULT_ALLOWED_ORIGINS = [
  'https://helix-assistant.vercel.app',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
]

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && url.origin === value
      && !url.username
      && !url.password
  } catch {
    return false
  }
}

function allowedOrigins(): Set<string> {
  const configured = Deno.env.get('HELIX_ALLOWED_WEB_ORIGINS')
  const values = configured
    ? configured.split(',').map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS
  return new Set(values.filter(isHttpOrigin))
}

export function withSecureCors(
  request: Request,
  response: Response,
  methods: string,
): Response {
  const origin = request.headers.get('Origin')
  const headers = new Headers(response.headers)
  headers.set('Vary', 'Origin')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Cache-Control', 'no-store')

  if (origin && allowedOrigins().has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
    headers.set('Access-Control-Allow-Methods', methods)
  } else if (origin && request.method === 'OPTIONS') {
    return new Response(null, { status: 403, headers })
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
