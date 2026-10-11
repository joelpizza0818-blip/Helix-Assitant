import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GITHUB_API = 'https://api.github.com'
const LITE_RELEASE_OWNER = 'joelpizza0818-blip'
const LITE_RELEASE_REPOSITORY = 'Helix-Assitant'
const INSTALLER_NAME = 'HELIX-Lite-Setup.exe'
const CHECKSUM_NAME = `${INSTALLER_NAME}.sha256`

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function isReleaseAsset(value: unknown): value is ReleaseAsset {
  return value !== null
    && typeof value === 'object'
    && 'name' in value
    && typeof value.name === 'string'
    && 'browser_download_url' in value
    && typeof value.browser_download_url === 'string'
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return response(204, {})
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return response(405, { error: 'Method not allowed.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('HELIX Lite update policy storage is not configured.')
    return response(503, { error: 'HELIX Lite update service is not configured.' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: policy, error } = await supabase
    .from('release_policies')
    .select('public_version, channel')
    .eq('id', 'lite')
    .maybeSingle()
  if (error) {
    console.error('Could not read HELIX Lite release policy:', error.message)
    return response(503, { error: 'HELIX Lite release policy is temporarily unavailable.' })
  }
  if (
    !policy
    || typeof policy.public_version !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(policy.public_version)
    || policy.channel !== 'stable'
  ) return response(503, { error: 'No HELIX Lite release has been published by Admin.' })

  const tag = `lite-v${policy.public_version}`
  let releaseResponse: Response
  try {
    releaseResponse = await fetch(
      `${GITHUB_API}/repos/${LITE_RELEASE_OWNER}/${LITE_RELEASE_REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'HELIX-Lite-Updater',
        },
        signal: AbortSignal.timeout(8000),
      },
    )
  } catch (error) {
    console.error('Could not contact GitHub for the selected HELIX Lite release:', error)
    return response(503, { error: 'HELIX Lite release metadata is temporarily unavailable.' })
  }
  if (!releaseResponse.ok) {
    console.error('The Admin-selected HELIX Lite release could not be found:', releaseResponse.status)
    return response(503, { error: 'The Admin-selected HELIX Lite release is unavailable.' })
  }

  const release: unknown = await releaseResponse.json().catch(() => null)
  if (
    release === null
    || typeof release !== 'object'
    || !('tag_name' in release)
    || release.tag_name !== tag
    || !('draft' in release)
    || release.draft !== false
    || !('prerelease' in release)
    || release.prerelease !== false
    || !('html_url' in release)
    || typeof release.html_url !== 'string'
    || !('assets' in release)
    || !Array.isArray(release.assets)
  ) return response(503, { error: 'The selected HELIX Lite release has invalid metadata.' })

  const assets = release.assets.filter(isReleaseAsset)
  const installer = assets.find((asset) => asset.name === INSTALLER_NAME)
  const checksum = assets.find((asset) => asset.name === CHECKSUM_NAME)
  if (!installer || !checksum) {
    return response(503, { error: 'The selected HELIX Lite release is missing its installer or checksum.' })
  }
  const urls = [release.html_url, installer.browser_download_url, checksum.browser_download_url]
  if (urls.some((value) => {
    try {
      const url = new URL(value)
      return url.protocol !== 'https:' || url.hostname !== 'github.com'
    } catch {
      return true
    }
  })) return response(503, { error: 'The selected HELIX Lite release contains an untrusted URL.' })

  const body = {
    version: policy.public_version,
    tag,
    installerUrl: installer.browser_download_url,
    checksumUrl: checksum.browser_download_url,
    releaseUrl: release.html_url,
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
