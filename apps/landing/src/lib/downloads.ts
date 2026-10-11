import { supabase } from './supabase'

const UPDATE_METADATA_URL = 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-updates/latest.yml'
const LITE_RELEASES_URL = 'https://api.github.com/repos/joelpizza0818-blip/Helix-Assitant/releases?per_page=100'

export interface LiteReleaseDownload {
  version: string
  installerUrl: string
  releaseUrl: string
}

export async function getLatestInstallerVersion(signal?: AbortSignal): Promise<string> {
  const response = await fetch(UPDATE_METADATA_URL, {
    cache: 'no-store',
    signal,
  })
  if (!response.ok) {
    throw new Error(`The update service returned HTTP ${response.status}.`)
  }

  const metadata = await response.text()
  const version = metadata.match(
    /^version:\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\s*$/m,
  )?.[1]
  if (!version) {
    throw new Error('The update service returned invalid version metadata.')
  }

  return version
}

export async function getLatestLiteRelease(signal?: AbortSignal): Promise<LiteReleaseDownload> {
  const response = await fetch(LITE_RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  })
  if (!response.ok) throw new Error(`The HELIX Lite release service returned HTTP ${response.status}.`)

  const releases: unknown = await response.json()
  if (!Array.isArray(releases)) throw new Error('The HELIX Lite release service returned invalid data.')
  const release = releases.find((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return false
    const value = candidate as Record<string, unknown>
    return typeof value.tag_name === 'string'
      && /^lite-v\d+\.\d+\.\d+$/.test(value.tag_name)
      && value.draft === false
      && value.prerelease === false
  }) as Record<string, unknown> | undefined
  if (!release || !Array.isArray(release.assets) || typeof release.html_url !== 'string') {
    throw new Error('No stable HELIX Lite release with downloadable assets is published.')
  }
  const tagName = typeof release.tag_name === 'string' ? release.tag_name : ''
  if (!/^lite-v\d+\.\d+\.\d+$/.test(tagName)) {
    throw new Error('The latest HELIX Lite release has an invalid version tag.')
  }

  const installer = release.assets.find((asset: unknown) => (
    asset !== null
    && typeof asset === 'object'
    && 'name' in asset
    && asset.name === 'HELIX-Lite-Setup.exe'
    && 'browser_download_url' in asset
    && typeof asset.browser_download_url === 'string'
  )) as { browser_download_url: string } | undefined
  const checksum = release.assets.find((asset: unknown) => (
    asset !== null
    && typeof asset === 'object'
    && 'name' in asset
    && asset.name === 'HELIX-Lite-Setup.exe.sha256'
    && 'browser_download_url' in asset
    && typeof asset.browser_download_url === 'string'
  )) as { browser_download_url: string } | undefined
  if (!installer || !checksum) {
    throw new Error('The latest HELIX Lite release is missing its installer or SHA-256 checksum.')
  }

  const releaseUrl = new URL(release.html_url)
  const installerUrl = new URL(installer.browser_download_url)
  const checksumUrl = new URL(checksum.browser_download_url)
  if (
    releaseUrl.protocol !== 'https:'
    || releaseUrl.hostname !== 'github.com'
    || installerUrl.protocol !== 'https:'
    || installerUrl.hostname !== 'github.com'
    || checksumUrl.protocol !== 'https:'
    || checksumUrl.hostname !== 'github.com'
  ) {
    throw new Error('The HELIX Lite release returned an untrusted asset URL.')
  }

  return {
    version: tagName.slice('lite-v'.length),
    installerUrl: installerUrl.toString(),
    releaseUrl: releaseUrl.toString(),
  }
}

export async function getInstallerDownloadUrl(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('installer-download', {
    method: 'POST',
  })
  if (error) throw error
  if (!data || typeof data.signedUrl !== 'string') {
    throw new Error('The installer download service returned an invalid response.')
  }

  const signedUrl = new URL(data.signedUrl)
  const trustedReleaseHosts = new Set([
    'release-assets.githubusercontent.com',
    'objects.githubusercontent.com',
  ])
  if (
    signedUrl.protocol !== 'https:' ||
    !trustedReleaseHosts.has(signedUrl.hostname)
  ) {
    throw new Error('The installer service returned an untrusted download URL.')
  }
  return signedUrl.toString()
}
