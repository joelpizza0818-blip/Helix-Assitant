"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrayManager = void 0;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
class TrayManager {
    constructor() {
        this.tray = null;
        this.onLeftClickHandler = null;
    }
    create(iconPath) {
        let icon;
        if (fs_1.default.existsSync(iconPath)) {
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