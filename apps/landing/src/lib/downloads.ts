import { supabase } from './supabase'

const UPDATE_METADATA_URL = 'https://zqjktbpymrfjmggjmbfp.supabase.co/functions/v1/installer-updates/latest.yml'

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
