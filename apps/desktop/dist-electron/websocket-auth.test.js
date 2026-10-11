"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const websocket_auth_1 = require("./websocket-auth");
(0, node_test_1.test)('creates a cryptographically random token for the agent process', () => {
    const token = (0, websocket_auth_1.createWebSocketToken)();
    strict_1.default.match(token, /^[a-f0-9]{64}$/);
    strict_1.default.notEqual((0, websocket_auth_1.createWebSocketToken)(), token);
});
(0, node_test_1.test)('sends the token in the WebSocket authorization handshake header', () => {
    strict_1.default.deepEqual((0, websocket_auth_1.websocketAuthHeaders)('agent-token'), {
        Authorization: 'Bearer agent-token',
    });
});
(0, node_test_1.test)('passes the token to the agent only through its process environment', () => {
    strict_1.default.deepEqual((0, websocket_auth_1.websocketTokenEnvironment)('agent-token'), {
        HELIX_WS_TOKEN: 'agent-token',
    });
});
//# sourceMappingURL=websocket-auth.test.js.map