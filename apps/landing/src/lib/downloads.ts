import { supabase } from './supabase'

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
