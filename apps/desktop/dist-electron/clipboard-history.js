"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClipboardHistory = void 0;
const crypto_1 = require("crypto");
const electron_1 = require("electron");
const MAX_HISTORY_ITEMS = 30;
const MAX_TEXT_LENGTH = 25000;
const MAX_IMAGE_BYTES = 500000;
const MAX_IMAGE_DIMENSION = 512;
const POLL_INTERVAL_MS = 750;
class ClipboardHistory {
    constructor(onChange, onMonitoringChange) {
        this.onChange = onChange;
        this.onMonitoringChange = onMonitoringChange;
        this.items = [];
        this.monitoring = true;
        this.lastSignature = '';
        this.timer = null;
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => this.capture(), POLL_INTERVAL_MS);
        this.timer.unref();
        this.capture();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    getHistory() {
        return this.items.map((item) => ({ ...item }));
    }
    isMonitoring() {
        return this.monitoring;
    }
    setMonitoring(enabled) {
        if (this.monitoring === enabled)
            return;
        this.monitoring = enabled;
        this.onMonitoringChange(enabled);
        if (enabled)
            this.capture();
    }
    clear() {
        this.items = [];
        this.onChange([]);
    }
    restore(id) {
        const item = this.items.find((candidate) => candidate.id === id);
        if (!item)
            throw new Error('Clipboard history item no longer exists.');
        if (item.kind === 'text' && typeof item.text === 'string') {
            electron_1.clipboard.writeText(item.text);
            this.lastSignature = this.signature('text', item.text);
            return;
        }
        if (item.kind === 'image' && typeof item.dataUrl === 'string') {
            electron_1.clipboard.writeImage(electron_1.nativeImage.createFromDataURL(item.dataUrl));
            this.lastSignature = this.signature('image', item.dataUrl);
            return;
        }
        throw new Error('Clipboard history item has invalid content.');
    }
    capture() {
        if (!this.monitoring)
            return;
        try {
            const image = electron_1.clipboard.readImage();
            if (!image.isEmpty()) {
                this.captureImage(image);
                return;
            }
            const text = electron_1.clipboard.readText();
            if (!text) {
                this.lastSignature = '';
                return;
            }
            const boundedText = text.slice(0, MAX_TEXT_LENGTH);
            this.addItem({
                id: (0, crypto_1.randomUUID)(),
                kind: 'text',
                timestamp: new Date().toISOString(),
                text: boundedText,
            }, this.signature('text', boundedText));
        }
        catch (error) {
            console.error('[ClipboardHistory] Could not read the system clipboard:', error);
        }
    }
    captureImage(image) {
        const { width, height } = image.getSize();
        if (width <= 0 || height <= 0)
            return;
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
        const resized = image.resize({
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
            quality: 'good',
        });
        let bytes = resized.toJPEG(70);
        if (bytes.length > MAX_IMAGE_BYTES) {
            bytes = resized.resize({ width: 320, height: 320, quality: 'good' }).toJPEG(50);
        }
        if (bytes.length > MAX_IMAGE_BYTES) {
            console.warn('[ClipboardHistory] Skipping a clipboard image that exceeds the memory limit.');
            return;
        }
        const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
        const signature = this.signature('image', bytes);
        this.addItem({
            id: (0, crypto_1.randomUUID)(),
            kind: 'image',
            timestamp: new Date().toISOString(),
            dataUrl,
        }, signature);
    }
    addItem(item, signature) {
        if (signature === this.lastSignature)
            return;
        this.lastSignature = signature;
        this.items = [item, ...this.items].slice(0, MAX_HISTORY_ITEMS);
        this.onChange(this.getHistory());
    }
    signature(kind, content) {
        const hash = (0, crypto_1.createHash)('sha256').update(content).digest('hex');
        return `${kind}:${hash}`;
    }
}
exports.ClipboardHistory = ClipboardHistory;
//# sourceMappingURL=clipboard-history.js.map