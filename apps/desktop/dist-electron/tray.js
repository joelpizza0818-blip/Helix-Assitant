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
exports.TrayManager = void 0;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
class TrayManager {
    constructor() {
        this.tray = null;
        this.onLeftClickHandler = null;
    }
    create(iconPath) {
        let icon;
        if (fs.existsSync(iconPath)) {
            icon = electron_1.nativeImage.createFromPath(iconPath);
            icon = icon.resize({ width: 16, height: 16 });
        }
        else {
            // Minimal 1x1 transparent fallback icon
            icon = electron_1.nativeImage.createEmpty();
        }
        this.tray = new electron_1.Tray(icon);
        this.tray.setToolTip('HELIX — AI Computer Agent');
        this.tray.on('click', () => {
            this.onLeftClickHandler?.();
        });
    }
    destroy() {
        this.tray?.destroy();
        this.tray = null;
    }
    updateStatus(status) {
        const tooltips = {
            idle: 'HELIX — Ready',
            busy: 'HELIX — Working...',
            error: 'HELIX — Error (click to open)',
            listening: 'HELIX — Listening...',
            executing: 'HELIX — Executing task...'
        };
        this.tray?.setToolTip(tooltips[status] ?? 'HELIX');
    }
    setOnLeftClick(fn) {
        this.onLeftClickHandler = fn;
    }
    setContextMenu(menu) {
        this.tray?.setContextMenu(menu);
    }
    setTooltip(text) {
        this.tray?.setToolTip(text);
    }
}
exports.TrayManager = TrayManager;
//# sourceMappingURL=tray.js.map