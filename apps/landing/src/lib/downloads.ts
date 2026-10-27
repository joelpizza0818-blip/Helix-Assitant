import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { fetchPublicReleaseHistory, type LandingInstaller } from './landingContent'

const UPDATE_METADATA_URL = 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-updates/latest.yml'
const LITE_RELEASE_URL = 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-lite-updates'
export interface LiteReleaseDownload {
  version: string
  installerUrl: string
  checksumUrl: string
  releaseUrl: string
}

export interface MobileReleaseDownload {
  version: string
  installerUrl: string
  checksumUrl: string
  releaseUrl: string
  architecture: 'arm64' | 'universal' | 'ios'
  universalInstallerUrl: string | null
  universalChecksumUrl: string | null
}

export function mapMobileReleaseDownload(release: LandingInstaller): MobileReleaseDownload {
  if (release.platform !== 'android' && release.platform !== 'ios') {
    throw new Error(`Unsupported HELIX Mobile platform: ${release.platform}.`)
  }
  if (!release.installerUrl || !release.checksumUrl) {
    throw new Error(`The HELIX Mobile ${release.platform} release is missing an installer or checksum.`)
  }
  let architecture: MobileReleaseDownload['architecture'] = release.platform === 'ios' ? 'ios' : 'universal'
  let universalInstallerUrl: string | null = null
  let universalChecksumUrl: string | null = null
  if (release.platform === 'android') {
    const releaseTag = `mobile-v${release.version}`
    const releaseUrl = new URL(release.releaseUrl)
    const installerUrl = new URL(release.installerUrl)
    const releasePath = `/joelpizza0818-blip/Helix-Assitant/releases/tag/${releaseTag}`
    const assetPath = `/joelpizza0818-blip/Helix-Assitant/releases/download/${releaseTag}/`
    const arm64AssetName = 'HELIX-Mobile-arm64-v8a.apk'
    if (
      releaseUrl.protocol !== 'https:'
      || releaseUrl.hostname !== 'github.com'
      || releaseUrl.pathname !== releasePath
    ) {
      throw new Error('The HELIX Mobile release returned an unexpected release URL.')
    }
    if (installerUrl.protocol !== 'https:' || installerUrl.hostname !== 'github.com') {
      throw new Error('The HELIX Mobile release returned an untrusted installer URL.')
    }
    if (installerUrl.pathname === `${assetPath}${arm64AssetName}`) {
      architecture = 'arm64'
      installerUrl.pathname = `${assetPath}HELIX-Mobile.apk`
      universalInstallerUrl = installerUrl.toString()
      installerUrl.pathname += '.sha256'
      universalChecksumUrl = installerUrl.toString()
    } else if (installerUrl.pathname !== `${assetPath}HELIX-Mobile.apk`) {
      throw new Error('The HELIX Mobile release returned an unexpected Android installer URL.')
    }
  }
  return {
    version: release.version,
    installerUrl: release.installerUrl,
    checksumUrl: release.checksumUrl,
    releaseUrl: release.releaseUrl,
    architecture,
    universalInstallerUrl,
    universalChecksumUrl,
  }
}

export async function getLatestMobileRelease(
  signal?: AbortSignal,
  platform: 'android' | 'ios' = 'android',
): Promise<MobileReleaseDownload> {
  const releases = await fetchPublicReleaseHistory(signal)
  const release = releases.find((installer) => (
    installer.platform === platform && installer.edition === 'mobile'
  ))
  if (!release) throw new Error(`No stable HELIX Mobile ${platform} release with an installer and checksum is available.`)
  return mapMobileReleaseDownload(release)
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
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    const status = error.context.status
    const payload: unknown = await error.context.clone().json().catch(() => null)
    if (
      payload
      && typeof payload === 'object'
      && 'error' in payload
      && typeof payload.error === 'string'
      && payload.error.trim()
    ) {
      throw new Error(payload.error)
    }
    throw new Error(`Installer download returned HTTP ${status}.`)
  }
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
