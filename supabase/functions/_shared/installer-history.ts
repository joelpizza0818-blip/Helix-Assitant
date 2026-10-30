export interface InstallerHistorySource {
  owner: string
  repository: string
}

export interface InstallerHistoryRow {
  platform: string
  edition: string
  version: string
  installer_url: string | null
  checksum_url: string | null
  release_url: string
  [key: string]: unknown
}

export function getInstallerHistorySources(
  configuredOwner: string | null | undefined,
  configuredRepository: string | null | undefined,
): InstallerHistorySource[] {
  const sources = [
    { owner: 'joelpizza0818-blip', repository: 'Helix-Assitant' },
    { owner: 'joelpizza0818-blip', repository: 'helix-installer-downloads' },
    {
      owner: configuredOwner ?? 'joelpizza0818-blip',
      repository: configuredRepository ?? 'Helix-Assitant',
    },
  ]
  const uniqueSources = new Map<string, InstallerHistorySource>()
  for (const source of sources) {
    uniqueSources.set(
      `${source.owner.toLowerCase()}/${source.repository.toLowerCase()}`,
      source,
    )
  }
  return [...uniqueSources.values()]
}

export function mergeInstallerHistoryRows<T extends InstallerHistoryRow>(
  rows: T[],
): T[] {
  const merged = new Map<string, T>()
  for (const row of rows) {
    const key = `${row.platform}/${row.edition}/${row.version}`.toLowerCase()
    const existing = merged.get(key)
    const hasAssets = Boolean(row.installer_url && row.checksum_url)
    const existingHasAssets = Boolean(
      existing?.installer_url && existing.checksum_url,
    )
    if (!existing || (hasAssets && !existingHasAssets)) merged.set(key, row)
  }
  return [...merged.values()]
}
