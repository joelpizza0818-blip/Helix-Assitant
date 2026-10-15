import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Discover .env from current directory, parent dirs, or monorepo root
export function loadHelixEnv(): void {
  const searchDirs = [
    process.cwd(),
    path.resolve(process.cwd(), '../..'),
    path.resolve(__dirname, '../../..'),
    path.resolve(__dirname, '../../../..'),
  ];

  for (const dir of searchDirs) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      break;
    }
  }
}

// Automatically load on import
loadHelixEnv();

export function getWsPort(): number {
  if (process.env.AGENT_WS_PORT && !isNaN(Number(process.env.AGENT_WS_PORT))) {
    return Number(process.env.AGENT_WS_PORT);
  }
  return 8765;
}

export function getWsUrl(override?: string): string {
  if (override) return override;
  if (process.env.AGENT_WS_URL) return process.env.AGENT_WS_URL;
  return `ws://127.0.0.1:${getWsPort()}`;
}

export function getWsToken(override?: string): string | undefined {
  if (override) return override;
  return process.env.HELIX_WS_TOKEN;
}

export function getSettingsFilePath(): string {
  const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library/Application Support') : path.join(process.env.HOME || '', '.config'));
  return path.join(appData, 'HELIX', 'settings.json');
}
