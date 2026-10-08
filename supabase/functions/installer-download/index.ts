import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GITHUB_API = 'https://api.github.com'
const INSTALLER_NAME = 'HELIX-Setup.exe'
const RELEASE_ASSET_HOSTS = new Set([
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
])

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

interface ReleasePolicy {
  public_version: string
  channel: 'stable' | 'beta'
  auto_update: boolean
  check_interval_hours: number
}

async function readReleasePolicy(): Promise<{
  policy: ReleasePolicy | null
  error?: string
}> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return { policy: null, error: 'Policy database access is not configured.' }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin
    .from('release_policies')
    .select('public_version, channel, auto_update, check_interval_hours')
    .eq('id', 'global')
    .maybeSingle()
  if (error) return { policy: null, error: error.message }
  if (!data) return { policy: null }
  if (
    typeof data.public_version !== 'string'
    || !/^\d+(?:\.\d+){1,3}$/.test(data.public_version)
    || (data.channel !== 'stable' && data.channel !== 'beta')
    || typeof data.auto_update !== 'boolean'
    || typeof data.check_interval_hours !== 'number'
  ) return { policy: null, error: 'Release policy record is invalid.' }
  return { policy: data as ReleasePolicy }
}

function releaseTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'Sign in to download the installer.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const githubOwner = Deno.env.get('GITHUB_INSTALLER_OWNER')
  const githubRepo = Deno.env.get('GITHUB_INSTALLER_REPO')
  const githubToken = Deno.env.get('GITHUB_INSTALLER_TOKEN')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !githubOwner || !githubRepo || !githubToken) {
    console.error('Installer download function is missing required environment configuration.')
    return jsonResponse(503, { error: 'Installer download is not configured yet.' })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return jsonResponse(401, { error: 'Your session is invalid or expired. Please sign in again.' })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const now = new Date().toISOString()
  const { error: profileError } = await adminClient.from('users').upsert({
    id: user.id,
    supabase_id: user.id,
    email: user.email ?? null,
    display_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    is_active: true,
    last_login_at: now,
    updated_at: now,
  }, { onConflict: 'supabase_id' })

  if (profileError) {
    console.error('Could not ensure the authenticated user profile exists.')
    return jsonResponse(503, { error: 'Your account profile is not ready. Please try again later.' })
  }

  const githubHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'HELIX-installer-download',
  }
  let releaseResponse: Response
  const policyResult = await readReleasePolicy()
  if (policyResult.error) {
    console.error('Could not read the public release policy:', policyResult.error)
    return jsonResponse(503, { error: 'The installer is temporarily unavailable. Please try again later.' })
  }
  const policy = policyResult.policy
  try {
    releaseResponse = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}/releases/${policy ? `tags/${encodeURIComponent(releaseTag(policy.public_version))}` : 'latest'}`,
      { headers: githubHeaders },
    )
  } catch (error) {
    console.error('Could not contact GitHub to locate the installer release:', error)
    return jsonResponse(503, { error: 'The installer is temporarily unavailable. Please try again later.' })
  }

  if (!releaseResponse.ok) {
    console.error('GitHub latest release lookup failed with status:', releaseResponse.status)
    return jsonResponse(503, { error: 'The installer is not available yet. Please try again later.' })
  }

  let releaseData: unknown
  try {
    releaseData = await releaseResponse.json()
  } catch (error) {
    console.error('GitHub returned an invalid latest release response:', error)
    return jsonResponse(503, { error: 'The installer is temporarily unavailable. Please try again later.' })
  }

  if (!releaseData || typeof releaseData !== 'object' || !('assets' in releaseData) || !Array.isArray(releaseData.assets)) {
    console.error('GitHub latest release response did not contain an asset list.')
    return jsonResponse(503, { error: 'The installer is temporarily unavailable. Please try again later.' })
  }
  if (
    policy
    && (
      !('tag_name' in releaseData)
      || releaseData.tag_name !== releaseTag(policy.public_version)
      || !('prerelease' in releaseData)
      || (policy.channel === 'stable' && releaseData.prerelease === true)
      || (policy.channel === 'beta' && releaseData.prerelease !== true)
    )
  ) {
    console.error('The selected public release does not match the configured tag and channel.')
    return jsonResponse(503, { error: 'The installer is temporarily unavailable. Please try again later.' })
  }

  const asset = releaseData.assets.find((candidate: unknown): candidate is { id: number; name: string } => (
    candidate !== null &&
    typeof candidate === 'object' &&
    'id' in candidate &&
    typeof candidate.id === 'number' &&
    'name' in candidate &&
    typeof candidate.name === 'string' &&
    candidate.name === INSTALLER_NAME
  ))
  if (!asset || typeof asset.id !== 'number') {
    console.error(`The latest GitHub release does not contain ${INSTALLER_NAME}.`)
    return jsonResponse(503, { error: 'The installer is not available yet. Please try again later.' })
  }

  let assetResponse: Response
  try {
    assetResponse = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}/releases/assets/${asset.id}`,
      {
        headers: { ...githubHeaders, Accept: 'application/octet-stream' },
        redirect: 'manual',
      },
    )
  } catch (error) {
    console.error('Could not create a GitHub installer download URL:', error)
    return jsonResponse(503, { error: 'The installer is temporarily unavailable. Please try again later.' })
  }

  const location = assetResponse.headers.get('Location')
  if (assetResponse.status !== 302 || !location) {
    console.error('GitHub did not return a temporary installer URL. Status:', assetResponse.status)
    return jsonResponse(503, { error: 'The installer is temporarily unavailable. Please try again later.' })
  }

  let signedUrl: URL
  try {
    signedUrl = new URL(location)
  } catch {
    console.error('GitHub returned an invalid temporary installer URL.')
    return jsonResponse(503, { error: 'The installer is temporarily unavailable. Please try again later.' })
  }
  if (signedUrl.protocol !== 'https:' || !RELEASE_ASSET_HOSTS.has(signedUrl.hostname)) {
    console.error('GitHub returned an installer URL on an unexpected host.')
    return jsonResponse(503, { error: 'The installer is temporarily unavailable. Please try again later.' })
  }

  return jsonResponse(200, { signedUrl: signedUrl.toString() })
})
