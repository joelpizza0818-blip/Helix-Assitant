import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const privateKeyPem = process.env.CAPABILITY_SIGNING_PRIVATE_KEY
const publicKey = process.env.HELIX_CAPABILITY_PUBLIC_KEY
if (!privateKeyPem || !publicKey) {
  throw new Error('CAPABILITY_SIGNING_PRIVATE_KEY and HELIX_CAPABILITY_PUBLIC_KEY are required.')
}

const privateKey = createPrivateKey(privateKeyPem)
const derivedPublicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
if (derivedPublicKey !== publicKey) {
  throw new Error('The configured capability public key does not match the signing private key.')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function signed(value) {
  return sign(null, Buffer.from(canonicalJson(value), 'utf8'), privateKey).toString('base64')
}

const pluginPath = path.join(root, '.github', 'capability-packs', 'system_diagnostics.py')
const plugin = await readFile(pluginPath)
const version = '1.0.0'
const outputDir = path.join(root, 'capability-pack-output')
const packName = `system-diagnostics-${version}.py`
await mkdir(outputDir, { recursive: true })
await writeFile(path.join(outputDir, packName), plugin)

const manifest = {
  id: 'system-diagnostics',
  version,
  capability: 'system-diagnostics',
  format: 'python-plugin',
  requiredForComplete: false,
  platform: 'win32',
  arch: 'x64',
  coreVersionRange: '*',
  sizeBytes: plugin.length,
  url: `https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/capability-packs/${packName}`,
  sha256: createHash('sha256').update(plugin).digest('hex'),
}
manifest.signature = signed(manifest)
const catalog = { version: 1, packs: [manifest] }
catalog.signature = signed(catalog)
await writeFile(path.join(outputDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`)
