import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDeveloperTerminalInputHandler,
  prefixDeveloperCommandWithProjectPath,
} from './developerTerminalInput'

test('local terminal input edits the current command with backspace before submitting', () => {
  const commands: string[] = []
  let echoed = ''
  const handleInput = createDeveloperTerminalInputHandler(
    (command) => commands.push(command),
    (text) => { echoed += text },
  )

  handleInput('echo worl\x7fld\r')

  assert.deepEqual(commands, ['echo world\r\n'])
  assert.equal(echoed, 'echo worl\b \bld\r\n')
})

test('local terminal input handles backspace and pasted line endings without submitting twice', () => {
  const commands: string[] = []
  const handleInput = createDeveloperTerminalInputHandler(
    (command) => commands.push(command),
    () => {},
  )

  handleInput('echo ok\x08\r\n')
  handleInput('\x1b[A')
  handleInput('echo done\n')

  assert.deepEqual(commands, ['echo o\r\n', 'echo done\r\n'])
})

test('project task suggestions change to the project root for PowerShell', () => {
  assert.equal(
    prefixDeveloperCommandWithProjectPath('powershell', "C:\\Users\\O'Brien\\my project", 'npm test'),
    "Set-Location -LiteralPath 'C:\\Users\\O''Brien\\my project'; npm test",
  )
})

test('project task suggestions change to the project root for Command Prompt', () => {
  assert.equal(
    prefixDeveloperCommandWithProjectPath('cmd', 'C:\\Users\\TG computer\\my project', 'npm test'),
    'cd /d "C:\\Users\\TG computer\\my project" && npm test',
  )
})

test('project task suggestions support Git Bash and WSL paths', () => {
  assert.equal(
    prefixDeveloperCommandWithProjectPath('bash', "C:\\Users\\O'Brien\\my project", 'npm test'),
    "cd 'C:\\Users\\O'\\''Brien\\my project' 2>/dev/null || cd '/c/Users/O'\\''Brien/my project' 2>/dev/null || cd '/mnt/c/Users/O'\\''Brien/my project' || exit; npm test",
  )
})
