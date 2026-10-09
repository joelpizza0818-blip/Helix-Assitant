import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

async function authenticateGithubIdentity(
  request: Request,
  admin: ReturnType<typeof getAdminClient>,
): Promise<
  | { login: string; githubId: string; displayName: string; avatarUrl: string | null }
  | { response: Response }
> {
  const authorization = request.headers.get('Authorization')
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!token) {
    return { response: jsonResponse(401, { error: 'GitHub sign-in is required.' }) }
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token)
  const authUser = authError ? null : authData.user
  if (authUser && authUser.app_metadata.provider === 'github') {
    const githubIdentity = authUser.identities?.find((identity) => identity.provider === 'github')
    const identityData = githubIdentity?.identity_data
    const login = typeof identityData?.user_name === 'string'
      ? identityData.user_name
      : typeof authUser.user_metadata.user_name === 'string'
        ? authUser.user_metadata.user_name
        : ''
    const githubId = githubIdentity?.id ?? ''
    if (!login || !githubId) {
      return { response: jsonResponse(503, { error: 'GitHub profile data is incomplete.' }) }
    }
    return {
      login: login.toLowerCase(),
      githubId: String(githubId),
      displayName: typeof identityData?.full_name === 'string'
        ? identityData.full_name
        : login,
      avatarUrl: typeof identityData?.avatar_url === 'string'
        ? identityData.avatar_url
        : null,
    }
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
  return {
    login: identity.login.toLowerCase(),
    githubId: String(identity.id),
    displayName: identity.login,
    avatarUrl: null,
  }
}

interface UserProfile {
  profileId: string
  githubUserId: string
  githubLogin: string
  displayName: string
  avatarUrl: string | null
  rank: 'user' | 'admin' | 'master-admin'
}

