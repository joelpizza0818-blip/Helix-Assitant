import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import test from 'node:test'
import {
  getAvailableDeveloperTerminalShells,
  startDeveloperTerminalProcess,
  type DeveloperTerminalShell,
} from './developer-terminal'

test('local terminal keeps shell state between commands and streams output', { timeout: 90_000 }, async (t) => {
  const availableShells = getAvailableDeveloperTerminalShells()
  const shell: DeveloperTerminalShell | undefined = process.platform === 'win32'
    ? availableShells.includes('powershell') ? 'powershell' : availableShells.includes('cmd') ? 'cmd' : undefined
    : availableShells.includes('bash') ? 'bash' : undefined

  if (!shell) {
    t.skip('No supported shell is installed on this machine.')
    return
  }

  const child = startDeveloperTerminalProcess(shell, os.homedir(), 80, 24)
  let output = ''
  const pendingMarkers = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  const appendOutput = (chunk: string | Buffer) => {
    output += chunk.toString()
    for (const [marker, pending] of pendingMarkers) {
      if (!output.includes(marker)) continue
      clearTimeout(pending.timer)
      pendingMarkers.delete(marker)
      pending.resolve()
    }
    if (output.length > 200_000) output = output.slice(-100_000)
  }
  child.stdout.on('data', appendOutput)
  child.stderr.on('data', appendOutput)
  const waitFor = (marker: string) => {
    if (output.includes(marker)) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingMarkers.delete(marker)
        reject(new Error(`Timed out waiting for terminal output: ${marker}\n${output}`))
      }, 20_000)
      pendingMarkers.set(marker, { resolve, reject, timer })
    })
  }
  const lineEnding = shell === 'bash' ? '\n' : '\r\n'

  try {
    const initialDirectoryCommand = shell === 'powershell'
      ? "Write-Output ('HELIX_INITIAL_CWD=' + (Get-Location).Path)"
      : shell === 'cmd'
        ? 'echo HELIX_INITIAL_CWD=%CD%'
        : 'printf "HELIX_INITIAL_CWD=%s\\n" "$PWD"'
    child.stdin.write(`${initialDirectoryCommand}${lineEnding}`)
    await waitFor(`HELIX_INITIAL_CWD=${fs.realpathSync.native(os.homedir())}`)

    const temporaryDirectory = fs.realpathSync.native(os.tmpdir())
    const firstCommand = shell === 'powershell'
      ? `Set-Location -LiteralPath '${temporaryDirectory.replace(/'/g, "''")}'; $global:HELIX_TERMINAL_VALUE='persisted'; Write-Output 'HELIX_FIRST_COMMAND_DONE'`
      : shell === 'cmd'
        ? `cd /d "${temporaryDirectory}" & set HELIX_TERMINAL_VALUE=persisted & echo HELIX_FIRST_COMMAND_DONE`
        : `cd '${temporaryDirectory.replace(/'/g, "'\\''")}' && export HELIX_TERMINAL_VALUE=persisted && echo HELIX_FIRST_COMMAND_DONE`
    child.stdin.write(`${firstCommand}${lineEnding}`)
    await waitFor('HELIX_FIRST_COMMAND_DONE')

    const secondCommand = shell === 'powershell'
      ? "Write-Output ('HELIX_STATE=' + $global:HELIX_TERMINAL_VALUE); Write-Output ('HELIX_CWD=' + (Get-Location).Path)"
      : shell === 'cmd'
        ? 'echo HELIX_STATE=%HELIX_TERMINAL_VALUE% & echo HELIX_CWD=%CD%'
        : 'echo "HELIX_STATE=$HELIX_TERMINAL_VALUE"; printf "HELIX_CWD=%s\\n" "$PWD"'
    child.stdin.write(`${secondCommand}${lineEnding}`)
    await waitFor('HELIX_STATE=persisted')
    await waitFor(`HELIX_CWD=${temporaryDirectory}`)
    assert.match(output, /HELIX_STATE=persisted/)
    assert.ok(output.includes(`HELIX_CWD=${temporaryDirectory}`))
  } finally {
    for (const pending of pendingMarkers.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Terminal process closed before the test completed.'))
    }
    child.kill()
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 1000))])
  }
})
