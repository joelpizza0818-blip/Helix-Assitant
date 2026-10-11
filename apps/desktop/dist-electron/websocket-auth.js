"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebSocketToken = createWebSocketToken;
exports.websocketAuthHeaders = websocketAuthHeaders;
exports.websocketTokenEnvironment = websocketTokenEnvironment;
const crypto_1 = require("crypto");
function createWebSocketToken() {
    return (0, crypto_1.randomBytes)(32).toString('hex');
}
function websocketAuthHeaders(token) {
    return { Authorization: `Bearer ${token}` };
}
function websocketTokenEnvironment(token) {
    return { HELIX_WS_TOKEN: token };
}
//# sourceMappingURL=websocket-auth.js.map