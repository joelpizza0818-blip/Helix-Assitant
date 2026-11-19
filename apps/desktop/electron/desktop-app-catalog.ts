import { execFile as execFileCallback } from 'child_process'
import { promisify } from 'util'

const execFile = promisify(execFileCallback)

export interface DesktopAppRecommendation {
  id: string
  sourceName: string
  equivalent: string | null
  packageName: string | null
}

interface AppMapping {
  id: string
  match: RegExp
  equivalent: string
  packageName: string
}

const APP_MAPPINGS: AppMapping[] = [
  { id: 'firefox-esr', match: /google chrome|microsoft edge(?!.*webview)/i, equivalent: 'Firefox ESR', packageName: 'firefox-esr' },
  { id: 'libreoffice', match: /microsoft (?:office|365|word|excel|powerpoint)/i, equivalent: 'LibreOffice', packageName: 'libreoffice' },
  { id: 'gimp', match: /adobe photoshop|paint\.net/i, equivalent: 'GIMP', packageName: 'gimp' },
  { id: 'evince', match: /adobe acrobat|acrobat reader/i, equivalent: 'Document Viewer', packageName: 'evince' },
  { id: 'mousepad', match: /notepad\+\+|windows notepad|windows\.notepad/i, equivalent: 'Mousepad', packageName: 'mousepad' },
  { id: 'vlc', match: /vlc media player/i, equivalent: 'VLC', packageName: 'vlc' },
  { id: 'xarchiver', match: /7-zip|winrar/i, equivalent: 'Xarchiver', packageName: 'xarchiver' },
  { id: 'gnome-calculator', match: /windows\.calculator|windows calculator/i, equivalent: 'Calculator', packageName: 'gnome-calculator' },
  { id: 'shotwell', match: /windows\.photos|microsoft photos/i, equivalent: 'Shotwell', packageName: 'shotwell' },
]

const APP_ID_PATTERN = /^[a-z0-9-]{1,32}$/
const APP_NAME_MAX_LENGTH = 120

export type PowerShellRunner = (encodedCommand: string) => Promise<string>

const runPowerShell: PowerShellRunner = async (encodedCommand) => {
  const { stdout } = await execFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedCommand,
    ],
    { windowsHide: true, timeout: 15_000, maxBuffer: 128 * 1024 },
  )
  return stdout
}

const INVENTORY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$paths = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$names = [System.Collections.Generic.List[string]]::new()
foreach ($path in $paths) {
  Get-ItemProperty -Path $path -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -and $_.SystemComponent -ne 1 } |
    ForEach-Object { $names.Add([string]$_.DisplayName) }
}
$startMenuPaths = @(
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs')
)
foreach ($path in $startMenuPaths) {
  Get-ChildItem -LiteralPath $path -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object { $names.Add([string]$_.BaseName) }
}
Get-AppxPackage -ErrorAction SilentlyContinue |
  Where-Object { -not $_.IsFramework -and $_.NonRemovable -ne $true } |
  ForEach-Object { $names.Add([string]$_.Name) }
$uniqueNames = @(
  $names |
    Where-Object { $_ -and $_.Trim() } |
    ForEach-Object { $_.Trim() } |
    Sort-Object -Unique |
    Select-Object -First 500
)
ConvertTo-Json -InputObject $uniqueNames -Compress
`

export async function detectDesktopApps(
  platform: NodeJS.Platform = process.platform,
  runner: PowerShellRunner = runPowerShell,
): Promise<DesktopAppRecommendation[]> {
  if (platform !== 'win32') {
    throw new Error('Windows app detection is available only on Windows.')
  }
  const encoded = Buffer.from(INVENTORY_SCRIPT, 'utf16le').toString('base64')
  const output = await runner(encoded)
  let names: unknown
  try {
    names = JSON.parse(output.trim())
  } catch (error) {
    throw new Error(`Windows returned an invalid installed-app inventory: ${String(error)}`)
  }
  if (typeof names === 'string') names = [names]
  if (!Array.isArray(names)) {
    throw new Error('Windows returned an invalid installed-app inventory.')
  }

  const seen = new Set<string>()
  const recommendations: DesktopAppRecommendation[] = []
  for (const rawName of names) {
    if (typeof rawName !== 'string') continue
    const sourceName = rawName.trim().slice(0, APP_NAME_MAX_LENGTH)
    if (!sourceName || seen.has(sourceName.toLowerCase())) continue
    seen.add(sourceName.toLowerCase())
    const mapping = APP_MAPPINGS.find((candidate) => candidate.match.test(sourceName))
    recommendations.push({
      id: mapping?.id ?? '',
      sourceName,
      equivalent: mapping?.equivalent ?? null,
      packageName: mapping?.packageName ?? null,
    })
  }
  return recommendations
}

export function getApprovedDesktopAppPackages(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > APP_MAPPINGS.length) {
    throw new TypeError('Select one or more recognized Linux app equivalents to install.')
  }
  const byId = new Map(APP_MAPPINGS.map((mapping) => [mapping.id, mapping]))
  const packages = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !APP_ID_PATTERN.test(id)) {
      throw new TypeError('The selected desktop app is invalid.')
    }
    const mapping = byId.get(id)
    if (!mapping) throw new TypeError(`The Linux app equivalent '${id}' is not supported.`)
    packages.add(mapping.packageName)
  }
  return [...packages]
}

export function getDesktopAppNames(ids: string[]): string[] {
  const byId = new Map(APP_MAPPINGS.map((mapping) => [mapping.id, mapping]))
  return ids.map((id) => {
    const mapping = byId.get(id)
    if (!mapping) throw new TypeError('The selected desktop app is invalid.')
    return mapping.equivalent
  })
}
