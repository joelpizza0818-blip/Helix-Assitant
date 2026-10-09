import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bump = process.argv[2]
const dryRun = process.argv.includes('--dry-run')

if (!['patch', 'minor', 'major'].includes(bump)) {
  throw new Error('Usage: node scripts/bump-desktop-version.mjs <patch|minor|major> [--dry-run]')
}

const desktopPackagePath = path.join(root, 'apps', 'desktop', 'package.json')
const lockfilePath = path.join(root, 'package-lock.json')
const desktopPackage = JSON.parse(fs.readFileSync(desktopPackagePath, 'utf8'))
const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'))
const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(desktopPackage.version)

if (!versionMatch) {
  throw new Error(`Desktop version must be a stable semantic version, got "${desktopPackage.version}".`)
}
if (lockfile.packages?.['apps/desktop']?.version !== desktopPackage.version) {
  throw new Error('Desktop package version and package-lock workspace version do not match.')
}

let [, major, minor, patch] = versionMatch.map(Number)
if (bump === 'major') {
  major += 1
  minor = 0
  patch = 0
} else if (bump === 'minor') {
  minor += 1
  patch = 0
} else {
  patch += 1
}

const nextVersion = `${major}.${minor}.${patch}`
if (!dryRun) {
  desktopPackage.version = nextVersion
  lockfile.packages['apps/desktop'].version = nextVersion
  fs.writeFileSync(desktopPackagePath, `${JSON.stringify(desktopPackage, null, 2)}\n`)
  fs.writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`)
}

console.log(nextVersion)
