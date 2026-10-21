import { supabase } from './supabase'

const UPDATE_METADATA_URL = 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-updates/latest.yml'
const LITE_RELEASE_URL = 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-lite-updates'

export interface LiteReleaseDownload {
  version: string
  installerUrl: string
  checksumUrl: string
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
  const response = await fetch(LITE_RELEASE_URL, {
    signal,
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`The HELIX Lite release service returned HTTP ${response.status}.`)
  const release: unknown = await response.json()
  if (
    !release
    || typeof release !== 'object'
    || !('version' in release)
    || typeof release.version !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(release.version)
    || !('tag' in release)
    || release.tag !== `lite-v${release.version}`
    || !('installerUrl' in release)
    || typeof release.installerUrl !== 'string'
    || !('checksumUrl' in release)
    || typeof release.checksumUrl !== 'string'
    || !('releaseUrl' in release)
    || typeof release.releaseUrl !== 'string'
  ) throw new Error('The HELIX Lite release service returned invalid data.')

  const releaseUrl = new URL(release.releaseUrl)
  const installerUrl = new URL(release.installerUrl)
  const checksumUrl = new URL(release.checksumUrl)
  const releaseBase = '/joelpizza0818-blip/Helix-Assitant/releases'
  if (
    releaseUrl.protocol !== 'https:'
    || releaseUrl.hostname !== 'github.com'
    || releaseUrl.pathname !== `${releaseBase}/tag/${release.tag}`
    || installerUrl.protocol !== 'https:'
    || installerUrl.hostname !== 'github.com'
    || installerUrl.pathname !== `${releaseBase}/download/${release.tag}/HELIX-Lite-Setup.exe`
    || checksumUrl.protocol !== 'https:'
    || checksumUrl.hostname !== 'github.com'
    || checksumUrl.pathname !== `${releaseBase}/download/${release.tag}/HELIX-Lite-Setup.exe.sha256`
  ) {
    throw new Error('The HELIX Lite release returned an untrusted asset URL.')
  }

  return {
    version: release.version,
    installerUrl: installerUrl.toString(),
    checksumUrl: checksumUrl.toString(),
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
