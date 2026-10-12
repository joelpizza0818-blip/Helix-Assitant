import fs from 'fs'
import path from 'path'

export interface CapabilityConfig {
  publicKey: string
  catalogUrl: string
}

const DEFAULT_CATALOG_URL = 'https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/capability-packs/catalog.json'

export function readCapabilityConfig(isPackaged: boolean, resourcesPath: string): CapabilityConfig {
  if (!isPackaged) {
    return {
      publicKey: process.env.HELIX_CAPABILITY_PUBLIC_KEY ?? '',
      catalogUrl: process.env.HELIX_CAPABILITY_CATALOG_URL ?? DEFAULT_CATALOG_URL,
    }
  }
  const configPath = path.join(resourcesPath, 'capability-config.json')
  const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('Packaged capability configuration is invalid.')
  const candidate = parsed as Partial<CapabilityConfig>
  if (
    typeof candidate.publicKey !== 'string'
    || (candidate.catalogUrl !== undefined && typeof candidate.catalogUrl !== 'string')
  ) {
    throw new Error('Packaged capability configuration is invalid.')
  }
  return {
    publicKey: candidate.publicKey,
    catalogUrl: candidate.catalogUrl ?? DEFAULT_CATALOG_URL,
  }
}
