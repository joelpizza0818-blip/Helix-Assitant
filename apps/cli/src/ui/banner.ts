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

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
//  HELIX Ã¢â‚¬â€ Pixel-art dot-matrix logo.
//  Each letter is drawn on an 8-row Ãƒâ€” 5-col grid.
//  "On" pixels Ã¢â€ â€™ "Ã¢â€“Ë†Ã¢â€“Ë†" block, "off" pixels Ã¢â€ â€™ "  " (space).
//  Gradient runs top Ã¢â€ â€™ bottom:
//    rows 0-1 : bright white/cream
//    rows 2-3 : bright yellow
//    rows 4-5 : orange
//    rows 6-7 : deep red
//  Matches the pixel-art HELIX image with yellowÃ¢â€ â€™orangeÃ¢â€ â€™red gradient.
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

// Ã¢â€â‚¬Ã¢â€â‚¬ Letter bitmaps Ã¢â‚¬â€ 1=on, 0=off, 8 rows Ãƒâ€” 5 cols each Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const H: number[][] = [
  [1,0,1,0,1],
  [1,0,1,0,1],
  [1,1,1,1,1],
  [1,1,1,1,1],
  [1,1,1,1,1],
  [1,0,1,0,1],
  [1,0,1,0,1],
  [1,0,1,0,1],
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

// Ã¢â€â‚¬Ã¢â€â‚¬ Top-to-bottom gradient Ã¢â‚¬â€ cream/white Ã¢â€ â€™ yellow Ã¢â€ â€™ orange Ã¢â€ â€™ red Ã¢â€â‚¬Ã¢â€â‚¬
// Row 0 = top, row 7 = bottom
const ROW_COLORS: string[] = [
  '#FFF9E0',  // 0 Ã¢â‚¬â€ near-white cream
  '#FFE84D',  // 1 Ã¢â‚¬â€ bright yellow
  '#FFD200',  // 2 Ã¢â‚¬â€ gold yellow
  '#FFB300',  // 3 Ã¢â‚¬â€ amber
  '#FF8C00',  // 4 Ã¢â‚¬â€ orange
  '#FF6600',  // 5 Ã¢â‚¬â€ deep orange
  '#E63000',  // 6 Ã¢â‚¬â€ red-orange
  '#CC1A00',  // 7 Ã¢â‚¬â€ deep red
];

const BLOCK_ON  = 'Ã¢â€“Ë†Ã¢â€“Ë†';  // filled square block
const BLOCK_OFF = '  ';  // empty (black background)

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
//  Public API
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

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
  // Ã¢â€â‚¬Ã¢â€â‚¬ Connection Ã¢â€â‚¬Ã¢â€â‚¬
  const conn = options.connected
    ? `${chalk.green('Ã¢â€”Â')} ${chalk.greenBright.bold('CONECTADO')} ${chalk.gray(options.wsUrl)}`
    : `${chalk.red('Ã¢â€”Â')} ${chalk.redBright.bold('DESCONECTADO')} ${chalk.gray(options.wsUrl)}`;

  // Ã¢â€â‚¬Ã¢â€â‚¬ Microphone Ã¢â€â‚¬Ã¢â€â‚¬
  let mic: string;
  if (options.isCapturingVoice) {
    mic = chalk.bgRed.white.bold(' Ã°Å¸Å½â„¢Ã¯Â¸Â CAPTURANDO ');
  } else if (options.voiceEnabled) {
    mic = `${chalk.green('Ã¢â€”Â')} ${chalk.white('Mic')} ${chalk.gray('"hey helix"')}`;
  } else {
    mic = `${chalk.red('Ã¢â€”Â')} ${chalk.gray('Mic Off')}`;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Model Ã¢â€â‚¬Ã¢â€â‚¬
  const model = options.currentModel
    ? `${chalk.hex('#FF9F1C')('Ã¢Å¡Â¡')} ${chalk.white(options.currentModel)}`
    : `${chalk.hex('#FF9F1C')('Ã¢Å¡Â¡')} ${chalk.white('Local ReAct')}`;

  // Ã¢â€â‚¬Ã¢â€â‚¬ Active tasks Ã¢â€â‚¬Ã¢â€â‚¬
  const tasks = (options.activeTasksCount ?? 0) > 0
    ? `  ${chalk.yellow('Ã¢ÂÂ³')} ${chalk.yellowBright(String(options.activeTasksCount))}`
    : '';

  const sep = chalk.gray(' Ã¢â€â€š ');
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ Logo Ã¢â€â‚¬Ã¢â€â‚¬
  const logo = getAsciiLogo(width);

  // Ã¢â€â‚¬Ã¢â€â‚¬ Tagline Ã¢â€â‚¬Ã¢â€â‚¬
  const tagline = 'Persistent AI Desktop Agent';
  const tagPad = Math.max(0, Math.floor((width - tagline.length - 8) / 2));
  const subtitle =
    ' '.repeat(tagPad) +
    chalk.gray('Ã¢â€¢Â¶Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬') +
    ' ' +
    chalk.hex('#FF9F1C')(tagline) +
    ' ' +
    chalk.gray('Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€¢Â´');

  // Ã¢â€â‚¬Ã¢â€â‚¬ Status bar Ã¢â€â‚¬Ã¢â€â‚¬
  const statusBar = getStatusBar(options);

  // Ã¢â€â‚¬Ã¢â€â‚¬ Visual lines Ã¢â€â‚¬Ã¢â€â‚¬
  const thinLine = chalk.gray('Ã¢â€â‚¬'.repeat(width));

  // Ã¢â€â‚¬Ã¢â€â‚¬ Render Ã¢â€â‚¬Ã¢â€â‚¬
  console.log('');
  console.log(logo);
  console.log('');
  console.log(subtitle);
  console.log('');
  console.log(thinLine);
  console.log(statusBar);
  console.log(thinLine);
  console.log(
    `  ${chalk.hex('#FF8C00')('@skill')} ${chalk.gray('Skills')}  ${chalk.gray('Ã¢â€â€š')}  ` +
    `${chalk.cyan('#mcp')} ${chalk.gray('Herramientas')}  ${chalk.gray('Ã¢â€â€š')}  ` +
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
    return chalk.bgRed.white.bold(' Ã°Å¸Å½â„¢Ã¯Â¸Â  VOZ DETECTADA [HEY HELIX] Ã°Å¸â€Å  ');
  }
  if (voiceEnabled) {
    return chalk.green('Ã°Å¸Å¸Â¢ [Mic Activo]');
  }
  return chalk.red('Ã°Å¸â€Â´ [Mic Inactivo]');
}

// Legacy named exports kept for compatibility with other modules
export const HELIX_LOGO_ASCII  = LETTERS;
export const HELIX_BIG_ART     = LETTERS;
export const HELIX_HARD_BLOCKS = LETTERS;
