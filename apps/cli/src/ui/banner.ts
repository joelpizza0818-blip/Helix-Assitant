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
//  Pixel-art H icon — faithful replica of the Helix brand logo
//  Two inner vertical pillars (full height), thin outer accent
//  bars (mid-height), horizontal crossbar, flame tips at top.
//  23 chars wide × 8 rows.
// ═══════════════════════════════════════════════════════════════

const H_ICON: string[] = [
  '        ▒█   █▒        ',  // row 0 — flame tips
  '        ██   ██        ',  // row 1 — inner pillars top
  '  ▐█    ██   ██    █▌  ',  // row 2 — outer accents begin
  '  ▐█    ███████    █▌  ',  // row 3 — crossbar
  '  ▐█    ███████    █▌  ',  // row 4 — crossbar
  '  ▐█    ██   ██    █▌  ',  // row 5 — outer accents end
  '        ██   ██        ',  // row 6 — inner pillars
  '        ██   ██        ',  // row 7 — inner pillars bottom
];

// ═══════════════════════════════════════════════════════════════
//  "ELIX" in geometric block letters  (28 chars wide × 5 rows)
//  Letters:  E (6w)  L (6w)  I (2w)  X (8w)  — 2-char gaps
// ═══════════════════════════════════════════════════════════════

const ELIX_TEXT: string[] = [
  '██████  ██      ██  ██    ██',
  '██      ██      ██   ██  ██ ',
  '█████   ██      ██    ████  ',
  '██      ██      ██   ██  ██ ',
  '██████  ██████  ██  ██    ██',
];

/** ELIX text starts at H_ICON row 2 (vertically centered) */
const ELIX_OFFSET = 2;

/** Top-to-bottom gradient for the H icon (white-flame → burnt orange) */
const ICON_GRADIENT: string[] = [
  '#FFFBE8',  // 0 — near-white cream  (flame glow)
  '#FFE566',  // 1 — bright yellow
  '#FFD700',  // 2 — gold
  '#FFBA08',  // 3 — gold-orange
  '#FF9F1C',  // 4 — orange
  '#FF8C00',  // 5 — brand orange
  '#E66D00',  // 6 — dark orange
  '#CC5500',  // 7 — burnt orange
];

const ICON_W  = 23;
const GAP     = '    ';   // 4 chars between icon and text
const GAP_W   = GAP.length;
const ELIX_W  = 28;
const FULL_W  = ICON_W + GAP_W + ELIX_W;  // 55

// ───────────────────────────────────────────────────────────────
//  Public API
// ───────────────────────────────────────────────────────────────

/**
 * Returns the combined HELIX logo (pixel H + ELIX text),
 * horizontally centered for the given terminal width.
 */
export function getAsciiLogo(terminalWidth: number = 80): string {
  const leftPad = Math.max(0, Math.floor((terminalWidth - FULL_W) / 2));
  const pad = ' '.repeat(leftPad);

  return H_ICON
    .map((iconRow, i) => {
      const coloredIcon = chalk.hex(ICON_GRADIENT[i]).bold(iconRow);
      const elixIdx = i - ELIX_OFFSET;

      if (elixIdx >= 0 && elixIdx < ELIX_TEXT.length) {
        const coloredElix = chalk.whiteBright.bold(ELIX_TEXT[elixIdx]);
        return pad + coloredIcon + GAP + coloredElix;
      }

      return pad + coloredIcon;
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
 * Clears the terminal and renders the full persistent header.
 */
export function renderHeader(options: BannerStatusOptions): void {
  // Clear screen + move cursor to top-left
  process.stdout.write('\x1bc');

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
export const HELIX_LOGO_ASCII  = H_ICON;
export const HELIX_BIG_ART     = H_ICON;
export const HELIX_HARD_BLOCKS = H_ICON;
