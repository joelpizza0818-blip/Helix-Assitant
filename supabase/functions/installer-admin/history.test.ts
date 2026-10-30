import {
  getInstallerHistorySources,
  mergeInstallerHistoryRows,
} from '../_shared/installer-history.ts'

Deno.test('installer history includes both release repositories and a configured source', () => {
  const sources = getInstallerHistorySources('example', 'custom-releases')
  const normalized = sources.map(({ owner, repository }) =>
    `${owner}/${repository}`.toLowerCase()
  )
  for (
    const expected of [
      'joelpizza0818-blip/helix-assitant',
      'joelpizza0818-blip/helix-installer-downloads',
      'example/custom-releases',
    ]
  ) {
    if (!normalized.includes(expected)) {
      throw new Error(`Missing installer history source: ${expected}`)
    }
  }

  const deduplicated = getInstallerHistorySources(
    'JOELPIZZA0818-BLIP',
    'HELIX-ASSITANT',
  )
  if (deduplicated.length !== 2) {
    throw new Error('Configured duplicate repositories should be deduplicated.')
  }
})

Deno.test('installer history prefers complete assets when repositories share a release tag', () => {
  const incomplete = {
    platform: 'windows',
    edition: 'normal',
    version: '0.5.0',
    installer_url: null,
    checksum_url: null,
    release_url:
      'https://github.com/joelpizza0818-blip/Helix-Assitant/releases/tag/v0.5.0',
  }
  const complete = {
    ...incomplete,
    installer_url:
      'https://github.com/joelpizza0818-blip/helix-installer-downloads/releases/download/v0.5.0/HELIX-Setup.exe',
    checksum_url:
      'https://github.com/joelpizza0818-blip/helix-installer-downloads/releases/download/v0.5.0/HELIX-Setup.exe.sha256',
    release_url:
      'https://github.com/joelpizza0818-blip/helix-installer-downloads/releases/tag/v0.5.0',
  }
  const rows = mergeInstallerHistoryRows([incomplete, complete])
  if (rows.length !== 1 || rows[0].installer_url !== complete.installer_url) {
    throw new Error(
      'The merged history must retain the release entry with valid installer assets.',
    )
  }
})
