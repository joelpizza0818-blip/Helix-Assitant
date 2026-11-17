import fs from 'fs'
import path from 'path'

export interface HelixStoragePaths {
  root: string
  appData: string
  cache: string
  logs: string
  temp: string
  models: string
  binaries: string
  agent: string
  computerHome: string
}

export function resolveHelixStoragePaths(
  desktopPath: string,
  configuredRoot?: string,
): HelixStoragePaths {
  const root = path.resolve(
    configuredRoot?.trim() || path.join(desktopPath, 'helix-storage'),
  )

  return {
    root,
    appData: path.join(root, 'desktop'),
    cache: path.join(root, 'cache'),
    logs: path.join(root, 'logs'),
    temp: path.join(root, 'temp'),
    models: path.join(root, 'models'),
    binaries: path.join(root, 'bin'),
    agent: path.join(root, 'agent'),
    computerHome: path.join(root, 'computer-home'),
  }
}

export function migrateUserData(
  sourcePath: string,
  destinationPath: string,
): boolean {
  const source = path.resolve(sourcePath)
  const destination = path.resolve(destinationPath)
  const samePath = process.platform === 'win32'
    ? source.toLowerCase() === destination.toLowerCase()
    : source === destination
  if (
    samePath
    || !fs.existsSync(source)
    || fs.existsSync(destination)
  ) {
    return false
  }

  fs.cpSync(source, destination, {
    recursive: true,
    filter: (entry) => {
      const relativePath = path.relative(source, entry)
      const firstSegment = relativePath.split(path.sep)[0]?.toLowerCase()
      return firstSegment !== 'models' && firstSegment !== 'bin'
    },
  })
  return true
}
