import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GITHUB_API = 'https://api.github.com'
const RELEASE_ASSET_HOSTS = new Set([
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
])
const UPDATE_ASSET_PATTERN = /^HELIX-Setup-\d+(?:\.\d+){1,3}\.exe(?:\.blockmap)?$/

interface ReleaseAsset {
  id: number
  name: string
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
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await supabase
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

function response(status: number, body: string, contentType: string, cacheControl = 'no-store'): Response {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Cache-Control': cacheControl,
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function isReleaseAsset(value: unknown): value is ReleaseAsset {
  return value !== null
    && typeof value === 'object'
    && 'id' in value
    && typeof value.id === 'number'
    && 'name' in value
    && typeof value.name === 'string'
}

function getReleaseAssets(value: unknown): ReleaseAsset[] {
  if (!Array.isArray(value)) return []
  const candidates: unknown[] = value
  return candidates.filter(isReleaseAsset)
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return response(204, '', 'text/plain')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return response(405, 'Method not allowed', 'text/plain')
  }

  const githubOwner = Deno.env.get('GITHUB_INSTALLER_OWNER')
  const githubRepo = Deno.env.get('GITHUB_INSTALLER_REPO')
  const githubToken = Deno.env.get('GITHUB_INSTALLER_TOKEN')
  if (!githubOwner || !githubRepo || !githubToken) {
    console.error('Installer updater is missing GitHub release configuration.')
    return response(503, 'Updater is not configured.', 'text/plain')
  }

  const url = new URL(request.url)
  const route = url.pathname.split('/installer-updates/')[1] ?? 'latest.yml'
  const isMetadata = route === '' || route === 'latest.yml'
  const isPolicy = route === 'policy.json'
  const assetName = route.startsWith('download/') ? decodeURIComponent(route.slice('download/'.length)) : ''
  if (!isMetadata && !isPolicy && !UPDATE_ASSET_PATTERN.test(assetName)) {
    return response(404, 'Not found', 'text/plain')
  }

  const policyResult = await readReleasePolicy()
  if (policyResult.error) {
    console.error('Could not read the public release policy:', policyResult.error)
    return response(503, 'Release policy is temporarily unavailable.', 'text/plain')
  }
  const policy = policyResult.policy
  if (isPolicy) {
    const body = JSON.stringify({
      publicVersion: policy?.public_version ?? null,
      channel: policy?.channel ?? 'stable',
      autoUpdate: policy?.auto_update ?? true,
      checkIntervalHours: policy?.check_interval_hours ?? 24,
    })
    return response(
      200,
      request.method === 'HEAD' ? '' : body,
      'application/json; charset=utf-8',
      'public, max-age=60',
    )
  }

  const githubHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'HELIX-desktop-updater',
  }
  let releaseResponse: Response
  try {
    releaseResponse = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}/releases/${policy ? `tags/${encodeURIComponent(releaseTag(policy.public_version))}` : 'latest'}`,
      { headers: githubHeaders },
    )
  } catch (error) {
    console.error('Could not contact GitHub for updater release metadata:', error)
    return response(503, 'Update service is temporarily unavailable.', 'text/plain')
  }
  if (!releaseResponse.ok) {
    console.error('GitHub updater release lookup failed with status:', releaseResponse.status)
    return response(503, 'No update release is available.', 'text/plain')
  }

  const release = await releaseResponse.json().catch((error: unknown) => {
    console.error('GitHub returned invalid updater release metadata:', error)
    return null
  })
  if (!release || typeof release !== 'object' || !('assets' in release) || !Array.isArray(release.assets)) {
    return response(503, 'Invalid release metadata.', 'text/plain')
  }
  if (
    policy
    && (
      !('tag_name' in release)
      || release.tag_name !== releaseTag(policy.public_version)
      || !('prerelease' in release)
      || (policy.channel === 'stable' && release.prerelease === true)
      || (policy.channel === 'beta' && release.prerelease !== true)
    )
  ) {
    console.error('The selected public release does not match the configured tag and channel.')
    return response(503, 'Configured public release is unavailable.', 'text/plain')
  }
  const assets = getReleaseAssets(release.assets)
  const requestedName = isMetadata ? 'latest.yml' : assetName
  const asset = assets.find((candidate) => candidate.name === requestedName)
  if (!asset) return response(404, 'Update asset not found.', 'text/plain')

  let assetResponse: Response
  try {
    assetResponse = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(githubOwner)}/${encodeURIComponent(githubRepo)}/releases/assets/${asset.id}`,
      { headers: { ...githubHeaders, Accept: 'application/octet-stream' }, redirect: 'manual' },
    )
  } catch (error) {
    console.error('Could not resolve private update asset:', error)
    return response(503, 'Update asset is temporarily unavailable.', 'text/plain')
  }
  const location = assetResponse.headers.get('Location')
  if (assetResponse.status !== 302 || !location) {
    console.error('GitHub did not return a temporary update asset URL.')
    return response(503, 'Update asset is temporarily unavailable.', 'text/plain')
  }

  let signedUrl: URL
  try {
    signedUrl = new URL(location)
  } catch {
    return response(503, 'GitHub returned an invalid update URL.', 'text/plain')
  }
  if (signedUrl.protocol !== 'https:' || !RELEASE_ASSET_HOSTS.has(signedUrl.hostname)) {
    console.error('GitHub returned an update URL on an unexpected host.')
    return response(503, 'Update asset is temporarily unavailable.', 'text/plain')
  }

  if (!isMetadata) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: signedUrl.toString(),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  let metadataResponse: Response
  try {
    metadataResponse = await fetch(signedUrl)
  } catch (error) {
    console.error('Could not retrieve private updater metadata:', error)
    return response(503, 'Update metadata is temporarily unavailable.', 'text/plain')
  }
  if (!metadataResponse.ok) return response(503, 'Update metadata is temporarily unavailable.', 'text/plain')
  const metadata = await metadataResponse.text()
  if (metadata.length > 64_000) return response(503, 'Update metadata is invalid.', 'text/plain')

  const baseUrl = 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-updates/download/'
  const rewrittenMetadata = metadata.replace(
    /^(\s*(?:url|path):\s*)(.+?)\s*$/gm,
    (line, prefix: string, value: string) => {
      const name = value.replace(/^["']|["']$/g, '')
      if (!UPDATE_ASSET_PATTERN.test(name) || !assets.some((candidate) => candidate.name === name)) {
        return line
      }
      return `${prefix}${baseUrl}${encodeURIComponent(name)}`
    },
  )
  if (!/^version:\s*\S+/m.test(rewrittenMetadata) || !/^sha512:\s*\S+/m.test(rewrittenMetadata)) {
    return response(503, 'Update metadata is invalid.', 'text/plain')
  }
  if (request.method === 'HEAD') return response(200, '', 'text/yaml', 'public, max-age=300')
  return response(200, rewrittenMetadata, 'text/yaml; charset=utf-8', 'public, max-age=300')
})
