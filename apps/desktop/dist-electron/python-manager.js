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
const RESTART_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
class PythonManager {
    constructor() {
        this.process = null;
        this.agentDir = '';
        this.wsPort = 8765;
        this.settingsPath = '';
        this.restartCount = 0;
        this.maxRestarts = 5;
        this.stopping = false;
        this.stdoutHandlers = [];
        this.stderrHandlers = [];
        this.exitHandlers = [];
    }
    async start(agentDir, wsPort, settingsPath) {
        this.agentDir = agentDir;
        this.wsPort = await this.findAvailablePort(wsPort);
        this.settingsPath = settingsPath;
        if (this.wsPort !== wsPort) {
            console.warn(`[PythonManager] Port ${wsPort} is already in use; using ${this.wsPort} instead`);
        }
        this.stopping = false;
        this.restartCount = 0;
        await this._spawn();
        return this.wsPort;
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
        const pythonExe = this._findPython();
        if (!pythonExe) {
            throw new Error('Python executable not found. Install Python 3.11+ and ensure it is in PATH.');
        }
        const mainScript = path_1.default.join(this.agentDir, 'main.py');
        if (!fs_1.default.existsSync(mainScript)) {
            throw new Error(`Python agent main.py not found at: ${mainScript}`);
        }
        console.log(`[PythonManager] Spawning: ${pythonExe} main.py --ws-port ${this.wsPort}`);
        console.log(`[PythonManager] Working dir: ${this.agentDir}`);
        this.process = (0, child_process_1.spawn)(pythonExe, ['main.py', '--ws-port', String(this.wsPort)], {
            cwd: this.agentDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            env: {
                ...process.env,
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
                setTimeout(() => this._spawn(), delay);
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