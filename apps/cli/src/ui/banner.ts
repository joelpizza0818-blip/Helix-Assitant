import chalk from 'chalk';
import { ORANGE, CYAN, GREEN, RED, YELLOW, GRAY, BOLD, DIM } from './colors';

export interface BannerStatusOptions {
  connected: boolean;
  wsUrl: string;
  voiceEnabled: boolean;
  isCapturingVoice?: boolean;
  currentModel?: string | null;
  activeTasksCount?: number;
}

// Exact bash logo with ANSI RGB codes - DO NOT MODIFY
export function getAsciiLogo(terminalWidth: number = 80): string {
  const lines = [
    '   \x1b[48;2;255;227;143m\x1b[38;2;255;255;255m▀\x1b[49m\x1b[38;2;255;227;143m█   \x1b[48;2;255;227;143m\x1b[38;2;255;255;255m▀\x1b[49m\x1b[38;2;255;227;143m█\x1b[0m',
    '   \x1b[38;2;255;210;77m██   ██       \x1b[38;2;255;255;255m██████  ██      ██  ██    ██\x1b[0m',
    '\x1b[38;2;255;215;119m██ \x1b[38;2;255;191;31m██   ██ \x1b[38;2;255;215;119m██    \x1b[38;2;246;246;246m██      ██      ██   ██  ██\x1b[0m',
    '\x1b[38;2;255;191;36m██ \x1b[38;2;255;171;10m███\x1b[48;2;255;171;10m\x1b[38;2;255;255;255m▀\x1b[49m\x1b[38;2;255;171;10m███ \x1b[38;2;255;191;36m██    \x1b[38;2;236;236;236m████    ██      ██     ██\x1b[0m',
    '\x1b[38;2;255;160;18m██ \x1b[38;2;255;145;20m███████ \x1b[38;2;255;160;18m██    \x1b[38;2;226;226;226m██      ██      ██   ██  ██\x1b[0m',
    '\x1b[38;2;255;127;26m██ \x1b[38;2;255;122;26m██   ██ \x1b[38;2;255;127;26m██    \x1b[38;2;216;216;216m██████  ██████  ██  ██    ██\x1b[0m',
    '\x1b[38;2;240;98;15m██ \x1b[38;2;255;95;18m██   ██ \x1b[38;2;240;98;15m██\x1b[0m',
    '   \x1b[38;2;220;74;12m██   ██\x1b[0m'
  ];
  return lines.join('\n');
}

export function getStatusBar(options: BannerStatusOptions): string {
  const conn = options.connected
    ? `${chalk.green('●')} ${chalk.greenBright.bold('CONECTADO')} ${chalk.gray(options.wsUrl)}`
    : `${chalk.red('●')} ${chalk.redBright.bold('DESCONECTADO')} ${chalk.gray(options.wsUrl)}`;
  let mic: string;
  if (options.isCapturingVoice) {
    mic = chalk.bgRed.white.bold(' 🎙️ CAPTURANDO ');
  } else if (options.voiceEnabled) {
    mic = `${chalk.green('●')} ${chalk.white('Mic')} ${chalk.gray('"hey helix"')}`;
  } else {
    mic = `${chalk.red('●')} ${chalk.gray('Mic Off')}`;
  }
  const model = options.currentModel
    ? `${chalk.hex('#FF9F1C')('⚡')} ${chalk.white(options.currentModel)}`
    : `${chalk.hex('#FF9F1C')('⚡')} ${chalk.white('Local ReAct')}`;
  const tasks = (options.activeTasksCount ?? 0) > 0
    ? `  ${chalk.yellow('⏳')} ${chalk.yellowBright(String(options.activeTasksCount))}`
    : '';
  const sep = chalk.gray(' │ ');
  return `  ${conn}${sep}${mic}${sep}${model}${tasks}`;
}

export function renderHeader(options: BannerStatusOptions, clearScreen: boolean = false): void {
  if (clearScreen) {
    process.stdout.write('\x1bc');
  }
  const width = process.stdout.columns || 80;
  const logo = getAsciiLogo(width);
  const tagline = 'Persistent AI Desktop Agent';
  const tagPad = Math.max(0, Math.floor((width - tagline.length - 8) / 2));
  const subtitle = ' '.repeat(tagPad) + chalk.gray('╶───') + ' ' + chalk.hex('#FF9F1C')(tagline) + ' ' + chalk.gray('───╴');
  const statusBar = getStatusBar(options);
  const thinLine = chalk.gray('─'.repeat(width));
  console.log('');
  console.log(logo);
  console.log('');
  console.log(subtitle);
  console.log('');
  console.log(thinLine);
  console.log(statusBar);
  console.log(thinLine);
  console.log(`  ${chalk.hex('#FF8C00')('@skill')} ${chalk.gray('Skills')}  ${chalk.gray('│')}  ${chalk.cyan('#mcp')} ${chalk.gray('Herramientas')}  ${chalk.gray('│')}  ${chalk.magenta('/help')} ${chalk.gray('Comandos')}`);
  console.log(thinLine);
  console.log('');
}

export function getVoiceIndicator(isCapturing: boolean, voiceEnabled: boolean): string {
  if (isCapturing) return chalk.bgRed.white.bold(' 🎙️  VOZ DETECTADA [HEY HELIX] 🔊 ');
  if (voiceEnabled) return chalk.green('🟢 [Mic Activo]');
  return chalk.red('🔴 [Mic Inactivo]');
}

export const HELIX_LOGO_ASCII = getAsciiLogo;
export const HELIX_BIG_ART = getAsciiLogo;
export const HELIX_HARD_BLOCKS = getAsciiLogo;