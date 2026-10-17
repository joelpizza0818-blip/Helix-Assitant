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

// ═══════════════════════════════════════════════════════════════
//  Dot-matrix H — matches the HELIX brand mark.
//  Each "dot" is two spaces wide ("██" = on, "  " = off)
//  so the letter has square proportions in a terminal.
//  Grid: 13 rows × 9 dot-columns  →  13 rows × 18 chars wide.
// ═══════════════════════════════════════════════════════════════

// 1 = dot on, 0 = dot off  (9 columns per row)
const H_DOTS: number[][] = [
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  //  0  ██           ██
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  //  1  ██           ██
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  //  2  ██           ██
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  //  3  ██           ██
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  //  4  ██           ██
  [1, 1, 1, 1, 1, 1, 1, 1, 1],  //  5  ████████████████
  [1, 1, 1, 1, 1, 1, 1, 1, 1],  //  6  ████████████████
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  //  7  ██           ██
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  //  8  ██           ██
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  //  9  ██           ██
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  // 10  ██           ██
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  // 11  ██           ██
  [1, 1, 0, 0, 0, 0, 0, 1, 1],  // 12  ██           ██
];

const DOT_ON  = '██';
const DOT_OFF = '  ';

/** Top-to-bottom gradient (row 0 = flame tip, row 12 = base) */
const ICON_GRADIENT: string[] = [
  '#FFFBE8',  //  0 — near-white cream (flame glow)
  '#FFF0A0',  //  1 — pale yellow
  '#FFE566',  //  2 — bright yellow
  '#FFD700',  //  3 — gold
  '#FFBA08',  //  4 — gold-orange
  '#FFAA00',  //  5 — amber
  '#FF9F1C',  //  6 — orange (crossbar top)
  '#FF9000',  //  7 — orange (crossbar bottom)
  '#FF8C00',  //  8 — brand orange
  '#F07800',  //  9
  '#E66D00',  // 10 — dark orange
  '#D96000',  // 11
  '#CC5500',  // 12 — burnt orange (base)
];

// Each row is 9 dots × 2 chars = 18 chars wide
const LOGO_W = 18;

// ───────────────────────────────────────────────────────────────
//  Public API
// ───────────────────────────────────────────────────────────────

/**
 * Returns the dot-matrix HELIX H logo,
 * horizontally centered for the given terminal width.
 */
export function getAsciiLogo(terminalWidth: number = 80): string {
  const leftPad = Math.max(0, Math.floor((terminalWidth - LOGO_W) / 2));
  const pad = ' '.repeat(leftPad);

  return H_DOTS
    .map((row, i) => {
      const rowStr = row.map((dot) => (dot ? DOT_ON : DOT_OFF)).join('');
      return pad + chalk.hex(ICON_GRADIENT[i]).bold(rowStr);
    })
    .join('\n');
}

/**
 * Compact, badge-style status bar.
 */
export function getStatusBar(options: BannerStatusOptions): string {
  // ── Connection ──
  const conn = options.connected
    ? `${chalk.green('●')} ${chalk.greenBright.bold('CONECTADO')} ${chalk.gray(options.wsUrl)}`
    : `${chalk.red('●')} ${chalk.redBright.bold('DESCONECTADO')} ${chalk.gray(options.wsUrl)}`;

  // ── Microphone ──
  let mic: string;
  if (options.isCapturingVoice) {
    mic = chalk.bgRed.white.bold(' 🎙️ CAPTURANDO ');
  } else if (options.voiceEnabled) {
    mic = `${chalk.green('●')} ${chalk.white('Mic')} ${chalk.gray('"hey helix"')}`;
  } else {
    mic = `${chalk.red('●')} ${chalk.gray('Mic Off')}`;
  }

  // ── Model ──
  const model = options.currentModel
    ? `${chalk.hex('#FF9F1C')('⚡')} ${chalk.white(options.currentModel)}`
    : `${chalk.hex('#FF9F1C')('⚡')} ${chalk.white('Local ReAct')}`;

  // ── Active tasks ──
  const tasks = (options.activeTasksCount ?? 0) > 0
    ? `  ${chalk.yellow('⏳')} ${chalk.yellowBright(String(options.activeTasksCount))}`
    : '';

  const sep = chalk.gray(' │ ');
  return `  ${conn}${sep}${mic}${sep}${model}${tasks}`;
}

/**
 * Renders the persistent header. Clears screen only if clearScreen is explicitly true.
 */
export function renderHeader(options: BannerStatusOptions, clearScreen: boolean = false): void {
  if (clearScreen) {
    // Clear screen + move cursor to top-left
    process.stdout.write('\x1bc');
  }

  const width = process.stdout.columns || 80;

  // ── Logo ──
  const logo = getAsciiLogo(width);

  // ── Tagline ──
  const tagline = 'Persistent AI Desktop Agent';
  const tagPad = Math.max(0, Math.floor((width - tagline.length - 8) / 2));
  const subtitle =
    ' '.repeat(tagPad) +
    chalk.gray('╶───') +
    ' ' +
    chalk.hex('#FF9F1C')(tagline) +
    ' ' +
    chalk.gray('───╴');

  // ── Status bar ──
  const statusBar = getStatusBar(options);

  // ── Visual lines ──
  const thinLine = chalk.gray('─'.repeat(width));

  // ── Render ──
  console.log('');
  console.log(logo);
  console.log('');
  console.log(subtitle);
  console.log('');
  console.log(thinLine);
  console.log(statusBar);
  console.log(thinLine);
  console.log(
    `  ${chalk.hex('#FF8C00')('@skill')} ${chalk.gray('Skills')}  ${chalk.gray('│')}  ` +
    `${chalk.cyan('#mcp')} ${chalk.gray('Herramientas')}  ${chalk.gray('│')}  ` +
    `${chalk.magenta('/help')} ${chalk.gray('Comandos')}`
  );
  console.log(thinLine);
  console.log('');
}

/**
 * Voice-capture indicator badge (for inline use in prompts).
 */
export function getVoiceIndicator(isCapturing: boolean, voiceEnabled: boolean): string {
  if (isCapturing) {
    return chalk.bgRed.white.bold(' 🎙️  VOZ DETECTADA [HEY HELIX] 🔊 ');
  }
  if (voiceEnabled) {
    return chalk.green('🟢 [Mic Activo]');
  }
  return chalk.red('🔴 [Mic Inactivo]');
}

// Legacy named exports kept for compatibility with other modules
export const HELIX_LOGO_ASCII  = H_DOTS;
export const HELIX_BIG_ART     = H_DOTS;
export const HELIX_HARD_BLOCKS = H_DOTS;
