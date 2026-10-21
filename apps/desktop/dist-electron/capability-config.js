"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readCapabilityConfig = readCapabilityConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DEFAULT_CATALOG_URL = 'https://github.com/joelpizza0818-blip/Helix-Assitant/releases/download/capability-packs/catalog.json';
function readCapabilityConfig(isPackaged, resourcesPath) {
    if (!isPackaged) {
        return {
            publicKey: process.env.HELIX_CAPABILITY_PUBLIC_KEY ?? '',
            catalogUrl: process.env.HELIX_CAPABILITY_CATALOG_URL ?? DEFAULT_CATALOG_URL,
        };
    }
    const configPath = path_1.default.join(resourcesPath, 'capability-config.json');
    const parsed = JSON.parse(fs_1.default.readFileSync(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object')
        throw new Error('Packaged capability configuration is invalid.');
    const candidate = parsed;
    if (typeof candidate.publicKey !== 'string'
        || (candidate.catalogUrl !== undefined && typeof candidate.catalogUrl !== 'string')) {
        throw new Error('Packaged capability configuration is invalid.');
    }
    return {
        publicKey: candidate.publicKey,
        catalogUrl: candidate.catalogUrl ?? DEFAULT_CATALOG_URL,
    };
}
//# sourceMappingURL=capability-config.js.map