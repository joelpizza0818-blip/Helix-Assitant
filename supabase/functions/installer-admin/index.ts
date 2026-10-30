import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  getInstallerHistorySources,
  mergeInstallerHistoryRows,
  type InstallerHistoryRow,
} from '../_shared/installer-history.ts'

const GITHUB_API = 'https://api.github.com'
const LITE_RELEASE_OWNER = 'joelpizza0818-blip'
const LITE_RELEASE_REPOSITORY = 'Helix-Assitant'
const INSTALLER_RELEASE_OWNER = 'joelpizza0818-blip'
const INSTALLER_RELEASE_REPOSITORY = 'helix-installer-downloads'

function releaseTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

const ANNOUNCEMENT_CATEGORIES = new Set([
  'RELEASE',
  'FEATURE',
  'SECURITY',
  'MOBILE',
  'ECOSYSTEM',
  'COMPATIBILITY',
])
const INSTALLER_PLATFORMS = new Set(['windows', 'linux', 'macos', 'android', 'ios'])
const INSTALLER_EDITIONS = new Set(['normal', 'lite', 'mobile'])

interface AnnouncementPayload {
  category: string
  title: string
  summary: string
  content: string[]
  links: Array<{ text: string; url: string; external: boolean }>
}

interface InstallerPayload {
  platform: 'windows' | 'linux' | 'macos' | 'android' | 'ios'
  edition: 'normal' | 'lite' | 'mobile'
  version: string
  installerUrl: string
  checksumUrl: string
  releaseUrl: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isAllowedAnnouncementUrl(value: string): boolean {
  return value.startsWith('/') ? !value.startsWith('//') : isHttpsUrl(value)
}

function parseAnnouncementPayload(value: unknown): AnnouncementPayload | null {
  if (
    !isRecord(value)
    || typeof value.category !== 'string'
    || !ANNOUNCEMENT_CATEGORIES.has(value.category)
    || typeof value.title !== 'string'
    || !value.title.trim()
    || value.title.trim().length > 180
    || typeof value.summary !== 'string'
    || !value.summary.trim()
    || value.summary.trim().length > 700
    || !Array.isArray(value.content)
    || value.content.length > 20
    || !value.content.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 1500)
    || !Array.isArray(value.links)
    || value.links.length > 10
  ) return null

  const links: AnnouncementPayload['links'] = []
  for (const item of value.links) {
    if (
      !isRecord(item)
      || typeof item.text !== 'string'
      || !item.text.trim()
      || item.text.trim().length > 80
      || typeof item.url !== 'string'
      || item.url.length > 2048
      || (item.external !== undefined && typeof item.external !== 'boolean')
      || !isAllowedAnnouncementUrl(item.url)
    ) return null
    links.push({ text: item.text.trim(), url: item.url, external: item.external === true })
  }

  return {
    category: value.category,
    title: value.title.trim(),
    summary: value.summary.trim(),
    content: value.content.map((item) => item.trim()),
    links,
  }
}

function parseInstallerPayload(value: unknown): InstallerPayload | null {
  if (
    !isRecord(value)
    || typeof value.platform !== 'string'
    || !INSTALLER_PLATFORMS.has(value.platform)
    || typeof value.edition !== 'string'
    || !INSTALLER_EDITIONS.has(value.edition)
    || typeof value.version !== 'string'
    || !/^[vV]?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(value.version)
    || value.version.length > 40
    || !isHttpsUrl(value.installerUrl)
    || !isHttpsUrl(value.checksumUrl)
    || !isHttpsUrl(value.releaseUrl)
  ) return null
  const isMobile = value.edition === 'mobile'
  if (isMobile !== (value.platform === 'android' || value.platform === 'ios')) return null

  return {
    platform: value.platform as InstallerPayload['platform'],
    edition: value.edition as InstallerPayload['edition'],
    version: value.version.replace(/^[vV]/, ''),
    installerUrl: value.installerUrl,
    checksumUrl: value.checksumUrl,
    releaseUrl: value.releaseUrl,
  }
}

interface GitHubReleaseRecord {
  tag_name: string
  html_url: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
  created_at: string
  assets: unknown[]
}

