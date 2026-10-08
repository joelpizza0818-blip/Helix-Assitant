import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_GITHUB_LOGIN = 'joelpizza0818-blip'
const GITHUB_API = 'https://api.github.com'

function releaseTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Cache-Control': 'no-store',
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase admin database access is not configured.')
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function authenticateAdmin(request: Request): Promise<
  | { login: string; githubId: string }
  | { response: Response }
> {
  const authorization = request.headers.get('Authorization')
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!token) {
    return { response: jsonResponse(401, { error: 'GitHub CLI authentication is required.' }) }
  }

  let identityResponse: Response
  try {
    identityResponse = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'HELIX-installer-admin',
      },
      signal: AbortSignal.timeout(8000),
    })
  } catch (error) {
    console.error('Could not verify GitHub admin identity:', error)
    return { response: jsonResponse(503, { error: 'Could not verify GitHub identity right now.' }) }
  }
  if (!identityResponse.ok) {
    return { response: jsonResponse(401, { error: 'GitHub authentication is invalid or expired.' }) }
  }

  const identity: unknown = await identityResponse.json().catch(() => null)
  if (
    identity === null
    || typeof identity !== 'object'
    || !('login' in identity)
    || typeof identity.login !== 'string'
    || !('id' in identity)
    || (typeof identity.id !== 'number' && typeof identity.id !== 'string')
  ) {
    return { response: jsonResponse(503, { error: 'GitHub returned an invalid identity.' }) }
  }
  if (identity.login.toLowerCase() !== ADMIN_GITHUB_LOGIN) {
    return { response: jsonResponse(403, { error: 'This GitHub account is not authorized to manage HELIX releases.' }) }
  }
  return { login: identity.login, githubId: String(identity.id) }
}

async function verifyRelease(
  version: string,
  channel?: 'stable' | 'beta',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const owner = Deno.env.get('GITHUB_INSTALLER_OWNER')
  const repository = Deno.env.get('GITHUB_INSTALLER_REPO')
  const token = Deno.env.get('GITHUB_INSTALLER_TOKEN')
  if (!owner || !repository || !token) {
    return { ok: false, error: 'Private installer release access is not configured.' }
  }
  const tag = releaseTag(version)
  let response: Response
  try {
    response = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'HELIX-installer-admin',
        },
        signal: AbortSignal.timeout(8000),
      },
    )
  } catch (error) {
    console.error('Could not verify the private installer release:', error)
    return { ok: false, error: 'Could not verify the private installer release right now.' }
  }
  if (response.status === 404) return { ok: false, error: `Installer release ${tag} does not exist.` }
  if (!response.ok) return { ok: false, error: `Installer release verification failed (HTTP ${response.status}).` }

  const release: unknown = await response.json().catch(() => null)
  if (
    release === null
    || typeof release !== 'object'
    || !('tag_name' in release)
    || release.tag_name !== tag
    || !('draft' in release)
    || release.draft !== false
    || !('prerelease' in release)
    || typeof release.prerelease !== 'boolean'
    || !('assets' in release)
    || !Array.isArray(release.assets)
  ) {
    return { ok: false, error: `Installer release ${tag} returned invalid metadata.` }
  }
  if (channel && ((channel === 'beta') !== release.prerelease)) {
    return { ok: false, error: `Installer release ${tag} does not match the ${channel} channel.` }
  }

  const requiredAssets = new Set([
    'HELIX-Setup.exe',
    'latest.yml',
    `HELIX-Setup-${version}.exe`,
    `HELIX-Setup-${version}.exe.blockmap`,
  ])
  for (const asset of release.assets) {
    if (
      asset !== null
      && typeof asset === 'object'
      && 'name' in asset
      && typeof asset.name === 'string'
    ) {
      requiredAssets.delete(asset.name)
    }
  }
  if (requiredAssets.size) {
    return { ok: false, error: `Installer release ${tag} is missing required update assets.` }
  }
  return { ok: true }
}

