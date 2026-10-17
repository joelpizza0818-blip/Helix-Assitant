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
//  HELIX — Kiro-style noise/glitch dot-matrix logo.
//  Each letter is drawn on a 9-row grid using small mixed
//  characters (@, #, %, *, +, =, ~) like the Kiro CLI banner.
//  Empty cells are a dim background dot (·).
//  Colors cycle per-character: orange, white, cyan.
// ═══════════════════════════════════════════════════════════════

// Character sets used to fill "on" pixels (noise effect)
const NOISE = ['@@', '%%', '##', '**', '++', '==', '~~', '$$'];

// Deterministic noise: pick char based on row+col position
function noiseCh(row: number, col: number): string {
  return NOISE[(row * 3 + col * 7) % NOISE.length];
}

// Color cycle per character — orange dominant, accents of white/cyan
function noiseColor(row: number, col: number): string {
  const v = (row * 5 + col * 3) % 9;
  if (v < 5) return '#FF8C00';   // orange (dominant)
  if (v < 7) return '#FFFFFF';   // white accent
  return '#00BFFF';              // cyan accent
}

const OFF = '  ';  // 2 spaces per empty cell

// ── Letter bitmaps — 1=on, 0=off, 9 rows × 5 cols each ────────

const H = [
  [1,0,0,0,1],
  [1,0,0,0,1],
  [1,0,0,0,1],
  [1,1,1,1,1],
  [1,1,1,1,1],
  [1,0,0,0,1],
  [1,0,0,0,1],
  [1,0,0,0,1],
  [1,0,0,0,1],
];

const E = [
  [1,1,1,1,1],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,1,1,1,0],
  [1,1,1,1,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,1,1,1,1],
];

const L = [
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,0,0,0,0],
  [1,1,1,1,1],
];

const I = [
  [1,1,1,1,1],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [0,0,1,0,0],
  [1,1,1,1,1],
];

const X = [
  [1,0,0,0,1],
  [1,1,0,1,1],
  [0,1,0,1,0],
  [0,1,1,1,0],
  [0,0,1,0,0],
  [0,1,1,1,0],
  [0,1,0,1,0],
  [1,1,0,1,1],
  [1,0,0,0,1],
];

const LETTERS = [H, E, L, I, X];
const LETTER_GAP = 2;  // empty cols between letters
const ROWS = 9;
const COLS_PER_LETTER = 5;

// ── Gradient: top rows = white/yellow, mid = orange, base = dark orange
const ROW_COLORS: string[] = [
  '#FFFBE8',
  '#FFE566',
  '#FFD700',
  '#FFBA08',
  '#FF9F1C',
  '#FF8C00',
  '#F07800',
  '#E66D00',
  '#CC5500',
];

// ───────────────────────────────────────────────────────────────
//  Public API
// ───────────────────────────────────────────────────────────────

export function getAsciiLogo(terminalWidth: number = 80): string {
  // total width: 5 letters × 5 cols × 2 chars + 4 gaps × 2 chars × 2
  const totalCols = LETTERS.length * COLS_PER_LETTER + (LETTERS.length - 1) * LETTER_GAP;
  const totalChars = totalCols * 2;
  const leftPad = Math.max(0, Math.floor((terminalWidth - totalChars) / 2));
  const pad = ' '.repeat(leftPad);

  const lines: string[] = [];

  for (let row = 0; row < ROWS; row++) {
    let line = pad;
    let globalCol = 0;

    for (let li = 0; li < LETTERS.length; li++) {
      const letter = LETTERS[li];

      for (let col = 0; col < COLS_PER_LETTER; col++) {
        if (letter[row][col]) {
          const ch = noiseCh(row, globalCol);
          // blend per-cell noise color with row gradient
          const color = (row + globalCol) % 4 === 0
            ? noiseColor(row, globalCol)
            : ROW_COLORS[row];
          line += chalk.hex(color).bold(ch);
        } else {
          line += chalk.hex('#333333')('··');
        }
        globalCol++;
      }

      // gap between letters
      if (li < LETTERS.length - 1) {
        for (let g = 0; g < LETTER_GAP; g++) {
          line += chalk.hex('#333333')('··');
          globalCol++;
        }
      }
    }

    lines.push(line);
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
//  HELIX brand mark — faithful ASCII replica.
//
//  The real logo has THREE vertical bar groups:
//    Left  : 2 thin bars (outer left accent + inner left pillar)
//    Center: 1 thin bar  (shorter, only mid-height crossbar)
//    Right : 2 thin bars (inner right pillar + outer right accent)
//
//  Each bar is rendered as a column of "██" blocks.
//  Gradient runs top (cream/white) → bottom (burnt orange).
//
//  Layout per row — 6 columns of dots, each dot = "██" + 1 space:
//    col 0 : outer-left   bar
//    col 1 : inner-left   bar  (full height)
//    col 2 : (gap)
//    col 3 : center       bar  (rows 4-8 only — the crossbar)
//    col 4 : (gap)
//    col 5 : inner-right  bar  (full height)
//    col 6 : outer-right  bar
//
//  13 rows total.  The outer bars are shorter (rows 2-10).
// ═══════════════════════════════════════════════════════════════

// Columns:  [outerL, innerL, gap, center, gap, innerR, outerR]
// 1 = block on, 0 = off
const H_DOTS: number[][] = [
//   oL  iL  g   ce  g   iR  oR
  [  0,  1,  0,  0,  0,  1,  0 ],  //  0
  [  0,  1,  0,  0,  0,  1,  0 ],  //  1
  [  1,  1,  0,  0,  0,  1,  1 ],  //  2  outer bars start
  [  1,  1,  0,  0,  0,  1,  1 ],  //  3
  [  1,  1,  0,  0,  0,  1,  1 ],  //  4
  [  1,  1,  1,  1,  1,  1,  1 ],  //  5  crossbar top
  [  1,  1,  1,  1,  1,  1,  1 ],  //  6  crossbar bottom
  [  1,  1,  0,  0,  0,  1,  1 ],  //  7
  [  1,  1,  0,  0,  0,  1,  1 ],  //  8
  [  1,  1,  0,  0,  0,  1,  1 ],  //  9
  [  1,  1,  0,  0,  0,  1,  1 ],  // 10  outer bars end
  [  0,  1,  0,  0,  0,  1,  0 ],  // 11
  [  0,  1,  0,  0,  0,  1,  0 ],  // 12
];

const DOT_ON  = '██ ';  // block + 1 space → each cell = 3 chars
const DOT_OFF = '   ';  // 3 spaces

/** Top-to-bottom gradient — cream flame tip → burnt-orange base */
const ICON_GRADIENT: string[] = [
  '#FFFBE8',  //  0 — near-white cream
  '#FFF4CC',  //  1
  '#FFE566',  //  2 — bright yellow
  '#FFD700',  //  3 — gold
  '#FFBA08',  //  4 — gold-orange
  '#FFAA00',  //  5 — amber
  '#FF9F1C',  //  6 — orange (crossbar)
  '#FF9000',  //  7
  '#FF8C00',  //  8 — brand orange
  '#F07800',  //  9
  '#E66D00',  // 10 — dark orange
  '#D96000',  // 11
  '#CC5500',  // 12 — burnt orange
];

// 7 cols × 3 chars = 21 chars wide
const LOGO_W = 21;

// ───────────────────────────────────────────────────────────────
//  Public API
// ───────────────────────────────────────────────────────────────

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
