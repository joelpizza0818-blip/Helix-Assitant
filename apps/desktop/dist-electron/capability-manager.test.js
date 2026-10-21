"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const capability_manager_1 = require("./capability-manager");
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}
function publicKeyBase64(publicKey) {
    return publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
}
function makeManifest(privateKey, overrides = {}) {
    const unsigned = {
        arch: 'x64',
        capability: 'vision',
        coreVersionRange: '*',
        format: 'python-plugin',
        id: 'vision',
        platform: 'win32',
        requiredForComplete: false,
        sha256: 'a'.repeat(64),
        sizeBytes: 4,
        url: 'https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/capability-packs/vision-1.0.0.py',
        version: '1.0.0',
        ...overrides,
    };
    const signature = (0, node_crypto_1.sign)(null, Buffer.from(canonicalJson(unsigned), 'utf8'), privateKey).toString('base64');
    return { ...unsigned, signature };
}
(0, node_test_1.default)('rejects unsigned or unsafe capability manifests', () => {
    strict_1.default.throws(() => (0, capability_manager_1.validatePackManifest)({}), /invalid capability pack id/i);
    strict_1.default.throws(() => (0, capability_manager_1.validatePackManifest)({
        id: '../escape', version: '1', capability: 'vision', platform: 'win32', arch: 'x64',
        format: 'python-plugin', requiredForComplete: false, coreVersionRange: '*', sizeBytes: 1,
        url: 'http://example.test', sha256: 'a'.repeat(64), signature: 'x',
    }), /invalid capability pack id/i);
});
(0, node_test_1.default)('rejects capability packs outside the trusted signed release', () => {
    const keys = (0, node_crypto_1.generateKeyPairSync)('ed25519');
    strict_1.default.throws(() => (0, capability_manager_1.validatePackManifest)(makeManifest(keys.privateKey, {
        url: 'https://downloads.example.test/vision.py',
    })), /trusted capability release/i);
});
(0, node_test_1.default)('drops cached manifests whose signatures no longer verify', async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'helix-capability-tampered-state-'));
    try {
        const keys = (0, node_crypto_1.generateKeyPairSync)('ed25519');
        const publicKey = publicKeyBase64(keys.publicKey);
        const manifest = makeManifest(keys.privateKey, { sha256: 'b'.repeat(64) });
        manifest.sha256 = 'c'.repeat(64);
        const stateDirectory = node_path_1.default.join(root, 'capabilities');
        await (0, promises_1.mkdir)(stateDirectory, { recursive: true });
        await (0, promises_1.writeFile)(node_path_1.default.join(stateDirectory, 'state.json'), JSON.stringify({
            profile: 'progressive',
            manifests: [manifest],
        }));
        const manager = new capability_manager_1.CapabilityManager(root, '0.1.9', { publicKey });
        await manager.load();
        strict_1.default.equal(manager.getProfile(), 'progressive');
        strict_1.default.equal(manager.getManifest('vision'), null);
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('persists progressive profile and reports signed catalog entries as missing', async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'helix-capability-test-'));
    try {
        const keys = (0, node_crypto_1.generateKeyPairSync)('ed25519');
        const publicKey = publicKeyBase64(keys.publicKey);
        const manager = new capability_manager_1.CapabilityManager(root, '0.1.9', { publicKey });
        const signed = makeManifest(keys.privateKey);
        strict_1.default.equal((0, capability_manager_1.verifyPackManifest)(signed, publicKey), true);
        await manager.load();
        manager.registerManifest(signed);
        const snapshot = await manager.setProfile('progressive');
        strict_1.default.equal(snapshot.profile, 'progressive');
        strict_1.default.equal(snapshot.missingCount, 1);
        strict_1.default.equal(snapshot.requiredMissingCount, 0);
        strict_1.default.equal(snapshot.packs[0].status, 'missing');
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('marks packs outside the signed core version range as incompatible', async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'helix-capability-range-'));
    try {
        const keys = (0, node_crypto_1.generateKeyPairSync)('ed25519');
        const publicKey = publicKeyBase64(keys.publicKey);
        const manager = new capability_manager_1.CapabilityManager(root, '0.1.9', { publicKey });
        const manifest = makeManifest(keys.privateKey, { coreVersionRange: '^2.0.0' });
        manager.registerManifest(manifest);
        strict_1.default.equal((await manager.setProfile('progressive')).packs[0].status, 'incompatible');
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('does not treat a complete profile as proof that a capability pack is installed', async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'helix-capability-complete-'));
    try {
        const keys = (0, node_crypto_1.generateKeyPairSync)('ed25519');
        const publicKey = publicKeyBase64(keys.publicKey);
        const manager = new capability_manager_1.CapabilityManager(root, '0.1.9', { publicKey });
        await manager.load();
        await manager.setProfile('complete');
        strict_1.default.equal(manager.isPackInstalled('vision'), false);
        manager.registerManifest(makeManifest(keys.privateKey));
        strict_1.default.equal(manager.isPackInstalled('vision'), false);
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('complete release builds reject progressive selection and normalize saved profiles', async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'helix-capability-release-'));
    try {
        const developmentManager = new capability_manager_1.CapabilityManager(root, '0.1.9');
        await developmentManager.load();
        await developmentManager.setProfile('progressive');
        const releaseManager = new capability_manager_1.CapabilityManager(root, '0.1.9', { progressiveEnabled: false });
        await releaseManager.load();
        strict_1.default.equal(releaseManager.getProfile(), 'complete');
        await strict_1.default.rejects(releaseManager.setProfile('progressive'), /not enabled in this build/i);
        await strict_1.default.rejects(releaseManager.installPack(makeManifest((0, node_crypto_1.generateKeyPairSync)('ed25519').privateKey)), /not enabled in this build/i);
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('coalesces simultaneous installs and reuses the verified installed pack', async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'helix-capability-coalesced-'));
    const originalFetch = globalThis.fetch;
    try {
        const keys = (0, node_crypto_1.generateKeyPairSync)('ed25519');
        const publicKey = publicKeyBase64(keys.publicKey);
        const bytes = Buffer.from('signed plugin fixture');
        const manifest = makeManifest(keys.privateKey, {
            sizeBytes: bytes.length,
            sha256: (0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex'),
        });
        const manager = new capability_manager_1.CapabilityManager(root, '0.1.9', { publicKey });
        await manager.load();
        await manager.setProfile('progressive');
        let downloadCount = 0;
        globalThis.fetch = async (_input, init) => {
            downloadCount += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            strict_1.default.equal(init?.signal?.aborted, false);
            return new Response(bytes);
        };
        const [first, second] = await Promise.all([
            manager.installPack(manifest),
            manager.installPack(manifest),
        ]);
        strict_1.default.equal(downloadCount, 1);
        strict_1.default.equal(first.status, 'installed');
        strict_1.default.equal(second.status, 'installed');
        strict_1.default.equal(first.installedPath, second.installedPath);
        strict_1.default.deepEqual(await (0, promises_1.readFile)(first.installedPath), bytes);
        globalThis.fetch = async () => {
            throw new Error('An already verified pack should not be downloaded again.');
        };
        const reused = await manager.installPack(manifest);
        strict_1.default.equal(reused.status, 'installed');
        strict_1.default.equal(downloadCount, 1);
    }
    finally {
        globalThis.fetch = originalFetch;
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)('cancels an in-flight install and removes its staged file', async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'helix-capability-cancel-'));
    const originalFetch = globalThis.fetch;
    try {
        const keys = (0, node_crypto_1.generateKeyPairSync)('ed25519');
        const publicKey = publicKeyBase64(keys.publicKey);
        const bytes = Buffer.from('signed plugin fixture');
        const manifest = makeManifest(keys.privateKey, {
            sizeBytes: bytes.length,
            sha256: (0, node_crypto_1.createHash)('sha256').update(bytes).digest('hex'),
        });
        const manager = new capability_manager_1.CapabilityManager(root, '0.1.9', { publicKey });
        await manager.load();
        await manager.setProfile('progressive');
        let signal;
        globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
            signal = init?.signal;
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
        const install = manager.installPack(manifest);
        while (!signal)
            await new Promise((resolve) => setTimeout(resolve, 1));
        strict_1.default.equal(manager.cancelPack(manifest.id), true);
        await strict_1.default.rejects(install, /installation was canceled/i);
        strict_1.default.equal(manager.cancelPack(manifest.id), false);
        await strict_1.default.rejects((0, promises_1.readFile)(node_path_1.default.join(root, 'capabilities', 'staging', `${manifest.id}-${manifest.version}.download`)));
        strict_1.default.equal(manager.isPackInstalled(manifest.id), false);
    }
    finally {
        globalThis.fetch = originalFetch;
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=capability-manager.test.js.map