function isPolicyBody(value: unknown): value is {
  publicVersion: string
  channel: 'stable' | 'beta'
  autoUpdate: boolean
  checkIntervalHours: number
} {
  return value !== null
    && typeof value === 'object'
    && 'publicVersion' in value
    && typeof value.publicVersion === 'string'
    && /^\d+(?:\.\d+){1,3}$/.test(value.publicVersion)
    && 'channel' in value
    && (value.channel === 'stable' || value.channel === 'beta')
    && 'autoUpdate' in value
    && typeof value.autoUpdate === 'boolean'
    && 'checkIntervalHours' in value
    && typeof value.checkIntervalHours === 'number'
    && Number.isInteger(value.checkIntervalHours)
    && value.checkIntervalHours >= 1
    && value.checkIntervalHours <= 720
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!['GET', 'POST', 'PUT'].includes(request.method)) {
    return jsonResponse(405, { error: 'Method not allowed.' })
  }

  const auth = await authenticateAdmin(request)
  if ('response' in auth) return auth.response

  let admin
  try {
    admin = getAdminClient()
  } catch (error) {
    console.error('Installer admin function is not configured:', error)
    return jsonResponse(503, { error: 'Release policy storage is not configured.' })
  }

  const route = new URL(request.url).pathname.split('/installer-admin/')[1] ?? ''
  if ((route === '' || route === 'policy') && request.method === 'GET') {
    const { data, error } = await admin
      .from('release_policies')
      .select('public_version, channel, auto_update, check_interval_hours, updated_at')
      .eq('id', 'global')
      .maybeSingle()
    if (error) {
      console.error('Could not load release policy:', error.message)
      return jsonResponse(503, { error: 'Could not load the shared release policy.' })
    }
    const { data: backups, error: backupError } = await admin
      .from('release_backups')
      .select('version, current_version, created_at')
      .eq('policy_id', 'global')
      .order('created_at', { ascending: false })
    if (backupError) {
      console.error('Could not load release backups:', backupError.message)
      return jsonResponse(503, { error: 'Could not load release backup records.' })
    }
    return jsonResponse(200, {
      success: true,
      data: {
        publicVersion: data?.public_version ?? '0.1.2',
        channel: data?.channel ?? 'stable',
        autoUpdate: data?.auto_update ?? true,
        checkIntervalHours: data?.check_interval_hours ?? 24,
        backups: (backups ?? []).map((backup) => ({
          version: backup.version,
          currentVersion: backup.current_version,
          createdAt: backup.created_at,
        })),
      },
    })
  }

  if ((route === '' || route === 'policy') && request.method === 'PUT') {
    const body: unknown = await request.json().catch(() => null)
    if (!isPolicyBody(body)) return jsonResponse(400, { error: 'Release policy contains invalid values.' })
    const verified = await verifyRelease(body.publicVersion, body.channel)
    if (!verified.ok) return jsonResponse(422, { error: verified.error })
    const { data, error } = await admin
      .from('release_policies')
      .upsert({
        id: 'global',
        public_version: body.publicVersion,
        channel: body.channel,
        auto_update: body.autoUpdate,
        check_interval_hours: body.checkIntervalHours,
        updated_by_user_id: auth.githubId,
        updated_at: new Date().toISOString(),
      })
      .select('public_version, channel, auto_update, check_interval_hours, updated_at')
      .single()
    if (error) {
      console.error('Could not save release policy:', error.message)
      return jsonResponse(503, { error: 'Could not save the shared release policy.' })
    }
    return jsonResponse(200, {
      success: true,
      data: {
        publicVersion: data.public_version,
        channel: data.channel,
        autoUpdate: data.auto_update,
        checkIntervalHours: data.check_interval_hours,
        backups: [],
      },
    })
  }

  if ((route === '' || route === 'backups') && request.method === 'POST') {
    const body: unknown = await request.json().catch(() => null)
    if (
      body === null
      || typeof body !== 'object'
      || !('version' in body)
      || typeof body.version !== 'string'
      || !/^\d+(?:\.\d+){1,3}$/.test(body.version)
    ) {
      return jsonResponse(400, { error: 'Backup release version is invalid.' })
    }
    const verified = await verifyRelease(body.version)
    if (!verified.ok) return jsonResponse(422, { error: verified.error })
    const { error: policyError } = await admin
      .from('release_policies')
      .upsert({ id: 'global', public_version: '0.1.2' }, { onConflict: 'id', ignoreDuplicates: true })
    if (policyError) {
      console.error('Could not initialize release policy for backup:', policyError.message)
      return jsonResponse(503, { error: 'Could not initialize release policy storage.' })
    }
    const existingResult = await admin
      .from('release_backups')
      .select('version')
      .eq('version', body.version)
      .maybeSingle()
    if (existingResult.error) {
      console.error('Could not check existing release backup:', existingResult.error.message)
      return jsonResponse(503, { error: 'Could not save the release backup.' })
    }
    const currentVersion = 'currentVersion' in body && typeof body.currentVersion === 'string'
      ? body.currentVersion
      : null
    const result = existingResult.data
      ? await admin
        .from('release_backups')
        .update({ current_version: currentVersion, policy_id: 'global' })
        .eq('version', body.version)
        .select('version, current_version, created_at')
        .single()
      : await admin
        .from('release_backups')
        .insert({
          id: crypto.randomUUID(),
          version: body.version,
          current_version: currentVersion,
          policy_id: 'global',
        })
        .select('version, current_version, created_at')
        .single()
    const { data, error } = result
    if (error) {
      console.error('Could not save release backup:', error.message)
      return jsonResponse(503, { error: 'Could not save the release backup.' })
    }
    return jsonResponse(200, {
      success: true,
      data: {
        version: data.version,
        currentVersion: data.current_version,
        createdAt: data.created_at,
      },
    })
  }

  return jsonResponse(404, { error: 'Admin route not found.' })
})