async function fetchInstallerHistoryFromSource(
  source: { owner: string; repository: string },
): Promise<GitHubReleaseRecord[]> {
  const token = Deno.env.get('GITHUB_INSTALLER_TOKEN')
  const releases: GitHubReleaseRecord[] = []

  for (let page = 1; page <= 20; page += 1) {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'HELIX-installer-admin',
    }
    if (token) headers.Authorization = `Bearer ${token}`

    let response: Response
    try {
      response = await fetch(
        `${GITHUB_API}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/releases?per_page=100&page=${page}`,
        { headers, signal: AbortSignal.timeout(12000) },
      )
    } catch (error) {
      console.error('Could not fetch installer release history:', error)
      throw new Error('Could not contact GitHub to load installer history.')
    }
    if (!response.ok) throw new Error(`GitHub installer history lookup failed (HTTP ${response.status}).`)

    const payload: unknown = await response.json().catch(() => null)
    if (!Array.isArray(payload)) throw new Error('GitHub returned an invalid installer history response.')
    if (payload.length === 0) break

    for (const candidate of payload) {
      if (
        isRecord(candidate)
        && typeof candidate.tag_name === 'string'
        && typeof candidate.html_url === 'string'
        && typeof candidate.draft === 'boolean'
        && typeof candidate.prerelease === 'boolean'
        && Array.isArray(candidate.assets)
        && typeof candidate.created_at === 'string'
        && (candidate.published_at === null || typeof candidate.published_at === 'string')
      ) {
        releases.push({
          tag_name: candidate.tag_name,
          html_url: candidate.html_url,
          draft: candidate.draft,
          prerelease: candidate.prerelease,
          published_at: candidate.published_at,
          created_at: candidate.created_at,
          assets: candidate.assets,
        })
      }
    }
    if (payload.length < 100) break
  }

  return releases
}

async function fetchInstallerHistory(): Promise<GitHubReleaseRecord[]> {
  const sources = getInstallerHistorySources(
    Deno.env.get('GITHUB_INSTALLER_OWNER'),
    Deno.env.get('GITHUB_INSTALLER_REPO'),
  )
  const releasesBySource = await Promise.all(sources.map(fetchInstallerHistoryFromSource))
  return releasesBySource.flat()
}

function findReleaseAsset(release: GitHubReleaseRecord, expectedNames: string[]): string | null {
  for (const candidate of release.assets) {
    if (!isRecord(candidate) || typeof candidate.name !== 'string' || typeof candidate.browser_download_url !== 'string') continue
    if (!expectedNames.includes(candidate.name) || !isHttpsUrl(candidate.browser_download_url)) continue
    const assetUrl = new URL(candidate.browser_download_url)
    if (assetUrl.hostname === 'github.com') return assetUrl.toString()
  }
  return null
}

function historyRows(releases: GitHubReleaseRecord[], profileId: string): InstallerHistoryRow[] {
  const rows: InstallerHistoryRow[] = []
  for (const release of releases) {
    if (release.draft || !isHttpsUrl(release.html_url)) continue
    const tagUrl = new URL(release.html_url)
    if (tagUrl.hostname !== 'github.com') continue
    const releaseDate = release.published_at ?? release.created_at
    const normal = release.tag_name.match(/^v(\d+\.\d+\.\d+)$/)
    const lite = release.tag_name.match(/^lite-v(\d+\.\d+\.\d+)$/)
    const mobile = release.tag_name.match(/^mobile-v(\d+\.\d+\.\d+)$/)
    const assetsFor = (platform: 'windows' | 'android' | 'ios', edition: 'normal' | 'lite' | 'mobile', version: string) => {
      let installerNames: string[]
      if (edition === 'normal') installerNames = ['HELIX-Setup.exe', `HELIX-Setup-${version}.exe`]
      else if (edition === 'lite') installerNames = ['HELIX-Lite-Setup.exe']
      else installerNames = platform === 'android'
        ? ['HELIX-Mobile-arm64-v8a.apk', 'HELIX-Mobile.apk']
        : ['HELIX-Mobile.ipa']
      const installerName = installerNames.find((name) => (
        findReleaseAsset(release, [name]) !== null
        && findReleaseAsset(release, [`${name}.sha256`]) !== null
      ))
      const installerUrl = installerName ? findReleaseAsset(release, [installerName]) : null
      const checksumUrl = installerName ? findReleaseAsset(release, [`${installerName}.sha256`]) : null
      rows.push({
        platform,
        edition,
        version,
        installer_url: installerUrl,
        checksum_url: checksumUrl,
        release_url: release.html_url,
        is_published: false,
        is_prerelease: release.prerelease,
        release_date: releaseDate,
        created_by_profile_id: profileId,
      })
    }

    if (normal) assetsFor('windows', 'normal', normal[1])
    else if (lite) assetsFor('windows', 'lite', lite[1])
    else if (mobile) {
      const hasAndroid = findReleaseAsset(release, ['HELIX-Mobile-arm64-v8a.apk', 'HELIX-Mobile.apk']) !== null
      const hasIos = findReleaseAsset(release, ['HELIX-Mobile.ipa']) !== null
      if (hasAndroid || !hasIos) assetsFor('android', 'mobile', mobile[1])
      if (hasIos) assetsFor('ios', 'mobile', mobile[1])
    }
  }
  return mergeInstallerHistoryRows(rows)
}

