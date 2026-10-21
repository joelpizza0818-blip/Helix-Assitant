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
//  HELIX — Pixel-art dot-matrix logo.
//  Each letter is drawn on an 8-row × 5-col grid.
//  "On" pixels → "██" block, "off" pixels → "  " (space).
//  Gradient runs top → bottom:
//    rows 0-1 : bright white/cream
//    rows 2-3 : bright yellow
//    rows 4-5 : orange
//    rows 6-7 : deep red
//  Matches the pixel-art HELIX image with yellow→orange→red gradient.
// ═══════════════════════════════════════════════════════════════

// ── Letter bitmaps — 1=on, 0=off, 8 rows × 5 cols each ────────

const H: number[][] = [
  [1,0,0,0,1],
  [1,0,0,0,1],
  [1,1,1,1,1],
  [1,1,1,1,1],
  [1,1,1,1,1],
  [1,0,0,0,1],
  [1,0,0,0,1],
  [1,0,0,0,1],
];

const E: number[][] = [
  [1,1,1,1,1],
  [1,0,0,0,0],
  [1,1,1,1,0],
  [1,1,1,1,0],
  [1,1,1,1,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,1,1,1,1],
];

const L: number[][] = [
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,1,1,1,1],
];

const I: number[][] = [
  [1,1,1,1,1],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [1,1,1,1,1],
];

const X: number[][] = [
  [1,0,0,0,1],
  [1,1,0,1,1],
  [0,1,1,1,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,1,1,1,0],
  [1,1,0,1,1],
  [1,0,0,0,1],
];

const LETTERS = [H, E, L, I, X];
const LETTER_GAP = 1;   // 1 empty col between letters
const ROWS = 8;
const COLS_PER_LETTER = 5;

// ── Top-to-bottom gradient — cream/white → yellow → orange → red ──
// Row 0 = top, row 7 = bottom
const ROW_COLORS: string[] = [
  '#FFF9E0',  // 0 — near-white cream
  '#FFE84D',  // 1 — bright yellow
  '#FFD200',  // 2 — gold yellow
  '#FFB300',  // 3 — amber
  '#FF8C00',  // 4 — orange
  '#FF6600',  // 5 — deep orange
  '#E63000',  // 6 — red-orange
  '#CC1A00',  // 7 — deep red
];

const BLOCK_ON  = '██';  // filled square block
const BLOCK_OFF = '  ';  // empty (black background)

// ───────────────────────────────────────────────────────────────
//  Public API
// ───────────────────────────────────────────────────────────────

export function getAsciiLogo(terminalWidth: number = 80): string {
  // total character width: each cell = 2 chars
  const totalCols = LETTERS.length * COLS_PER_LETTER + (LETTERS.length - 1) * LETTER_GAP;
  const totalChars = totalCols * 2;
  const leftPad = Math.max(0, Math.floor((terminalWidth - totalChars) / 2));
  const pad = ' '.repeat(leftPad);

  const lines: string[] = [];

  for (let row = 0; row < ROWS; row++) {
    let line = pad;

    for (let li = 0; li < LETTERS.length; li++) {
      const letter = LETTERS[li];

      for (let col = 0; col < COLS_PER_LETTER; col++) {
        if (letter[row][col]) {
          line += chalk.hex(ROW_COLORS[row]).bold(BLOCK_ON);
        } else {
          line += BLOCK_OFF;
        }
      }

      // gap between letters
      if (li < LETTERS.length - 1) {
        line += BLOCK_OFF.repeat(LETTER_GAP);
      }
    }

    lines.push(line);
  }

  return lines.join('\n');
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
export const HELIX_LOGO_ASCII  = LETTERS;
export const HELIX_BIG_ART     = LETTERS;
export const HELIX_HARD_BLOCKS = LETTERS;
