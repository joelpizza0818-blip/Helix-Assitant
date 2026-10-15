import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

let spawnedAgentProcess: ChildProcess | null = null;
let activeSpawnToken: string | null = null;

export function getOrGenerateWsToken(): string {
  if (activeSpawnToken) return activeSpawnToken;
  if (process.env.HELIX_WS_TOKEN) {
    activeSpawnToken = process.env.HELIX_WS_TOKEN;
    return activeSpawnToken;
  }
  activeSpawnToken = crypto.randomBytes(32).toString('hex');
  process.env.HELIX_WS_TOKEN = activeSpawnToken;
  return activeSpawnToken;
}

export function isAgentProcessRunning(): boolean {
  return spawnedAgentProcess !== null && !spawnedAgentProcess.killed;
}

export function findPythonAgentScript(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'services/agent/main.py'),
    path.resolve(__dirname, '../../../services/agent/main.py'),
    path.resolve(__dirname, '../../../../services/agent/main.py'),
    path.resolve(__dirname, '../../services/agent/main.py'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function spawnAgentDaemon(port: number = 8765): { success: boolean; error?: string } {
  if (isAgentProcessRunning()) {
    return { success: true };
  }

  const scriptPath = findPythonAgentScript();
  if (!scriptPath) {
    return {
      success: false,
      error: 'No se encontró el script services/agent/main.py del agente Python.',
    };
  }

  const token = getOrGenerateWsToken();
  const agentDir = path.dirname(scriptPath);
  const repoRoot = path.resolve(agentDir, '../..');

  // Try python environment candidates
  const pythonCandidates = [
    process.env.PYTHON_PATH,
    'python',
    'python3',
    'py',
  ].filter(Boolean) as string[];

  const pythonExec = pythonCandidates[0];

  try {
    const child = spawn(
      pythonExec,
      ['main.py', '--ws-port', String(port)],
      {
        cwd: agentDir,
        detached: true,
        stdio: 'ignore', // run completely in background
        windowsHide: true,
        env: {
          ...process.env,
          HELIX_WS_TOKEN: token,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONPATH: repoRoot,
        },
      }
    );

    child.unref();
    spawnedAgentProcess = child;

    child.on('exit', () => {
      spawnedAgentProcess = null;
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Error al invocar proceso Python: ${(err as Error).message}`,
    };
  }
}
