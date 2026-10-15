import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';

let spawnedAgentProcess: ChildProcess | null = null;
let activeSpawnToken: string | null = null;
let startupPromise: Promise<boolean> | null = null;

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

export function isAgentStarting(): boolean {
  return startupPromise !== null;
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

export function findPythonExecutable(repoRoot: string): string {
  // Check explicit environment variable first
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }

  // Check virtual environment candidates relative to repository root
  const venvCandidates = [
    path.join(repoRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(repoRoot, '.venv', 'bin', 'python'),
    path.join(repoRoot, 'venv', 'Scripts', 'python.exe'),
    path.join(repoRoot, 'venv', 'bin', 'python'),
    path.join(repoRoot, 'services', 'agent', '.venv', 'Scripts', 'python.exe'),
    path.join(repoRoot, 'services', 'agent', '.venv', 'bin', 'python'),
  ];

  for (const venvPython of venvCandidates) {
    if (fs.existsSync(venvPython)) {
      return venvPython;
    }
  }

  // Fallback to system PATH executables
  const systemCandidates = ['python', 'python3', 'py'];
  return systemCandidates[0];
}

/**
 * Probes a TCP port quietly without initiating a WebSocket handshake.
 * Returns true if the port is actively listening and accepts connections.
 */
export function probePort(port: number, host: string = '127.0.0.1', timeoutMs: number = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(true);
      }
    });

    socket.once('timeout', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.once('error', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(false);
      }
    });

    try {
      socket.connect(port, host);
    } catch {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }
  });
}

/**
 * Waits until the agent service has completed startup and is listening on the port.
 * During this time, callers should block retries until this promise resolves.
 */
export async function waitForAgentReady(
  port: number = 8765,
  maxWaitMs: number = 45000,
  pollIntervalMs: number = 1000,
  onProgress?: (elapsedSec: number) => void
): Promise<boolean> {
  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    const startTime = Date.now();
    try {
      while (Date.now() - startTime < maxWaitMs) {
        // If the spawned child process exited prematurely with an error code, abort
        if (spawnedAgentProcess !== null && spawnedAgentProcess.exitCode !== null) {
          return false;
        }

        const ready = await probePort(port);
        if (ready) {
          return true;
        }

        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        if (onProgress) {
          onProgress(elapsedSec);
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      return false;
    } finally {
      startupPromise = null;
    }
  })();

  return startupPromise;
}

export function spawnAgentDaemon(port: number = 8765): { success: boolean; error?: string } {
  if (isAgentProcessRunning() || isAgentStarting()) {
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
  const pythonExec = findPythonExecutable(repoRoot);

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