async function syncUserProfile(
  admin: ReturnType<typeof getAdminClient>,
  identity: { login: string; githubId: string; displayName: string; avatarUrl: string | null },
): Promise<UserProfile | null> {
  const rank = identity.login.toLowerCase() === 'joelpizza0818-blip' ? 'master-admin' : null
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
        rank: rank ?? 'user',
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
      ...(rank ? { rank } : {}),
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
  const token = Deno.env.get('GITHUB_INSTALLER_TOKEN')
  if (!token) {
    return { ok: false, error: 'Private installer release access is not configured.' }
  }
  const tag = releaseTag(version)
  let response: Response
  try {
    response = await fetch(
      `${GITHUB_API}/repos/${INSTALLER_RELEASE_OWNER}/${INSTALLER_RELEASE_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`,
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
    `HELIX-Setup-${version}.exe.sha256`,
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

async function verifyLiteRelease(version: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const tag = `lite-v${version}`
  let response: Response
  try {
    response = await fetch(
      `${GITHUB_API}/repos/${LITE_RELEASE_OWNER}/${LITE_RELEASE_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'HELIX-Lite-release-admin',
        },
        signal: AbortSignal.timeout(8000),
      },
    )
  } catch (error) {
    console.error('Could not verify the public HELIX Lite release:', error)
    return { ok: false, error: 'Could not verify the HELIX Lite release right now.' }
  }
  if (response.status === 404) return { ok: false, error: `HELIX Lite release ${tag} does not exist.` }
  if (!response.ok) return { ok: false, error: `HELIX Lite release verification failed (HTTP ${response.status}).` }

  const release: unknown = await response.json().catch(() => null)
  if (
    release === null
    || typeof release !== 'object'
    || !('tag_name' in release)
    || release.tag_name !== tag
    || !('draft' in release)
    || release.draft !== false
    || !('prerelease' in release)
    || release.prerelease !== false
    || !('assets' in release)
    || !Array.isArray(release.assets)
  ) {
    return { ok: false, error: `HELIX Lite release ${tag} returned invalid or non-stable metadata.` }
  }

  const requiredAssets = new Set(['HELIX-Lite-Setup.exe', 'HELIX-Lite-Setup.exe.sha256'])
  for (const asset of release.assets) {
    if (
      asset !== null
      && typeof asset === 'object'
      && 'name' in asset
      && typeof asset.name === 'string'
    ) requiredAssets.delete(asset.name)
  }
  if (requiredAssets.size) {
    return { ok: false, error: `HELIX Lite release ${tag} is missing its installer or SHA-256 checksum.` }
  }
  return { ok: true }
}

async function verifyMobileRelease(
  version: string,
  platform: 'android' | 'ios',
  installerUrl: string,
  checksumUrl: string,
  releaseUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const owner = Deno.env.get('GITHUB_INSTALLER_OWNER') ?? 'joelpizza0818-blip'
  const repository = Deno.env.get('GITHUB_INSTALLER_REPO') ?? 'Helix-Assitant'
  const token = Deno.env.get('GITHUB_INSTALLER_TOKEN')
  const tag = `mobile-v${version}`
  const installerNames = platform === 'android'
    ? ['HELIX-Mobile-arm64-v8a.apk', 'HELIX-Mobile.apk']
    : ['HELIX-Mobile.ipa']
  let response: Response
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'HELIX-installer-admin',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    response = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases/tags/${encodeURIComponent(tag)}`,
      { headers, signal: AbortSignal.timeout(8000) },
    )
  } catch (error) {
    console.error('Could not verify the mobile release:', error)
    return { ok: false, error: 'Could not verify the mobile release right now.' }
  }
  if (response.status === 404) return { ok: false, error: `Mobile release ${tag} does not exist.` }
  if (!response.ok) return { ok: false, error: `Mobile release verification failed (HTTP ${response.status}).` }

  const release: unknown = await response.json().catch(() => null)
  if (
    !isRecord(release)
    || release.tag_name !== tag
    || release.draft !== false
    || release.prerelease !== false
    || !Array.isArray(release.assets)
  ) return { ok: false, error: `Mobile release ${tag} is not a stable, published release.` }

  const expectedReleaseUrl = `https://github.com/${owner}/${repository}/releases/tag/${tag}`
  const assetBase = `https://github.com/${owner}/${repository}/releases/download/${tag}/`
  const names = new Set<string>()
  for (const asset of release.assets) {
    if (isRecord(asset) && typeof asset.name === 'string') names.add(asset.name)
  }
  const installerName = installerNames.find((name) => installerUrl === `${assetBase}${name}`)
  const expectedInstaller = installerName ? `${assetBase}${installerName}` : null
  const expectedChecksum = expectedInstaller ? `${expectedInstaller}.sha256` : null
  if (
    releaseUrl !== expectedReleaseUrl
    || installerUrl !== expectedInstaller
    || checksumUrl !== expectedChecksum
    || !installerName
    || !names.has(installerName)
    || !names.has(`${installerName}.sha256`)
    || (platform === 'android' && installerName === 'HELIX-Mobile-arm64-v8a.apk'
      && (!names.has('HELIX-Mobile.apk') || !names.has('HELIX-Mobile.apk.sha256')))
  ) return { ok: false, error: `Mobile release ${tag} is missing the expected installer or SHA-256 asset.` }

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
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) {
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
  const routeParts = route.split('/').filter(Boolean)

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

  if (routeParts[0] === 'announcements') {
    if (!isAdmin) return jsonResponse(403, { error: 'Admin rank required to manage announcements.' })
    if (routeParts.length === 1 && request.method === 'GET') {
      const { data, error } = await admin
        .from('landing_announcements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) {
        console.error('Could not load landing announcements:', error.message)
        return jsonResponse(503, { error: 'Could not load landing announcements.' })
      }
      return jsonResponse(200, {
        success: true,
        announcements: (data ?? []).map((item) => ({
          id: item.id,
          category: item.category,
          title: item.title,
          summary: item.summary,
          content: item.content,
          links: item.links,
          isPublished: item.is_published,
          publishedAt: item.published_at,
          createdAt: item.created_at,
        })),
      })
    }

    if (routeParts.length === 1 && request.method === 'POST') {
      const payload = parseAnnouncementPayload(await request.json().catch(() => null))
      if (!payload) return jsonResponse(400, { error: 'Announcement fields are invalid.' })
      const { data, error } = await admin
        .from('landing_announcements')
        .insert({
          category: payload.category,
          title: payload.title,
          summary: payload.summary,
          content: payload.content,
          links: payload.links,
          created_by_profile_id: profile.profileId,
        })
        .select('*')
        .single()
      if (error) {
        console.error('Could not create landing announcement:', error.message)
        return jsonResponse(503, { error: 'Could not create the announcement.' })
      }
      return jsonResponse(201, {
        success: true,
        announcement: {
          id: data.id,
          category: data.category,
          title: data.title,
          summary: data.summary,
          content: data.content,
          links: data.links,
          isPublished: data.is_published,
          publishedAt: data.published_at,
          createdAt: data.created_at,
        },
      })
    }

    if (routeParts.length === 3 && routeParts[2] === 'publication' && request.method === 'PUT') {
      const announcementId = routeParts[1]
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(announcementId)) {
        return jsonResponse(400, { error: 'Announcement ID is invalid.' })
      }
      const body: unknown = await request.json().catch(() => null)
      if (!isRecord(body) || typeof body.isPublished !== 'boolean') {
        return jsonResponse(400, { error: 'Announcement publication state is invalid.' })
      }
      const { data, error } = await admin
        .from('landing_announcements')
        .update({
          is_published: body.isPublished,
          published_at: body.isPublished ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', announcementId)
        .select('id, is_published, published_at')
        .maybeSingle()
      if (error) {
        console.error('Could not change announcement publication state:', error.message)
        return jsonResponse(503, { error: 'Could not change announcement publication state.' })
      }
      if (!data) return jsonResponse(404, { error: 'Announcement was not found.' })
      return jsonResponse(200, {
        success: true,
        isPublished: data.is_published,
        publishedAt: data.published_at,
      })
    }

    if (routeParts.length === 2 && request.method === 'PUT') {
      const announcementId = routeParts[1]
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(announcementId)) {
        return jsonResponse(400, { error: 'Announcement ID is invalid.' })
      }
      const payload = parseAnnouncementPayload(await request.json().catch(() => null))
      if (!payload) return jsonResponse(400, { error: 'Announcement fields are invalid.' })
      const { data, error } = await admin
        .from('landing_announcements')
        .update({
          category: payload.category,
          title: payload.title,
          summary: payload.summary,
          content: payload.content,
          links: payload.links,
          updated_at: new Date().toISOString(),
        })
        .eq('id', announcementId)
        .select('*')
        .maybeSingle()
      if (error) {
        console.error('Could not update landing announcement:', error.message)
        return jsonResponse(503, { error: 'Could not update the announcement.' })
      }
      if (!data) return jsonResponse(404, { error: 'Announcement was not found.' })
      return jsonResponse(200, {
        success: true,
        announcement: {
          id: data.id,
          category: data.category,
          title: data.title,
          summary: data.summary,
          content: data.content,
          links: data.links,
          isPublished: data.is_published,
          publishedAt: data.published_at,
          createdAt: data.created_at,
        },
      })
    }

    if (routeParts.length === 2 && request.method === 'DELETE') {
      const announcementId = routeParts[1]
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(announcementId)) {
        return jsonResponse(400, { error: 'Announcement ID is invalid.' })
      }
      const { data, error } = await admin
        .from('landing_announcements')
        .delete()
        .eq('id', announcementId)
        .eq('is_published', false)
        .select('id')
        .maybeSingle()
      if (error) {
        console.error('Could not delete landing announcement:', error.message)
        return jsonResponse(503, { error: 'Could not delete the announcement.' })
      }
      if (!data) return jsonResponse(409, { error: 'Unpublish the announcement before deleting it.' })
      return jsonResponse(200, { success: true })
    }

    return jsonResponse(404, { error: 'Announcement route not found.' })
  }

  if (routeParts[0] === 'installers') {
    if (!isAdmin) return jsonResponse(403, { error: 'Admin rank required to manage installers.' })
    if (routeParts.length === 2 && routeParts[1] === 'import-history' && request.method === 'POST') {
      try {
        const history = historyRows(await fetchInstallerHistory(), profile.profileId)
        const { data, error } = history.length
          ? await admin
            .from('landing_installer_catalog')
            .upsert(history, { onConflict: 'platform,edition,version', ignoreDuplicates: true })
            .select('id')
          : { data: [], error: null }
        if (error) {
          console.error('Could not import installer release history:', error.message)
          return jsonResponse(503, { error: 'Could not import GitHub installer history.' })
        }
        return jsonResponse(200, {
          success: true,
          imported: data?.length ?? 0,
          found: history.length,
        })
      } catch (error) {
        console.error('Could not import installer release history:', error)
        return jsonResponse(503, {
          error: error instanceof Error ? error.message : 'Could not import GitHub installer history.',
        })
      }
    }

    if (routeParts.length === 1 && request.method === 'GET') {
      const { data, error } = await admin
        .from('landing_installer_catalog')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2000)
      if (error) {
        console.error('Could not load landing installer catalog:', error.message)
        return jsonResponse(503, { error: 'Could not load installer history.' })
      }
      return jsonResponse(200, {
        success: true,
        installers: (data ?? []).map((item) => ({
          id: item.id,
          platform: item.platform,
          edition: item.edition,
          version: item.version,
          installerUrl: item.installer_url,
          checksumUrl: item.checksum_url,
          releaseUrl: item.release_url,
          isPublished: item.is_published,
          isPrerelease: item.is_prerelease,
          publishedAt: item.published_at,
          releaseDate: item.release_date,
          createdAt: item.created_at,
        })),
      })
    }

    if (routeParts.length === 1 && request.method === 'POST') {
      const payload = parseInstallerPayload(await request.json().catch(() => null))
      if (!payload) return jsonResponse(400, { error: 'Installer fields are invalid.' })
      const { data, error } = await admin
        .from('landing_installer_catalog')
        .insert({
          platform: payload.platform,
          edition: payload.edition,
          version: payload.version,
          installer_url: payload.installerUrl,
          checksum_url: payload.checksumUrl,
          release_url: payload.releaseUrl,
          release_date: new Date().toISOString(),
          created_by_profile_id: profile.profileId,
        })
        .select('*')
        .single()
      if (error) {
        if (error.code === '23505') return jsonResponse(409, { error: 'That version already exists for this platform and edition.' })
        console.error('Could not create installer catalog entry:', error.message)
        return jsonResponse(503, { error: 'Could not create the installer entry.' })
      }
      return jsonResponse(201, {
        success: true,
        installer: {
          id: data.id,
          platform: data.platform,
          edition: data.edition,
          version: data.version,
          installerUrl: data.installer_url,
          checksumUrl: data.checksum_url,
          releaseUrl: data.release_url,
          isPublished: data.is_published,
          isPrerelease: data.is_prerelease,
          publishedAt: data.published_at,
          releaseDate: data.release_date,
          createdAt: data.created_at,
        },
      })
    }

    if (routeParts.length === 3 && routeParts[2] === 'publication' && request.method === 'PUT') {
      const installerId = routeParts[1]
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installerId)) {
        return jsonResponse(400, { error: 'Installer ID is invalid.' })
      }
      const body: unknown = await request.json().catch(() => null)
      if (!isRecord(body) || typeof body.isPublished !== 'boolean') {
        return jsonResponse(400, { error: 'Installer publication state is invalid.' })
      }

      if (body.isPublished) {
        const { data: installer, error: installerError } = await admin
          .from('landing_installer_catalog')
          .select('platform, edition, version, installer_url, checksum_url, release_url, is_prerelease')
          .eq('id', installerId)
          .maybeSingle()
        if (installerError) {
          console.error('Could not load installer before publishing:', installerError.message)
          return jsonResponse(503, { error: 'Could not verify the installer before publishing.' })
        }
        if (!installer) return jsonResponse(404, { error: 'Installer entry was not found.' })
        if (!installer.installer_url || !installer.checksum_url) {
          return jsonResponse(422, { error: 'An installer asset and SHA-256 checksum are required before publication.' })
        }
        if (installer.is_prerelease) {
          return jsonResponse(422, { error: 'Pre-releases cannot be selected for public distribution.' })
        }
        if (installer.platform === 'linux' || installer.platform === 'macos') {
          return jsonResponse(422, {
            error: 'Linux and macOS installers cannot be published until their packaging workflow and artifacts are verified.',
          })
        }
        if (installer.platform === 'windows' && installer.edition === 'normal') {
          const verified = await verifyRelease(installer.version, 'stable')
          if (!verified.ok) return jsonResponse(422, { error: verified.error })
        }
        if (installer.platform === 'windows' && installer.edition === 'lite') {
          const verified = await verifyLiteRelease(installer.version)
          if (!verified.ok) return jsonResponse(422, { error: verified.error })
        }
        if (installer.edition === 'mobile' && (installer.platform === 'android' || installer.platform === 'ios')) {
          const verified = await verifyMobileRelease(
            installer.version,
            installer.platform,
            installer.installer_url,
            installer.checksum_url,
            installer.release_url,
          )
          if (!verified.ok) return jsonResponse(422, { error: verified.error })
        }
        const { data, error } = await admin.rpc('publish_landing_installer', {
          p_installer_id: installerId,
          p_updated_by_user_id: auth.githubId,
        })
        if (error) {
          console.error('Could not publish landing installer:', error.message)
          return jsonResponse(503, { error: 'Could not publish the installer.' })
        }
        const published = Array.isArray(data) ? data[0] : null
        if (!published) return jsonResponse(404, { error: 'Installer entry was not found.' })
        return jsonResponse(200, {
          success: true,
          installer: {
            id: published.id,
            platform: published.platform,
            edition: published.edition,
            version: published.version,
            installerUrl: published.installer_url,
            checksumUrl: published.checksum_url,
            releaseUrl: published.release_url,
            isPublished: published.is_published,
            isPrerelease: published.is_prerelease,
            publishedAt: published.published_at,
            releaseDate: published.release_date,
            createdAt: published.created_at,
          },
        })
      }

      const { data: current, error: currentError } = await admin
        .from('landing_installer_catalog')
        .select('platform, edition, is_published')
        .eq('id', installerId)
        .maybeSingle()
      if (currentError) {
        console.error('Could not load installer before unpublishing:', currentError.message)
        return jsonResponse(503, { error: 'Could not change installer publication state.' })
      }
      if (!current) return jsonResponse(404, { error: 'Installer entry was not found.' })
      if (current.is_published && current.platform === 'windows' && ['normal', 'lite'].includes(current.edition)) {
        return jsonResponse(409, { error: 'Publish a replacement Windows version before hiding this installer.' })
      }
      const { data, error } = await admin
        .from('landing_installer_catalog')
        .update({ is_published: false, published_at: null, updated_at: new Date().toISOString() })
        .eq('id', installerId)
        .select('*')
        .maybeSingle()
      if (error) {
        console.error('Could not unpublish landing installer:', error.message)
        return jsonResponse(503, { error: 'Could not unpublish the installer.' })
      }
      if (!data) return jsonResponse(404, { error: 'Installer entry was not found.' })
      return jsonResponse(200, {
        success: true,
        installer: {
          id: data.id,
          platform: data.platform,
          edition: data.edition,
          version: data.version,
          installerUrl: data.installer_url,
          checksumUrl: data.checksum_url,
          releaseUrl: data.release_url,
          isPublished: data.is_published,
          isPrerelease: data.is_prerelease,
          publishedAt: data.published_at,
          releaseDate: data.release_date,
          createdAt: data.created_at,
        },
      })
    }

    if (routeParts.length === 2 && request.method === 'DELETE') {
      const installerId = routeParts[1]
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installerId)) {
        return jsonResponse(400, { error: 'Installer ID is invalid.' })
      }
      const { data, error } = await admin
        .from('landing_installer_catalog')
        .delete()
        .eq('id', installerId)
        .eq('is_published', false)
        .select('id')
        .maybeSingle()
      if (error) {
        console.error('Could not delete installer catalog entry:', error.message)
        return jsonResponse(503, { error: 'Could not delete the installer entry.' })
      }
      if (!data) return jsonResponse(409, { error: 'Unpublish the installer before deleting it.' })
      return jsonResponse(200, { success: true })
    }

    return jsonResponse(404, { error: 'Installer route not found.' })
  }

  if (route === 'lite-policy') {
    if (!isAdmin) return jsonResponse(403, { error: 'Admin rank required to view HELIX Lite release policy.' })
    if (request.method === 'GET') {
      const { data, error } = await admin
        .from('release_policies')
        .select('public_version, channel, updated_at')
        .eq('id', 'lite')
        .maybeSingle()
      if (error) {
        console.error('Could not load HELIX Lite release policy:', error.message)
        return jsonResponse(503, { error: 'Could not load the HELIX Lite release policy.' })
      }
      if (!data) return jsonResponse(503, { error: 'HELIX Lite release policy has not been provisioned.' })
      return jsonResponse(200, {
        success: true,
        data: { publicVersion: data.public_version, channel: data.channel, updatedAt: data.updated_at },
      })
    }
    if (request.method === 'PUT') {
      if (profile.rank !== 'master-admin') {
        return jsonResponse(403, { error: 'Master admin rank required to publish HELIX Lite releases.' })
      }
      const body: unknown = await request.json().catch(() => null)
      if (
        body === null
        || typeof body !== 'object'
        || !('publicVersion' in body)
        || typeof body.publicVersion !== 'string'
        || !/^\d+\.\d+\.\d+$/.test(body.publicVersion)
      ) return jsonResponse(400, { error: 'HELIX Lite version must use the format major.minor.patch.' })

      const verified = await verifyLiteRelease(body.publicVersion)
      if (!verified.ok) return jsonResponse(422, { error: verified.error })

      const { data, error } = await admin
        .from('release_policies')
        .upsert({
          id: 'lite',
          public_version: body.publicVersion,
          channel: 'stable',
          auto_update: true,
          check_interval_hours: 24,
          updated_by_user_id: auth.githubId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select('public_version, channel, updated_at')
        .single()
      if (error) {
        console.error('Could not save HELIX Lite release policy:', error.message)
        return jsonResponse(503, { error: 'Could not save the HELIX Lite release policy.' })
      }
      return jsonResponse(200, {
        success: true,
        data: { publicVersion: data.public_version, channel: data.channel, updatedAt: data.updated_at },
      })
    }
    return jsonResponse(405, { error: 'Method not allowed.' })
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
