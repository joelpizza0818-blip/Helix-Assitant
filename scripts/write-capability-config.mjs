import { writeFile } from 'node:fs/promises'

const publicKey = process.env.HELIX_CAPABILITY_PUBLIC_KEY ?? ''
if (publicKey) {
  const decoded = Buffer.from(publicKey, 'base64')
  if (decoded.length !== 32 || decoded.toString('base64') !== publicKey) {
    throw new Error('HELIX_CAPABILITY_PUBLIC_KEY must be a canonical Base64 encoding of a 32-byte Ed25519 public key.')
  }
}
const config = {
  publicKey,
  catalogUrl: 'https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/capability-packs/catalog.json',
}
await writeFile(
  new URL('../apps/desktop/capability-config.json', import.meta.url),
  `${JSON.stringify(config, null, 2)}\n`,
  'utf8',
)
