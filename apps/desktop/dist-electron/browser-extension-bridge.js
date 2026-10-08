"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserExtensionBridge = exports.BROWSER_EXTENSION_PORT = void 0;
const http_1 = require("http");
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
exports.BROWSER_EXTENSION_PORT = 47831;
const MAX_BODY_BYTES = 500000;
const MAX_PAGE_TEXT_LENGTH = 80000;
function isExtensionOrigin(origin) {
    return Boolean(origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin));
}
function sendJson(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
}
function validPageSnapshot(value) {
    if (!value || typeof value !== 'object')
        return false;
    const page = value;
    if (typeof page.title !== 'string'
        || typeof page.url !== 'string'
        || typeof page.text !== 'string'
        || typeof page.captured_at !== 'string'
        || page.title.length > 500
        || page.url.length > 4096
        || page.text.length > MAX_PAGE_TEXT_LENGTH
        || !Array.isArray(page.links)
        || !Array.isArray(page.forms)
        || page.links.length > 120
        || page.forms.length > 80)
        return false;
    try {
        const url = new URL(page.url);
        if (!['http:', 'https:'].includes(url.protocol))
            return false;
    }
    catch {
        return false;
    }
    const validLink = (link) => {
        if (!link || typeof link !== 'object')
            return false;
        const item = link;
        if (typeof item.text !== 'string'
            || typeof item.url !== 'string'
            || item.text.length > 300
            || item.url.length > 4096)
            return false;
        try {
            const linkUrl = new URL(item.url);
            return ['http:', 'https:'].includes(linkUrl.protocol);
        }
        catch {
            return false;
        }
    };
    const validForm = (form) => {
        if (!form || typeof form !== 'object')
            return false;
        const item = form;
        return typeof item.label === 'string'
            && item.label.length <= 300
            && typeof item.type === 'string'
            && item.type.length <= 40;
    };
    return page.links.every(validLink) && page.forms.every(validForm);
}
class BrowserExtensionBridge {
    constructor(tokenPath, extensionPath, onPageSnapshot) {
        this.tokenPath = tokenPath;
        this.extensionPath = extensionPath;
        this.onPageSnapshot = onPageSnapshot;
        this.server = null;
        this.token = '';
        this.startupError = null;
        this.lastPage = null;
    }
    async start() {
        try {
            await fs_1.default.promises.mkdir(path_1.default.dirname(this.tokenPath), { recursive: true });
            try {
                this.token = (await fs_1.default.promises.readFile(this.tokenPath, 'utf8')).trim();
            }
            catch (error) {
                if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
                    throw error;
                }
            }
            if (!/^[a-f0-9]{64}$/.test(this.token)) {
                this.token = (0, crypto_1.randomBytes)(32).toString('hex');
                await fs_1.default.promises.writeFile(this.tokenPath, this.token, { mode: 0o600 });
            }
        }
        catch (error) {
            this.startupError = error instanceof Error ? error.message : String(error);
            throw new Error(`Could not initialize browser extension pairing: ${this.startupError}`);
        }
        await new Promise((resolve) => {
            const server = (0, http_1.createServer)((request, response) => {
                void this.handleRequest(request, response);
            });
            this.server = server;
            server.on('error', (error) => {
                this.startupError = error.message;
                console.error('[BrowserExtensionBridge] Local browser bridge failed to start:', error);
                resolve();
            });
            server.listen(exports.BROWSER_EXTENSION_PORT, '127.0.0.1', () => {
                this.startupError = null;
                console.log(`[BrowserExtensionBridge] Listening on 127.0.0.1:${exports.BROWSER_EXTENSION_PORT}`);
                resolve();
            });
        });
    }
    getInfo() {
        return {
            token: this.token,
            port: exports.BROWSER_EXTENSION_PORT,
            extensionPath: this.extensionPath,
            listening: Boolean(this.server?.listening),
            lastPage: this.lastPage,
            error: this.startupError,
        };
    }
    async close() {
        if (!this.server?.listening)
            return;
        const server = this.server;
        this.server = null;
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
    async handleRequest(request, response) {
        const origin = request.headers.origin;
        if (!isExtensionOrigin(origin)) {
            sendJson(response, 403, { error: 'Only a Chrome or Edge extension can use this endpoint.' });
            return;
        }
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        if (request.method === 'OPTIONS') {
            response.writeHead(204);
            response.end();
            return;
        }
        if (request.method !== 'POST' || request.url !== '/page') {
            sendJson(response, 404, { error: 'Not found.' });
            return;
        }
        const authorization = request.headers.authorization;
        const suppliedToken = typeof authorization === 'string'
            ? authorization.replace(/^Bearer\s+/i, '')
            : '';
        const expected = Buffer.from(this.token);
        const supplied = Buffer.from(suppliedToken);
        if (expected.length !== supplied.length || !(0, crypto_1.timingSafeEqual)(expected, supplied)) {
            sendJson(response, 401, { error: 'Invalid extension pairing token.' });
            return;
        }
        try {
            const chunks = [];
            let receivedBytes = 0;
            let tooLarge = false;
            for await (const chunk of request) {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                receivedBytes += buffer.length;
                if (receivedBytes > MAX_BODY_BYTES) {
                    tooLarge = true;
                    chunks.length = 0;
                    continue;
                }
                if (!tooLarge)
                    chunks.push(buffer);
            }
            if (tooLarge) {
                sendJson(response, 413, { error: 'Page snapshot exceeds the size limit.' });
                return;
            }
            const snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!validPageSnapshot(snapshot)) {
                sendJson(response, 400, { error: 'Invalid browser page snapshot.' });
                return;
            }
            if (!this.onPageSnapshot(snapshot)) {
                sendJson(response, 503, { error: 'HELIX agent is not connected yet.' });
                return;
            }
            this.lastPage = {
                title: snapshot.title,
                url: snapshot.url,
                captured_at: snapshot.captured_at,
            };
            sendJson(response, 200, { accepted: true });
        }
        catch (error) {
            if (response.headersSent || response.destroyed)
                return;
            const message = error instanceof Error ? error.message : String(error);
            sendJson(response, 400, { error: `Could not process browser page snapshot: ${message}` });
        }
    }
}
exports.BrowserExtensionBridge = BrowserExtensionBridge;
//# sourceMappingURL=browser-extension-bridge.js.map