"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PythonManager = void 0;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const RESTART_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
class PythonManager {
    constructor() {
        this.process = null;
        this.agentDir = '';
        this.wsPort = 8765;
        this.restartCount = 0;
        this.maxRestarts = 5;
        this.stopping = false;
        this.stdoutHandlers = [];
        this.stderrHandlers = [];
        this.exitHandlers = [];
    }
    async start(agentDir, wsPort) {
        this.agentDir = agentDir;
        this.wsPort = wsPort;
        this.stopping = false;
        this.restartCount = 0;
        return this._spawn();
    }
    async _spawn() {
        const pythonExe = this._findPython();
        if (!pythonExe) {
            throw new Error('Python executable not found. Install Python 3.11+ and ensure it is in PATH.');
        }
        const mainScript = path.join(this.agentDir, 'main.py');
        if (!fs.existsSync(mainScript)) {
            throw new Error(`Python agent main.py not found at: ${mainScript}`);
        }
        console.log(`[PythonManager] Spawning: ${pythonExe} main.py --ws-port ${this.wsPort}`);
        console.log(`[PythonManager] Working dir: ${this.agentDir}`);
        this.process = (0, child_process_1.spawn)(pythonExe, ['main.py', '--ws-port', String(this.wsPort)], {
            cwd: this.agentDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
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
        if (!this.process)
            return;
        return new Promise((resolve) => {
            if (!this.process) {
                resolve();
                return;
            }
            const timeout = setTimeout(() => {
                this.process?.kill('SIGKILL');
                resolve();
            }, 5000);
            this.process.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
            this.process.kill('SIGTERM');
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
            path.join(this.agentDir, '.venv', 'Scripts', 'python.exe'),
            path.join(this.agentDir, '.venv', 'bin', 'python'),
            // Check workspace-level .venv
            path.join(this.agentDir, '..', '..', '.venv', 'Scripts', 'python.exe'),
            // System Python
            'python',
            'python3',
            'py'
        ];
        for (const candidate of candidates) {
            if (!candidate.includes('python') && !candidate.includes('py'))
                continue;
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        // For system python commands, just return 'python' and let spawn handle it
        return 'python';
    }
}
exports.PythonManager = PythonManager;
//# sourceMappingURL=python-manager.js.map