async function syncUserProfile(
  admin: ReturnType<typeof getAdminClient>,
  identity: { login: string; githubId: string; displayName: string; avatarUrl: string | null },
): Promise<UserProfile | null> {
  const byGitHubId = await admin
    .from('github_user_roles')
    .select('profile_id, github_user_id, github_login, display_name, avatar_url, rank')
    .eq('github_user_id', identity.githubId)
    .maybeSingle()
  if (byGitHubId.error) throw new Error(`Could not find HELIX profile: ${byGitHubId.error.message}`)

  let existing = byGitHubId.data
  if (!existing) {
    const byLogin = await admin
      .from('github_user_roles')
      .select('profile_id, github_user_id, github_login, display_name, avatar_url, rank')
      .ilike('github_login', identity.login)
      .maybeSingle()
    if (byLogin.error) throw new Error(`Could not find HELIX profile: ${byLogin.error.message}`)
    existing = byLogin.data
  }

  if (byGitHubId.data === null && !existing) {
    const { data, error } = await admin
      .from('github_user_roles')
      .insert({
        github_login: identity.login,
        github_user_id: identity.githubId,
        display_name: identity.displayName || identity.login,
        avatar_url: identity.avatarUrl,
        rank: 'user',
      })
      .select('profile_id, github_user_id, github_login, display_name, avatar_url, rank')
      .single()
    if (error) throw new Error(`Could not create HELIX profile: ${error.message}`)
    return {
      profileId: data.profile_id,
      githubUserId: data.github_user_id,
      githubLogin: data.github_login,
      displayName: data.display_name,
      avatarUrl: data.avatar_url,
      rank: data.rank,
    }
  }

  const profile = existing!
  const { data, error } = await admin
    .from('github_user_roles')
    .update({
      github_login: identity.login,
      github_user_id: identity.githubId,
      display_name: profile.display_name || identity.displayName || identity.login,
      avatar_url: identity.avatarUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('profile_id', profile.profile_id)
    .select('profile_id, github_user_id, github_login, display_name, avatar_url, rank')
    .single()
  if (error) throw new Error(`Could not update HELIX profile: ${error.message}`)
  return {
    profileId: data.profile_id,
    githubUserId: data.github_user_id,
    githubLogin: data.github_login,
    displayName: data.display_name,
    avatarUrl: data.avatar_url,
    rank: data.rank,
  }
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

  let admin
  try {
    admin = getAdminClient()
  } catch (error) {
    console.error('Installer admin function is not configured:', error)
    return jsonResponse(503, { error: 'Release policy storage is not configured.' })
  }

  const auth = await authenticateGithubIdentity(request, admin)
  if ('response' in auth) return auth.response

  let profile: UserProfile
  try {
    const syncedProfile = await syncUserProfile(admin, auth)
    if (!syncedProfile) return jsonResponse(503, { error: 'Could not load the HELIX profile.' })
    profile = syncedProfile
  } catch (error) {
    console.error('Could not synchronize HELIX profile:', error)
    return jsonResponse(503, { error: 'Could not synchronize the HELIX profile.' })
  }

  const route = new URL(request.url).pathname.split('/installer-admin/')[1] ?? ''
  const isAdmin = profile.rank === 'admin' || profile.rank === 'master-admin'

  if ((route === 'authorization' || route === 'profile') && request.method === 'GET') {
    return jsonResponse(200, {
      success: true,
      authenticated: isAdmin,
      profile,
    })
  }
  if (route === 'profile' && request.method === 'PUT') {
    const body: unknown = await request.json().catch(() => null)
    if (
      body === null
      || typeof body !== 'object'
      || !('displayName' in body)
      || typeof body.displayName !== 'string'
      || !body.displayName.trim()
      || body.displayName.trim().length > 80
    ) {
      return jsonResponse(400, { error: 'Profile name must be between 1 and 80 characters.' })
    }
    const { data, error } = await admin
      .from('github_user_roles')
      .update({ display_name: body.displayName.trim(), updated_at: new Date().toISOString() })
      .eq('profile_id', profile.profileId)
      .select('profile_id, github_user_id, github_login, display_name, avatar_url, rank')
      .single()
    if (error) {
      console.error('Could not update profile name:', error.message)
      return jsonResponse(503, { error: 'Could not update the profile name.' })
    }
    return jsonResponse(200, {
      success: true,
      profile: {
        profileId: data.profile_id,
        githubUserId: data.github_user_id,
        githubLogin: data.github_login,
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        rank: data.rank,
      },
    })
  }

  if (route === 'profiles' && request.method === 'GET') {
    if (profile.rank !== 'master-admin') return jsonResponse(403, { error: 'Master admin rank required.' })
    const { data, error } = await admin
      .from('github_user_roles')
      .select('profile_id, github_user_id, github_login, display_name, avatar_url, rank, created_at')
      .order('display_name', { ascending: true })
      .limit(1000)
    if (error) {
      console.error('Could not load user profiles:', error.message)
      return jsonResponse(503, { error: 'Could not load user profiles.' })
    }
    return jsonResponse(200, {
      success: true,
      profiles: (data ?? []).map((item) => ({
        profileId: item.profile_id,
        githubUserId: item.github_user_id,
        githubLogin: item.github_login,
        displayName: item.display_name ?? item.github_login,
        avatarUrl: item.avatar_url,
        rank: item.rank,
        createdAt: item.created_at,
      })),
    })
  }
  if (route.startsWith('profiles/') && route.endsWith('/rank') && request.method === 'PUT') {
    if (profile.rank !== 'master-admin') return jsonResponse(403, { error: 'Master admin rank required.' })
    const targetProfileId = route.split('/')[1]
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetProfileId)) {
      return jsonResponse(400, { error: 'Profile ID is invalid.' })
    }
    const body: unknown = await request.json().catch(() => null)
    if (
      body === null
      || typeof body !== 'object'
      || !('rank' in body)
      || (body.rank !== 'user' && body.rank !== 'admin')
    ) {
      return jsonResponse(400, { error: 'Only user and admin ranks can be assigned.' })
    }
    const { data, error } = await admin
      .from('github_user_roles')
      .update({ rank: body.rank, updated_at: new Date().toISOString() })
      .eq('profile_id', targetProfileId)
      .neq('rank', 'master-admin')
      .select('profile_id, github_user_id, github_login, display_name, avatar_url, rank')
      .maybeSingle()
    if (error) {
      console.error('Could not update user rank:', error.message)
      return jsonResponse(503, { error: 'Could not update the user rank.' })
    }
    if (!data) return jsonResponse(404, { error: 'User profile was not found or cannot be changed.' })
    return jsonResponse(200, {
      success: true,
      profile: {
        profileId: data.profile_id,
        githubUserId: data.github_user_id,
        githubLogin: data.github_login,
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        rank: data.rank,
      },
    })
  }

  if (route === 'reports' && request.method === 'POST') {
    if (!isAdmin) return jsonResponse(403, { error: 'Admin rank required to submit an error report.' })
    const body: unknown = await request.json().catch(() => null)
    if (
      body === null
      || typeof body !== 'object'
      || !('title' in body)
      || typeof body.title !== 'string'
      || !body.title.trim()
      || body.title.trim().length > 120
      || !('description' in body)
      || typeof body.description !== 'string'
      || !body.description.trim()
      || body.description.trim().length > 5000
      || !('appVersion' in body)
      || typeof body.appVersion !== 'string'
      || !/^\d+(?:\.\d+){1,3}$/.test(body.appVersion)
    ) {
      return jsonResponse(400, { error: 'Report title or description is invalid.' })
    }
    const { data, error } = await admin
      .from('admin_error_reports')
      .insert({
        created_by_profile_id: profile.profileId,
        title: body.title.trim(),
        description: body.description.trim(),
        app_version: body.appVersion,
      })
      .select('id, title, description, app_version, status, created_at')
      .single()
    if (error) {
      console.error('Could not create error report:', error.message)
      return jsonResponse(503, { error: 'Could not submit the error report.' })
    }
    return jsonResponse(201, { success: true, report: data })
  }

  if (route === 'reports' && request.method === 'GET') {
    if (profile.rank !== 'master-admin') return jsonResponse(403, { error: 'Master admin rank required.' })
    const { data, error } = await admin
      .from('admin_error_reports')
      .select('id, title, description, app_version, status, created_at, resolved_at, created_by_profile_id, github_user_roles!admin_error_reports_created_by_profile_id_fkey(github_login, display_name, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(250)
    if (error) {
      console.error('Could not load error reports:', error.message)
      return jsonResponse(503, { error: 'Could not load error reports.' })
    }
    return jsonResponse(200, { success: true, reports: data ?? [] })
  }
  if (route.startsWith('reports/') && request.method === 'PUT') {
    if (profile.rank !== 'master-admin') return jsonResponse(403, { error: 'Master admin rank required.' })
    const reportId = route.split('/')[1]
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId)) {
      return jsonResponse(400, { error: 'Report ID is invalid.' })
    }
    const { data, error } = await admin
      .from('admin_error_reports')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', reportId)
      .select('id, status, resolved_at')
      .maybeSingle()
    if (error) {
      console.error('Could not resolve error report:', error.message)
      return jsonResponse(503, { error: 'Could not update the error report.' })
    }
    if (!data) return jsonResponse(404, { error: 'Error report was not found.' })
    return jsonResponse(200, { success: true, report: data })
  }

  if (!isAdmin) {
    return jsonResponse(403, { error: 'This GitHub account does not have an admin rank.' })
  }
  if ((route === '' || route === 'policy') && request.method === 'PUT' && profile.rank !== 'master-admin') {
    return jsonResponse(403, { error: 'Master admin rank required to publish release policy.' })
  }

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
