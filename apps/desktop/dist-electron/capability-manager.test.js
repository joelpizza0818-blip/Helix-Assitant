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
function makeManifest(publicKeyPem) {
    const unsigned = {
        arch: 'x64',
        capability: 'vision',
        coreVersionRange: '*',
        id: 'vision',
        platform: 'win32',
        sha256: 'a'.repeat(64),
        sizeBytes: 4,
        url: 'https://example.test/vision.pack',
        version: '1.0.0',
    };
    const privateKey = (0, node_crypto_1.generateKeyPairSync)('ed25519').privateKey;
    const signature = (0, node_crypto_1.sign)(null, Buffer.from(JSON.stringify(unsigned), 'utf8'), privateKey).toString('base64');
    void publicKeyPem;
    return { ...unsigned, signature };
}
(0, node_test_1.default)('rejects unsigned or unsafe capability manifests', () => {
    strict_1.default.throws(() => (0, capability_manager_1.validatePackManifest)({}), /invalid capability pack id/i);
    strict_1.default.throws(() => (0, capability_manager_1.validatePackManifest)({
        id: '../escape', version: '1', capability: 'vision', platform: 'win32', arch: 'x64',
        coreVersionRange: '*', sizeBytes: 1, url: 'http://example.test', sha256: 'a'.repeat(64), signature: 'x',
    }), /invalid capability pack id/i);
});
(0, node_test_1.default)('persists progressive profile and reports signed catalog entries as missing', async () => {
    const root = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'helix-capability-test-'));
    try {
        const keys = (0, node_crypto_1.generateKeyPairSync)('ed25519');
        const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const manager = new capability_manager_1.CapabilityManager(root, '0.1.9', { publicKeyPem });
        const manifest = makeManifest(publicKeyPem);
        // Re-sign with the private key matching the public key used by the manager.
        const unsigned = { ...manifest };
        delete unsigned.signature;
        const signature = (0, node_crypto_1.sign)(null, Buffer.from(JSON.stringify({
            arch: unsigned.arch, capability: unsigned.capability, coreVersionRange: unsigned.coreVersionRange,
            id: unsigned.id, platform: unsigned.platform, sha256: unsigned.sha256, sizeBytes: unsigned.sizeBytes,
            url: unsigned.url, version: unsigned.version,
        }), 'utf8'), keys.privateKey).toString('base64');
        const signed = { ...manifest, signature };
        strict_1.default.equal((0, capability_manager_1.verifyPackManifest)(signed, publicKeyPem), true);
        await manager.load();
        manager.registerManifest(signed);
        const snapshot = await manager.setProfile('progressive');
        strict_1.default.equal(snapshot.profile, 'progressive');
        strict_1.default.equal(snapshot.missingCount, 1);
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
        const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const manager = new capability_manager_1.CapabilityManager(root, '0.1.9', { publicKeyPem });
        const manifest = makeManifest(publicKeyPem);
        manifest.coreVersionRange = '^2.0.0';
        const unsigned = { ...manifest };
        delete unsigned.signature;
        manifest.signature = (0, node_crypto_1.sign)(null, Buffer.from(JSON.stringify({
            arch: unsigned.arch, capability: unsigned.capability, coreVersionRange: unsigned.coreVersionRange,
            id: unsigned.id, platform: unsigned.platform, sha256: unsigned.sha256, sizeBytes: unsigned.sizeBytes,
            url: unsigned.url, version: unsigned.version,
        }), 'utf8'), keys.privateKey).toString('base64');
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
        const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const manager = new capability_manager_1.CapabilityManager(root, '0.1.9', { publicKeyPem });
        await manager.load();
        await manager.setProfile('complete');
        strict_1.default.equal(manager.isPackInstalled('vision'), false);
        manager.registerManifest(makeManifest(publicKeyPem));
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
        await strict_1.default.rejects(releaseManager.installPack(makeManifest('')), /not enabled in this build/i);
    }
    finally {
        await (0, promises_1.rm)(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=capability-manager.test.js.map