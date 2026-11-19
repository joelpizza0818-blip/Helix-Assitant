/**
 * write-artifact-checksums.mjs <directory> <extension...>
 *
 * Writes a `<artifact>.sha256` sidecar next to every artifact that matches one
 * of the given extensions. The sidecar format is compatible with `sha256sum -c`
 * and with the checksum files already published for Windows and Android.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [directory, ...extensions] = process.argv.slice(2)
if (!directory || extensions.length === 0) {
  throw new Error('Usage: node scripts/write-artifact-checksums.mjs <directory> <extension...>')
}

const wanted = new Set(extensions.map((extension) => extension.toLowerCase()))
const artifacts = readdirSync(directory)
  .filter((name) => wanted.has(path.extname(name).toLowerCase()))
  .filter((name) => statSync(path.join(directory, name)).isFile())
  .sort()

if (artifacts.length === 0) {
  throw new Error(`No artifacts with extensions ${extensions.join(', ')} found in ${directory}`)
}

for (const name of artifacts) {
  const filePath = path.join(directory, name)
  const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex')
  writeFileSync(`${filePath}.sha256`, `${hash}  ${name}\n`, 'utf8')
  console.log(`${hash}  ${name}`)
}
