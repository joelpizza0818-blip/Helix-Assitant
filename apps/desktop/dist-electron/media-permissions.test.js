"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const media_permissions_1 = require("./media-permissions");
(0, node_test_1.default)('only grants permission requests from the configured development origin', () => {
    strict_1.default.equal((0, media_permissions_1.isTrustedRendererRequest)('http://127.0.0.1:5173/', 'http://127.0.0.1:5173', 'http://127.0.0.1:5173'), true);
    strict_1.default.equal((0, media_permissions_1.isTrustedRendererRequest)('https://untrusted.example/', 'https://untrusted.example', 'http://127.0.0.1:5173'), false);
    strict_1.default.equal((0, media_permissions_1.isTrustedRendererRequest)('http://127.0.0.1:5173/', 'https://untrusted.example', 'http://127.0.0.1:5173'), false);
});
(0, node_test_1.default)('only trusts the packaged renderer file, not another file URL', () => {
    strict_1.default.equal((0, media_permissions_1.isTrustedRendererRequest)('file:///C:/Program%20Files/HELIX/dist/index.html', 'file://', 'file:///C:/Program%20Files/HELIX/dist/index.html'), true);
    strict_1.default.equal((0, media_permissions_1.isTrustedRendererRequest)('file:///C:/Program%20Files/HELIX/dist/index.html#floating', 'null', 'file:///C:/Program%20Files/HELIX/dist/index.html'), true);
    strict_1.default.equal((0, media_permissions_1.isTrustedRendererRequest)('file:///C:/Program%20Files/HELIX/dist/index.html#toolbox', undefined, 'file:///c:/Program%20Files/HELIX/dist/index.html'), true);
    strict_1.default.equal((0, media_permissions_1.isTrustedRendererRequest)('file:///C:/Users/Public/untrusted.html', 'file://', 'file:///C:/Program%20Files/HELIX/dist/index.html'), false);
    strict_1.default.equal((0, media_permissions_1.isTrustedRendererRequest)('file:///C:/Users/Public/untrusted.html', 'null', 'file:///C:/Program%20Files/HELIX/dist/index.html'), false);
});
(0, node_test_1.default)('only requests for audio and video media are eligible', () => {
    strict_1.default.equal((0, media_permissions_1.isSupportedMediaRequest)(['audio', 'video']), true);
    strict_1.default.equal((0, media_permissions_1.isSupportedMediaRequest)([]), false);
    strict_1.default.equal((0, media_permissions_1.isSupportedMediaRequest)(undefined), false);
    strict_1.default.equal((0, media_permissions_1.isSupportedMediaRequest)(['unknown']), false);
    strict_1.default.equal((0, media_permissions_1.isSupportedMediaType)('audio'), true);
    strict_1.default.equal((0, media_permissions_1.isSupportedMediaType)('unknown'), false);
});
//# sourceMappingURL=media-permissions.test.js.map