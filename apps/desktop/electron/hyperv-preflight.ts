import { execFile as execFileCallback } from 'child_process'
import { promisify } from 'util'

const execFile = promisify(execFileCallback)

const PREFLIGHT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$edition = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').EditionID
$featureState = 'Unknown'
$featureError = $null
try {
  $featureState = (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V).State.ToString()
} catch {
  $featureError = $_.Exception.Message
}
$moduleAvailable = [bool](Get-Module -ListAvailable -Name Hyper-V | Select-Object -First 1)
$serviceRunning = $null
try {
  $service = Get-Service -Name vmms -ErrorAction Stop
  $serviceRunning = $service.Status -eq 'Running'
} catch {
  $serviceRunning = $false
}
[pscustomobject]@{
  edition = $edition
  feature_state = $featureState
  feature_error = $featureError
  module_available = $moduleAvailable
  service_running = $serviceRunning
} | ConvertTo-Json -Compress
`

export type HyperVFeatureState = 'Enabled' | 'Disabled' | 'EnablePending' | 'DisablePending' | 'Unknown'

export interface HyperVPreflight {
  supportedHost: boolean
  edition: string | null
  featureState: HyperVFeatureState
  moduleAvailable: boolean
  serviceRunning: boolean | null
  ready: boolean
  blockers: string[]
  featureCheckError?: string
}

interface PowerShellPreflight {
  edition?: unknown
  feature_state?: unknown
  feature_error?: unknown
  module_available?: unknown
  service_running?: unknown
}

type PowerShellRunner = (encodedCommand: string) => Promise<string>

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

export async function getHyperVPreflight(
  platform: NodeJS.Platform = process.platform,
  runner: PowerShellRunner = runPowerShell,
): Promise<HyperVPreflight> {
  if (platform !== 'win32') {
    return {
      supportedHost: false,
      edition: null,
      featureState: 'Unknown',
      moduleAvailable: false,
      serviceRunning: null,
      ready: false,
      blockers: ['Hyper-V desktop virtualization is currently supported only on Windows.'],
    }
  }

  const encodedCommand = Buffer.from(PREFLIGHT_SCRIPT, 'utf16le').toString('base64')
  const output = await runner(encodedCommand)
  let probe: PowerShellPreflight
  try {
    probe = JSON.parse(output.trim()) as PowerShellPreflight
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : ''
    throw new Error(`Windows returned an invalid Hyper-V compatibility response.${detail}`)
  }

  const edition = typeof probe.edition === 'string' ? probe.edition : null
  const supportedHost = edition !== null
    && /^(Professional|Enterprise|Education)/.test(edition)
  const knownFeatureStates: HyperVFeatureState[] = [
    'Enabled',
    'Disabled',
    'EnablePending',
    'DisablePending',
  ]
  const featureState = typeof probe.feature_state === 'string'
    && knownFeatureStates.includes(probe.feature_state as HyperVFeatureState)
    ? probe.feature_state as HyperVFeatureState
    : 'Unknown'
  const moduleAvailable = probe.module_available === true
  const serviceRunning = typeof probe.service_running === 'boolean'
    ? probe.service_running
    : null
  const ready = supportedHost
    && featureState === 'Enabled'
    && moduleAvailable
    && serviceRunning === true
  const blockers: string[] = []

  if (!supportedHost) {
    blockers.push('Windows Pro, Education, or Enterprise is required; Windows Home is not supported.')
  }
  if (featureState !== 'Enabled') {
    blockers.push(featureState === 'Unknown'
      ? 'The Hyper-V Windows feature could not be verified. Run HELIX with access to Windows optional-feature status.'
      : 'Enable Hyper-V in Windows Features and restart Windows before using the isolated desktop.')
  }
  if (!moduleAvailable) {
    blockers.push('The Hyper-V PowerShell management tools are unavailable.')
  }
  if (serviceRunning !== true) {
    blockers.push('The Hyper-V Virtual Machine Management service is not running.')
  }

  return {
    supportedHost,
    edition,
    featureState,
    moduleAvailable,
    serviceRunning,
    ready,
    blockers,
    ...(typeof probe.feature_error === 'string' && probe.feature_error.length > 0
      ? { featureCheckError: probe.feature_error }
      : {}),
  }
}
