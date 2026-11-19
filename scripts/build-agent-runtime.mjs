/**
 * build-agent-runtime.mjs
 *
 * Builds the bundled HELIX Python agent with PyInstaller.
 *
 * Windows keeps using scripts/build-agent-runtime.ps1 unchanged so the existing
 * installer pipeline is not affected. Linux and macOS use the same layout that
 * electron/main.ts expects: agent-runtime/helix-agent/helix-agent.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (process.platform === 'win32') {
  const result = spawnSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', path.join(repoRoot, 'scripts', 'build-agent-runtime.ps1')],
    { stdio: 'inherit' },
  )
  process.exit(result.status ?? 1)
}

const runtimeRoot = path.join(repoRoot, 'apps', 'desktop', 'agent-runtime')
const workRoot = path.join(repoRoot, 'apps', 'desktop', '.pyinstaller-work')
const specRoot = path.join(repoRoot, 'apps', 'desktop', '.pyinstaller-spec')
const agentSource = path.join(repoRoot, 'services', 'agent')
const launcher = path.join(repoRoot, 'scripts', 'helix_agent_launcher.py')
const runtimeDirectory = path.join(runtimeRoot, 'helix-agent')
const binaryName = 'helix-agent'

function commandWorks(command) {
  const probe = spawnSync(command, ['--version'], { stdio: 'ignore' })
  return probe.status === 0
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  return result
}

const pythonCandidates = [
  process.env.HELIX_PYTHON,
  path.join(agentSource, '.venv', 'bin', 'python'),
  path.join(repoRoot, '.venv', 'bin', 'python'),
  'python3',
  'python',
].filter(Boolean)

const python = pythonCandidates.find((candidate) =>
  candidate.includes(path.sep) ? existsSync(candidate) : commandWorks(candidate),
)
if (!python) {
  throw new Error(
    'Python 3.11+ is required to build the bundled HELIX agent. '
    + 'Create services/agent/.venv or set HELIX_PYTHON.',
  )
}

const pyinstallerProbe = run(python, ['-m', 'PyInstaller', '--version'], { capture: true })
if (pyinstallerProbe.status !== 0) {
  console.log('[agent-runtime] Installing PyInstaller')
  const install = run(python, ['-m', 'pip', 'install', 'pyinstaller'])
  if (install.status !== 0) {
    throw new Error(`Could not install PyInstaller with ${python}.`)
  }
}

function availableModules(names) {
  const script = [
    'import importlib.util, json',
    'names = json.loads(__import__("os").environ["HELIX_MODULE_PROBE"])',
    'found = {}',
    'for name in names:',
    '    try:',
    '        found[name] = importlib.util.find_spec(name) is not None',
    '    except Exception:',
    '        found[name] = False',
    'print(json.dumps(found))',
  ].join('\n')
  const probe = spawnSync(python, ['-c', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, HELIX_MODULE_PROBE: JSON.stringify(names) },
  })
  if (probe.status !== 0) {
    throw new Error(`Could not inspect installed Python packages:\n${probe.stderr}`)
  }
  return JSON.parse(probe.stdout.trim().split('\n').pop())
}

const optionalPackages = [
  'edge_tts',
  'faster_whisper',
  'openwakeword',
  'mediapipe',
  'onnxruntime',
  'playwright',
  'tqdm',
  'keyring',
  'cryptography',
  'cv2',
  'numpy',
  'sounddevice',
  'soundfile',
  'pyautogui',
  'mss',
  'PIL',
  'psutil',
]
const keyringBackends = process.platform === 'darwin'
  ? ['keyring.backends.macOS']
  : ['keyring.backends.SecretService', 'keyring.backends.libsecret', 'secretstorage']
const metadataPackages = ['edge-tts', 'faster-whisper', 'openwakeword', 'mediapipe', 'onnxruntime', 'playwright', 'tqdm']
const metadataModules = {
  'edge-tts': 'edge_tts',
  'faster-whisper': 'faster_whisper',
  'openwakeword': 'openwakeword',
  mediapipe: 'mediapipe',
  onnxruntime: 'onnxruntime',
  playwright: 'playwright',
  tqdm: 'tqdm',
}

const available = availableModules([...optionalPackages, ...keyringBackends])

mkdirSync(runtimeRoot, { recursive: true })
for (const entry of readdirSync(runtimeRoot)) {
  if (entry === '.gitkeep') continue
  rmSync(path.join(runtimeRoot, entry), { recursive: true, force: true })
}
mkdirSync(workRoot, { recursive: true })
mkdirSync(specRoot, { recursive: true })

const stagingRoot = path.join(workRoot, 'agent-runtime-data')
rmSync(stagingRoot, { recursive: true, force: true })
const stagedAgent = path.join(stagingRoot, 'services', 'agent')
cpSync(agentSource, stagedAgent, {
  recursive: true,
  filter: (source) => {
    const relative = path.relative(agentSource, source)
    if (!relative) return true
    const segments = relative.split(path.sep)
    if (segments.some((segment) => ['tests', '__pycache__', '.venv', '.pytest_cache'].includes(segment))) {
      return false
    }
    const base = path.basename(source)
    if (base === 'script.py' || base === 'get_quiz.py' || base.endsWith('.pyc')) {
      return false
    }
    return true
  },
})

const testModuleExclusions = []
const testsDirectory = path.join(agentSource, 'tests')
if (existsSync(testsDirectory)) {
  for (const entry of readdirSync(testsDirectory)) {
    if (!entry.endsWith('.py') || entry === '__init__.py') continue
    testModuleExclusions.push('--exclude-module', `services.agent.tests.${entry.slice(0, -3)}`)
  }
}

const collectedSubmodules = [
  'services.agent',
  'core',
  'ai',
  'browser',
  'memory',
  'mcp',
  'models',
  'perception',
  'plugins',
  'security',
  'skills',
  'tasks',
  'tools',
]

const args = [
  '-m', 'PyInstaller',
  '--noconfirm',
  '--onedir',
  '--name', binaryName,
  '--distpath', runtimeRoot,
  '--workpath', workRoot,
  '--specpath', specRoot,
  '--paths', repoRoot,
  '--paths', agentSource,
  '--add-data', `${stagedAgent}${path.delimiter}services/agent`,
  ...testModuleExclusions,
]

for (const submodule of collectedSubmodules) {
  args.push('--collect-submodules', submodule)
}
for (const packageName of optionalPackages) {
  if (available[packageName]) args.push('--collect-all', packageName)
}
for (const backend of keyringBackends) {
  if (available[backend]) args.push('--hidden-import', backend)
}
for (const metadata of metadataPackages) {
  if (available[metadataModules[metadata]]) args.push('--copy-metadata', metadata)
}
args.push(launcher)

console.log(`[agent-runtime] Building with ${python}`)
const build = run(python, args)
if (build.status !== 0) {
  throw new Error('PyInstaller failed to build the bundled HELIX agent.')
}

const binaryPath = path.join(runtimeDirectory, binaryName)
if (!existsSync(binaryPath)) {
  throw new Error(`PyInstaller completed without producing ${binaryPath}`)
}

// The launcher resolves services/agent/main.py relative to its bundled
// directory, which PyInstaller 6 places in _internal on every platform.
const modelSource = path.join(agentSource, 'models')
if (existsSync(modelSource)) {
  for (const target of [
    path.join(runtimeDirectory, 'services', 'agent', 'models'),
    path.join(runtimeDirectory, '_internal', 'services', 'agent', 'models'),
  ]) {
    mkdirSync(target, { recursive: true })
    cpSync(modelSource, target, { recursive: true })
  }
}

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(fullPath))
    else files.push(fullPath)
  }
  return files
}

const runtimeFiles = walk(runtimeDirectory)
const hasMain = runtimeFiles.some((file) => /services[\\/]agent[\\/]main\.py$/.test(file))
if (!hasMain) {
  throw new Error('The packaged runtime is missing services/agent/main.py.')
}
for (const model of ['hand_landmarker.task', 'hey_helix.onnx']) {
  if (!runtimeFiles.some((file) => path.basename(file) === model)) {
    throw new Error(`The packaged runtime is missing ${model}.`)
  }
}
const forbidden = runtimeFiles.filter((file) =>
  /services[\\/]agent[\\/]tests[\\/]/.test(file)
  || /services[\\/]agent[\\/](script|get_quiz)\.py$/.test(file))
if (forbidden.length > 0) {
  throw new Error(`The packaged runtime contains excluded source files: ${forbidden.slice(0, 5).join(', ')}`)
}

const totalBytes = runtimeFiles.reduce((sum, file) => sum + statSync(file).size, 0)
console.log(`[agent-runtime] Bundled agent: ${binaryPath}`)
console.log(`[agent-runtime] ${runtimeFiles.length} files, ${totalBytes} bytes`)
