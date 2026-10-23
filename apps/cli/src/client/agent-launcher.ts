import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import WebSocket from 'ws';

let spawnedAgentProcess: ChildProcess | null = null;
let activeSpawnToken: string | null = null;
let startupPromise: Promise<boolean> | null = null;

export function getTokenFilePath(): string {
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME || '', 'Library/Application Support')
      : path.join(process.env.HOME || '', '.config'));
  const helixDir = path.join(appData, 'HELIX');
  if (!fs.existsSync(helixDir)) {
    try {
      fs.mkdirSync(helixDir, { recursive: true });
    } catch {}
  }
  return path.join(helixDir, '.ws_token');
}

export function getOrGenerateWsToken(): string {
  if (activeSpawnToken) return activeSpawnToken;
  if (process.env.HELIX_WS_TOKEN) {
    activeSpawnToken = process.env.HELIX_WS_TOKEN;
    return activeSpawnToken;
  }

  const tokenFile = getTokenFilePath();
  if (fs.existsSync(tokenFile)) {
    try {
      const saved = fs.readFileSync(tokenFile, 'utf-8').trim();
      if (saved.length >= 16) {
        activeSpawnToken = saved;
        process.env.HELIX_WS_TOKEN = activeSpawnToken;
        return activeSpawnToken;
      }
    } catch {}
  }

  activeSpawnToken = crypto.randomBytes(32).toString('hex');
  process.env.HELIX_WS_TOKEN = activeSpawnToken;
  try {
    fs.writeFileSync(tokenFile, activeSpawnToken, { encoding: 'utf-8', mode: 0o600 });
  } catch {}
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

  // On Windows, prefer pythonw.exe so NO console terminal window is opened
  if (process.platform === 'win32') {
    const venvGuiCandidates = [
      path.join(repoRoot, '.venv', 'Scripts', 'pythonw.exe'),
      path.join(repoRoot, 'venv', 'Scripts', 'pythonw.exe'),
      path.join(repoRoot, 'services', 'agent', '.venv', 'Scripts', 'pythonw.exe'),
    ];

    for (const venvGui of venvGuiCandidates) {
      if (fs.existsSync(venvGui)) {
        return venvGui;
      }
    }
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
  const systemCandidates = process.platform === 'win32'
    ? ['pythonw', 'python', 'py']
    : ['python', 'python3', 'py'];
  return systemCandidates[0];
}

/**
 * Probes a TCP port quietly without initiating a WebSocket handshake.
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
 * Probes the WebSocket endpoint with Authorization header.
 * Returns:
 *   'ready': 101 Switching Protocols (authenticated and connected)
 *   'unauthorized': 401 Unauthorized (wrong token / rogue process on port)
 *   'closed': Connection refused / port closed
 */
export function probeWebSocketAuth(
  port: number = 8765,
  token?: string,
  host: string = '127.0.0.1',
  timeoutMs: number = 1000
): Promise<'ready' | 'unauthorized' | 'closed'> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const headers: Record<string, string> = {};
    const effectiveToken = token || getOrGenerateWsToken();
    if (effectiveToken) {
      headers['Authorization'] = `Bearer ${effectiveToken}`;
    }

    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`ws://${host}:${port}`, { headers });
    } catch {
      return resolve('closed');
    }

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (ws) {
        ws.removeAllListeners();
        ws.on('error', () => {});
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          } else {
            ws.terminate();
          }
        } catch {}
      }
    };

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve('closed');
      }
    }, timeoutMs);

    ws.once('open', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve('ready');
      }
    });

    ws.once('error', (err: Error) => {
      if (!settled) {
        settled = true;
        const msg = err.message || '';
        cleanup();
        if (msg.includes('401') || msg.includes('Unexpected server response: 401')) {
          resolve('unauthorized');
        } else {
          resolve('closed');
        }
      }
    });
  });
}

/**
 * Waits until the agent service has completed startup and successfully accepts WebSocket authentication.
 */
export async function waitForAgentReady(
  port: number = 8765,
  token?: string,
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

        const authState = await probeWebSocketAuth(port, token);
        if (authState === 'ready') {
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

export async function spawnAgentDaemon(port: number = 8765): Promise<{ success: boolean; error?: string }> {
  const token = getOrGenerateWsToken();

  // 1. Check if the agent is already up and authenticated
  const currentStatus = await probeWebSocketAuth(port, token, '127.0.0.1', 500);
  if (currentStatus === 'ready') {
    return { success: true };
  }

  if (currentStatus === 'unauthorized') {
    return {
      success: false,
      error: `El puerto ${port} ya lo usa un agente HELIX que requiere otro token. Cierra esa instancia o inicia el CLI con --token.`,
    };
  }

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

  const agentDir = path.dirname(scriptPath);
  const repoRoot = path.resolve(agentDir, '../..');
  const pythonExec = findPythonExecutable(repoRoot);

  try {
    const child = spawn(
      pythonExec,
      ['main.py', '--ws-port', String(port), '--no-camera'],
      {
        cwd: agentDir,
        detached: process.platform !== 'win32',
        stdio: 'ignore', // run completely in background
        windowsHide: true,
        env: {
          ...process.env,
          HELIX_WS_TOKEN: token,
          HELIX_DISABLE_CAMERA: '1',
          CAMERA_ENABLED: 'false',
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

