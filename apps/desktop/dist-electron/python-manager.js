"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PythonManager = void 0;
const child_process_1 = require("child_process");
const net_1 = require("net");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const ws_1 = __importDefault(require("ws"));
const RESTART_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
class PythonManager {
    constructor() {
        this.process = null;
        this.agentDir = '';
        this.wsPort = 8765;
        this.settingsPath = '';
        this.packagedAgent = null;
        this.restartCount = 0;
        this.maxRestarts = 5;
        this.stopping = false;
        this.restartTimer = null;
        this.stdoutHandlers = [];
        this.stderrHandlers = [];
        this.exitHandlers = [];
    }
    async start(agentDir, wsPort, settingsPath, packagedAgent) {
        this.agentDir = agentDir;
        this.wsPort = await this.findAvailablePort(wsPort);
        this.settingsPath = settingsPath;
        this.packagedAgent = packagedAgent ?? null;
        if (this.wsPort !== wsPort) {
            console.warn(`[PythonManager] Port ${wsPort} is already in use; using ${this.wsPort} instead`);
        }
        this.stopping = false;
        this.restartCount = 0;
        await this._spawn();
        try {
            await this._waitForReady();
        }
        catch (error) {
            await this.stop();
            throw error;
        }
        return this.wsPort;
    }
    async _waitForReady(timeoutMs = 90000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const child = this.process;
            if (!child || child.exitCode !== null || child.signalCode !== null) {
                throw new Error('Python agent exited before its WebSocket became ready');
            }
            const ready = await new Promise((resolve) => {
                const socket = new ws_1.default(`ws://127.0.0.1:${this.wsPort}`);
                let settled = false;
                let timeout = null;
                const finish = (connected) => {
                    if (settled)
                        return;
                    settled = true;
                    if (timeout)
                        clearTimeout(timeout);
                    socket.close();
                    resolve(connected);
                };
                timeout = setTimeout(() => finish(false), 1000);
                socket.once('open', () => finish(true));
                socket.once('error', () => finish(false));
            });
            if (ready) {
                console.log(`[PythonManager] Agent WebSocket ready on port ${this.wsPort}`);
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(`Python agent WebSocket did not become ready on port ${this.wsPort} within ${timeoutMs}ms`);
    }
    findAvailablePort(preferredPort) {
        return new Promise((resolve, reject) => {
            const server = (0, net_1.createServer)();
            server.once('error', (error) => {
                if (error.code !== 'EADDRINUSE') {
                    reject(error);
                    return;
                }
                const fallbackServer = (0, net_1.createServer)();
                fallbackServer.once('error', reject);
                fallbackServer.listen(0, '127.0.0.1', () => {
                    const address = fallbackServer.address();
                    if (!address || typeof address === 'string') {
                        fallbackServer.close();
                        reject(new Error('Could not determine an available agent port'));
                        return;
                    }
                    fallbackServer.close((closeError) => {
                        if (closeError)
                            reject(closeError);
                        else
                            resolve(address.port);
                    });
                });
            });
            server.listen(preferredPort, '127.0.0.1', () => {
                server.close((error) => {
                    if (error)
                        reject(error);
                    else
                        resolve(preferredPort);
                });
            });
        });
    }
    async _spawn() {
        const executable = this.packagedAgent || this._findPython();
        if (!executable) {
            throw new Error('Python executable not found. Install Python 3.11+ and ensure it is in PATH.');
        }
        const mainScript = path_1.default.join(this.agentDir, 'main.py');
        if (!fs_1.default.existsSync(mainScript)) {
            throw new Error(`Python agent main.py not found at: ${mainScript}`);
        }
        const args = this.packagedAgent
            ? ['--ws-port', String(this.wsPort)]
            : ['main.py', '--ws-port', String(this.wsPort)];
        const workingDirectory = this.packagedAgent
            ? path_1.default.dirname(this.packagedAgent)
            : this.agentDir;
        console.log(`[PythonManager] Spawning: ${executable} ${args.join(' ')}`);
        console.log(`[PythonManager] Working dir: ${workingDirectory}`);
        this.process = (0, child_process_1.spawn)(executable, args, {
            cwd: workingDirectory,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            env: {
                ...process.env,
                PYTHONIOENCODING: 'utf-8',
                PYTHONUTF8: '1',
                PYTHONPATH: [
                    path_1.default.resolve(this.agentDir, '../..'),
                    process.env.PYTHONPATH
                ].filter(Boolean).join(path_1.default.delimiter),
                HELIX_SETTINGS_PATH: this.settingsPath
            }
        });
        let stdoutBuffer = '';
        this.process.stdout?.on('data', (data) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() ?? '';
            lines.forEach((line) => {
                if (line.trim()) {
                    this.stdoutHandlers.forEach((h) => h(line));
                }
            });
        });
        let stderrBuffer = '';
        this.process.stderr?.on('data', (data) => {
            stderrBuffer += data.toString();
            const lines = stderrBuffer.split('\n');
            stderrBuffer = lines.pop() ?? '';
            lines.forEach((line) => {
                if (line.trim()) {
                    this.stderrHandlers.forEach((h) => h(line));
                }
            });
        });
        this.process.on('exit', (code) => {
            this.exitHandlers.forEach((h) => h(code));
            this.process = null;
            if (!this.stopping && this.restartCount < this.maxRestarts) {
                const delay = RESTART_DELAYS_MS[Math.min(this.restartCount, RESTART_DELAYS_MS.length - 1)];
                console.warn(`[PythonManager] Process exited (code ${code}). Restarting in ${delay}ms... (attempt ${this.restartCount + 1}/${this.maxRestarts})`);
                this.restartCount++;
                this.restartTimer = setTimeout(() => {
                    this.restartTimer = null;
                    if (!this.stopping)
                        void this._spawn();
                }, delay);
            }
            else if (!this.stopping) {
                console.error('[PythonManager] Max restarts reached. Agent is permanently down.');
            }
        });
        this.process.on('error', (err) => {
            console.error('[PythonManager] Spawn error:', err.message);
        });
    }
    async stop() {
        this.stopping = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        const agentProcess = this.process;
        if (!agentProcess)
            return;
        if (process.platform === 'win32' && agentProcess.pid) {
            await new Promise((resolve, reject) => {
                (0, child_process_1.execFile)('taskkill', ['/PID', String(agentProcess.pid), '/T', '/F'], { windowsHide: true }, (error) => {
                    if (error && agentProcess.exitCode === null && agentProcess.signalCode === null) {
                        reject(new Error(`Could not stop Python agent process tree: ${error.message}`));
                        return;
                    }
                    resolve();
                });
            });
            if (!(await this.waitForExit(agentProcess, 5000))) {
                throw new Error('Python agent process did not exit after process-tree shutdown');
            }
            return;
        }
        agentProcess.kill('SIGTERM');
        if (await this.waitForExit(agentProcess, 5000))
            return;
        agentProcess.kill('SIGKILL');
        if (!(await this.waitForExit(agentProcess, 5000))) {
            throw new Error('Python agent process did not exit after forced shutdown');
        }
    }
    waitForExit(child, timeoutMs) {
        if (child.exitCode !== null || child.signalCode !== null)
            return Promise.resolve(true);
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                child.removeListener('exit', onExit);
                resolve(false);
            }, timeoutMs);
            const onExit = () => {
                clearTimeout(timeout);
                resolve(true);
            };
            child.once('exit', onExit);
        });
    }
    async restart() {
        await this.stop();
        this.stopping = false;
        this.restartCount = 0;
        await this._spawn();
    }
    isRunning() {
        return this.process !== null && !this.process.killed;
    }
    onStdout(fn) {
        this.stdoutHandlers.push(fn);
    }
    onStderr(fn) {
        this.stderrHandlers.push(fn);
    }
    onExit(fn) {
        this.exitHandlers.push(fn);
    }
    _findPython() {
        const candidates = [
            // Check .venv inside agent dir first
            path_1.default.join(this.agentDir, '.venv', 'Scripts', 'python.exe'),
            path_1.default.join(this.agentDir, '.venv', 'bin', 'python'),
            // Check workspace-level .venv
            path_1.default.join(this.agentDir, '..', '..', '.venv', 'Scripts', 'python.exe'),
            // System Python
            'python',
            'python3',
            'py'
        ];
        for (const candidate of candidates) {
            if (!candidate.includes('python') && !candidate.includes('py'))
                continue;
            if (fs_1.default.existsSync(candidate)) {
                return candidate;
            }
        }
        // For system python commands, just return 'python' and let spawn handle it
        return 'python';
    }
}
exports.PythonManager = PythonManager;
//# sourceMappingURL=python-manager.js.map