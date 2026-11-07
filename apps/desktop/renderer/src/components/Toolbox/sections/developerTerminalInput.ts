import type { DeveloperTerminalShell } from '../../../types/global'

export function prefixDeveloperCommandWithProjectPath(
  shell: DeveloperTerminalShell,
  projectRootPath: string,
  command: string,
): string {
  if (shell === 'powershell') {
    const quotedPath = `'${projectRootPath.replace(/'/g, "''")}'`
    return `Set-Location -LiteralPath ${quotedPath}; ${command}`
  }
  if (shell === 'cmd') {
    const quotedPath = `"${projectRootPath.replace(/"/g, '""')}"`
    return `cd /d ${quotedPath} && ${command}`
  }

  const quoteBashPath = (path: string) => `'${path.replace(/'/g, "'\\''")}'`
  const gitBashPath = projectRootPath.replace(/^([a-z]):[\\/]/i, (_, drive: string) => `/${drive.toLowerCase()}/`).replace(/\\/g, '/')
  const wslPath = projectRootPath.replace(/^([a-z]):[\\/]/i, (_, drive: string) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, '/')
  return `cd ${quoteBashPath(projectRootPath)} 2>/dev/null || cd ${quoteBashPath(gitBashPath)} 2>/dev/null || cd ${quoteBashPath(wslPath)} || exit; ${command}`
}

export function createDeveloperTerminalInputHandler(
  writeCommand: (command: string) => void,
  echo: (text: string) => void,
): (data: string) => void {
  let command = ''
  let skipNextLineFeed = false
  let escapeState: 'none' | 'start' | 'csi' = 'none'

  return (data) => {
    for (const character of data) {
      if (escapeState === 'start') {
        escapeState = character === '[' ? 'csi' : 'none'
        continue
      }
      if (escapeState === 'csi') {
        if (character >= '@' && character <= '~') escapeState = 'none'
        continue
      }
      if (character === '\n' && skipNextLineFeed) {
        skipNextLineFeed = false
        continue
      }
      skipNextLineFeed = false

      if (character === '\r' || character === '\n') {
        echo('\r\n')
        writeCommand(`${command}\r\n`)
        command = ''
        skipNextLineFeed = character === '\r'
      } else if (character === '\b' || character === '\x7f') {
        if (command.length === 0) continue
        const characters = Array.from(command)
        characters.pop()
        command = characters.join('')
        echo('\b \b')
      } else if (character === '\x03') {
        command = ''
        echo('^C\r\n')
      } else if (character === '\x1b') {
        escapeState = 'start'
      } else if (character >= ' ') {
        command += character
        echo(character)
      }
    }
  }
}
