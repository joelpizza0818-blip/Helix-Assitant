"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapabilityManager = void 0;
exports.validatePackManifest = validatePackManifest;
exports.verifyPackManifest = verifyPackManifest;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const stream_1 = require("stream");
const promises_1 = require("stream/promises");
const MAX_PACK_BYTES = 2 * 1024 * 1024 * 1024;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
function parseSemver(value) {
    const match = value.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function compareSemver(left, right) {
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index])
            return left[index] - right[index];
    }
    return 0;
}
function satisfiesCoreVersion(version, range) {
    if (range.trim() === '*' || range.trim() === '')
        return true;
    const current = parseSemver(version);
    if (!current)
        return false;
    return range.trim().split(/\s+/).every((constraint) => {
        const match = constraint.match(/^(\^|~|>=|<=|>|<|=)?(.+)$/);
        if (!match)
            return false;
        const operator = match[1] || '=';
        const target = parseSemver(match[2]);
        if (!target)
            return false;
        const comparison = compareSemver(current, target);
        if (operator === '^') {
            const sameCompatibleLine = target[0] > 0
                ? current[0] === target[0]
                : target[1] > 0
                    ? current[0] === 0 && current[1] === target[1]
                    : current[0] === 0 && current[1] === 0 && current[2] === target[2];
            return comparison >= 0 && sameCompatibleLine;
        }
        if (operator === '~')
            return comparison >= 0 && current[0] === target[0] && current[1] === target[1];
        if (operator === '>=')
            return comparison >= 0;
        if (operator === '<=')
            return comparison <= 0;
        if (operator === '>')
            return comparison > 0;
        if (operator === '<')
            return comparison < 0;
        return comparison === 0;
    });
}
function canonicalManifest(manifest) {
    const { signature: _signature, ...unsigned } = manifest;
    return JSON.stringify(unsigned, Object.keys(unsigned).sort());
}
function safePackId(id) {
    return ID_PATTERN.test(id) && id !== '.' && id !== '..';
}
function validatePackManifest(manifest) {
    if (!manifest || typeof manifest.id !== 'string' || !safePackId(manifest.id))
        throw new Error('Invalid capability pack id.');
    if (typeof manifest.version !== 'string' || typeof manifest.capability !== 'string' || !manifest.version || !manifest.capability) {
        throw new Error('Capability pack metadata is incomplete.');
    }
    if (manifest.platform !== 'win32' || !['x64', 'arm64'].includes(manifest.arch)) {
        throw new Error('Capability pack platform or architecture is not supported.');
    }
    if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes <= 0 || manifest.sizeBytes > MAX_PACK_BYTES) {
        throw new Error('Capability pack size is outside the allowed limit.');
    }
    if (!/^https:\/\//i.test(manifest.url))
        throw new Error('Capability pack URL must use HTTPS.');
    if (!SHA256_PATTERN.test(manifest.sha256))
        throw new Error('Capability pack hash is invalid.');
    if (!manifest.signature)
        throw new Error('Capability pack signature is missing.');
}
function verifyPackManifest(manifest, publicKeyPem) {
    validatePackManifest(manifest);
    if (!publicKeyPem.trim())
        throw new Error('Capability pack public key is not configured.');
    try {
        return (0, crypto_1.verify)(null, Buffer.from(canonicalManifest(manifest), 'utf8'), (0, crypto_1.createPublicKey)(publicKeyPem), Buffer.from(manifest.signature, 'base64'));
    }
    catch (error) {
        throw new Error(`Capability pack signature could not be verified: ${error instanceof Error ? error.message : String(error)}`);
    }
}
class CapabilityManager {
    constructor(userDataPath, coreVersion, options = {}) {
        this.state = { profile: 'complete', manifests: [] };
        this.activeDownloads = new Map();
        this.statePath = path_1.default.join(userDataPath, 'capabilities', 'state.json');
        this.packsRoot = path_1.default.join(userDataPath, 'capabilities', 'packs');
        this.publicKeyPem = options.publicKeyPem ?? process.env.HELIX_CAPABILITY_PUBLIC_KEY ?? '';
        this.manifestUrl = options.manifestUrl ?? process.env.HELIX_CAPABILITY_MANIFEST_URL ?? '';
        this.coreVersion = coreVersion;
        this.progressiveEnabled = options.progressiveEnabled ?? true;
    }
    async load() {
        try {
            const parsed = JSON.parse(await fs_1.promises.readFile(this.statePath, 'utf8'));
            this.state = {
                profile: this.progressiveEnabled && parsed.profile === 'progressive' ? 'progressive' : 'complete',
                manifests: Array.isArray(parsed.manifests) ? parsed.manifests : [],
            };
        }
        catch {
            this.state = { profile: 'complete', manifests: [] };
        }
    }
    async setProfile(profile) {
        if (profile === 'progressive' && !this.progressiveEnabled) {
            throw new Error('Progressive installation is not enabled in this build.');
        }
        this.state.profile = profile;
        await this.persist();
        return this.snapshot();
    }
    getProfile() { return this.state.profile; }
    getManifest(id) {
        return this.state.manifests.find((manifest) => manifest.id === id) ?? null;
    }
    isPackInstalled(id) {
        return this.snapshot().packs.some((pack) => pack.id === id && pack.status === 'installed');
    }
    registerManifest(manifest) {
        validatePackManifest(manifest);
        const current = this.state.manifests.filter((item) => item.id !== manifest.id);
        this.state.manifests = [...current, manifest];
    }
    async saveManifestCatalog(manifests) {
        manifests.forEach((manifest) => {
            if (!verifyPackManifest(manifest, this.publicKeyPem))
                throw new Error(`Invalid signature for pack ${manifest.id}.`);
        });
        this.state.manifests = manifests;
        await this.persist();
        return this.snapshot();
    }
    async refreshCatalog() {
        if (!this.manifestUrl)
            return this.snapshot();
        if (!/^https:\/\//i.test(this.manifestUrl))
            throw new Error('Capability catalog URL must use HTTPS.');
        const response = await fetch(this.manifestUrl, { signal: AbortSignal.timeout(10000) });
        if (!response.ok)
            throw new Error(`Capability catalog failed with HTTP ${response.status}.`);
        const payload = await response.json();
        if (!Array.isArray(payload.packs))
            throw new Error('Capability catalog has an invalid shape.');
        return this.saveManifestCatalog(payload.packs);
    }
    snapshot() {
        const packs = this.state.manifests.map((manifest) => {
            const installedPath = this.packPath(manifest);
            const status = this.isCompatible(manifest)
                ? this.fileExists(installedPath) ? 'installed' : 'missing'
                : 'incompatible';
            return { ...manifest, status, ...(status === 'installed' ? { installedPath } : {}) };
        });
        const missingCount = packs.filter((pack) => pack.status !== 'installed').length;
        return { profile: this.state.profile, packs, missingCount, ready: missingCount === 0 };
    }
    async installPack(manifest) {
        if (!this.progressiveEnabled)
            throw new Error('Capability pack installation is not enabled in this build.');
        if (!verifyPackManifest(manifest, this.publicKeyPem))
            throw new Error(`Invalid signature for pack ${manifest.id}.`);
        if (!this.isCompatible(manifest))
            throw new Error(`Pack ${manifest.id} is incompatible with this HELIX build.`);
        if (this.activeDownloads.has(manifest.id))
            throw new Error(`Pack ${manifest.id} is already downloading.`);
        const controller = new AbortController();
        this.activeDownloads.set(manifest.id, controller);
        const stagingRoot = path_1.default.join(path_1.default.dirname(this.packsRoot), 'staging');
        const temporaryPath = path_1.default.join(stagingRoot, `${manifest.id}-${manifest.version}.download`);
        try {
            await fs_1.promises.mkdir(stagingRoot, { recursive: true });
            await fs_1.promises.rm(temporaryPath, { force: true });
            const response = await fetch(manifest.url, { signal: controller.signal });
            if (!response.ok || !response.body)
                throw new Error(`Pack download failed with HTTP ${response.status}.`);
            const contentLength = Number(response.headers.get('content-length') || 0);
            if (contentLength > MAX_PACK_BYTES || (contentLength > 0 && contentLength !== manifest.sizeBytes)) {
                throw new Error('Pack download size does not match its signed manifest.');
            }
            let received = 0;
            const hasher = (0, crypto_1.createHash)('sha256');
            const source = stream_1.Readable.fromWeb(response.body);
            source.on('data', (chunk) => {
                received += chunk.length;
                hasher.update(chunk);
                if (received > manifest.sizeBytes || received > MAX_PACK_BYTES)
                    controller.abort();
            });
            await (0, promises_1.pipeline)(source, (0, fs_1.createWriteStream)(temporaryPath, { flags: 'wx' }));
            if (received !== manifest.sizeBytes || hasher.digest('hex').toLowerCase() !== manifest.sha256.toLowerCase()) {
                throw new Error('Pack hash or size verification failed.');
            }
            const destination = this.packPath(manifest);
            await fs_1.promises.mkdir(path_1.default.dirname(destination), { recursive: true });
            await fs_1.promises.rm(destination, { force: true });
            await fs_1.promises.rename(temporaryPath, destination);
            this.registerManifest(manifest);
            await this.persist();
            return { ...manifest, status: 'installed', installedPath: destination };
        }
        finally {
            this.activeDownloads.delete(manifest.id);
            await fs_1.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
        }
    }
    cancelPack(id) {
        const controller = this.activeDownloads.get(id);
        if (!controller)
            return false;
        controller.abort();
        return true;
    }
    async persist() {
        await fs_1.promises.mkdir(path_1.default.dirname(this.statePath), { recursive: true });
        const temporaryPath = `${this.statePath}.tmp`;
        await fs_1.promises.writeFile(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8');
        await fs_1.promises.rm(this.statePath, { force: true });
        await fs_1.promises.rename(temporaryPath, this.statePath);
    }
    packPath(manifest) {
        if (!safePackId(manifest.id))
            throw new Error('Unsafe capability pack path.');
        return path_1.default.join(this.packsRoot, manifest.id, `${manifest.version}.pack`);
    }
    isCompatible(manifest) {
        return manifest.platform === process.platform
            && manifest.arch === process.arch
            && satisfiesCoreVersion(this.coreVersion, manifest.coreVersionRange);
    }
    fileExists(filePath) {
        try {
            return (0, fs_1.statSync)(filePath).isFile();
        }
        catch {
            return false;
        }
    }
}
exports.CapabilityManager = CapabilityManager;
//# sourceMappingURL=capability-manager.js.map