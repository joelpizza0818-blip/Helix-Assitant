import { access, copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDirectory = path.join(repoRoot, 'apps', 'desktop', 'release')
const downloadDirectory = path.join(repoRoot, 'apps', 'landing', 'private-downloads')
const desktopPackage = JSON.parse(await readFile(path.join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf8'))
const installer = `HELIX-Setup-${desktopPackage.version}.exe`
const installerPath = path.join(releaseDirectory, installer)
const updateArtifacts = [
  `${installer}.blockmap`,
  'latest.yml',
]
for (const artifact of [installerPath, ...updateArtifacts.map((file) => path.join(releaseDirectory, file))]) {
  try {
    await access(artifact)
  } catch {
    throw new Error(`Required installer update artifact is missing: ${artifact}. Build the desktop app first.`)
  }
}

await mkdir(downloadDirectory, { recursive: true })
await copyFile(installerPath, path.join(downloadDirectory, 'HELIX-Setup.exe'))
for (const artifact of [installer, ...updateArtifacts]) {
  await copyFile(path.join(releaseDirectory, artifact), path.join(downloadDirectory, artifact))
}

console.log(`Staged ${installer} and its updater metadata in apps/landing/private-downloads`)
