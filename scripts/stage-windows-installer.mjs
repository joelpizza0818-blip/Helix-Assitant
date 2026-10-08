import { copyFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDirectory = path.join(repoRoot, 'apps', 'desktop', 'release')
const downloadDirectory = path.join(repoRoot, 'apps', 'landing', 'private-downloads')
const installerFiles = (await readdir(releaseDirectory))
  .filter((file) => /^(HELIX-Setup-.*|HELIX Setup .*?)\.exe$/i.test(file))
  .sort()

if (installerFiles.length === 0) {
  throw new Error(`No HELIX NSIS installer found in ${releaseDirectory}. Build the desktop app first.`)
}

const installer = installerFiles.at(-1)
await mkdir(downloadDirectory, { recursive: true })
await copyFile(
  path.join(releaseDirectory, installer),
  path.join(downloadDirectory, 'HELIX-Setup.exe')
)

console.log(`Staged ${installer} as apps/landing/private-downloads/HELIX-Setup.exe`)
