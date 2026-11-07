import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'

export type DeveloperTerminalShell = 'powershell' | 'cmd' | 'bash'

interface ShellExecutable {
  command: string
  args: string[]
}

function findExecutable(command: string, env: NodeJS.ProcessEnv): string | null {
  const pathEntries = (env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const extensions = process.platform === 'win32' && !path.extname(command)
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
    : ['']
  const candidates = path.isAbsolute(command)
    ? [command]
    : pathEntries.flatMap((directory) => extensions.map((extension) => path.join(directory, `${command}${extension}`)))

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      continue
    }
  }
  return null
}

function getShellExecutables(env: NodeJS.ProcessEnv = process.env): Map<DeveloperTerminalShell, ShellExecutable> {
  const shells: Array<[DeveloperTerminalShell, string[], string[]]> = process.platform === 'win32'
    ? [
        ['powershell', ['pwsh.exe', 'powershell.exe'], ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-']],
        ['cmd', ['cmd.exe'], []],
        ['bash', ['bash.exe'], ['--login', '--interactive']],
      ]
    : [
        ['powershell', ['pwsh'], ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-']],
        ['bash', ['bash'], ['--login', '--interactive']],
      ]
  const available = new Map<DeveloperTerminalShell, ShellExecutable>()
  for (const [shell, candidates, args] of shells) {
    for (const candidate of candidates) {
      const command = findExecutable(candidate, env)
      if (command) {
        available.set(shell, { command, args })
        break
      }
    }
  }
  return available
}

export function getAvailableDeveloperTerminalShells(): DeveloperTerminalShell[] {
  return [...getShellExecutables().keys()]
}

export function startDeveloperTerminalProcess(
  shell: DeveloperTerminalShell,
  cwd: string,
  cols: number,
  rows: number,
): ChildProcessWithoutNullStreams {
  const executable = getShellExecutables().get(shell)
  if (!executable) throw new Error(`The ${shell} shell is not installed or is not available on PATH.`)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    COLUMNS: String(cols),
    LINES: String(rows),
  }
  delete env.ELECTRON_RUN_AS_NODE
  return spawn(executable.command, executable.args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}
