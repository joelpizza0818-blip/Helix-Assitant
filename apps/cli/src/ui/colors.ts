mport chalk from 'chalk';

export const customChalk = new chalk.Instance({ level: 3 });

// Brand colors
export const ORANGE = customChalk.hex('#FF8C00');
export const ORANGE_BOLD = customChalk.hex('#FF8C00').bold;
export const ORANGE_BG = customChalk.bgHex('#FF8C00').black.bold;

export const CYAN = customChalk.cyan;
export const CYAN_BOLD = customChalk.cyan.bold;
export const MAGENTA = customChalk.magenta;
export const MAGENTA_BOLD = customChalk.magenta.bold;
export const GREEN = customChalk.green;
export const GREEN_BOLD = customChalk.green.bold;
export const RED = customChalk.red;
export const RED_BOLD = customChalk.red.bold;
export const YELLOW = customChalk.yellow;
export const YELLOW_BOLD = customChalk.yellow.bold;
export const GRAY = customChalk.gray;
export const BOLD = customChalk.bold;
export const DIM = customChalk.dim;

/**
 * Highlights skill names with strong orange (#FF8C00).
 */
export function formatSkill(name: string): string {
  const clean = name.startsWith('@') ? name : `@${name}`;
  return ORANGE_BOLD(clean);
}

/**
 * Highlights MCP tool/server names.
 */
export function formatMcp(name: string): string {
  const clean = name.startsWith('#') ? name : `#${name}`;
  return CYAN_BOLD(clean);
}

/**
 * Highlights slash commands.
 */
export function formatCommand(cmd: string): string {
  const clean = cmd.startsWith('/') ? cmd : `/${cmd}`;
  return MAGENTA_BOLD(clean);
}

/**
 * Formats user input text highlighting @skills in orange and #mcps in cyan.
 */
export function highlightMentions(text: string, knownSkills: string[] = []): string {
  let result = text;
  
  // Highlight @skill in orange
  result = result.replace(/(^|\s)(@[a-zA-Z0-9_-]+)/g, (_match, prefix, mention) => {
    return `${prefix}${ORANGE_BOLD(mention)}`;
  });

  // Highlight #mcp in cyan
  result = result.replace(/(^|\s)(#[a-zA-Z0-9_-]+)/g, (_match, prefix, mention) => {
    return `${prefix}${CYAN_BOLD(mention)}`;
  });

  // Highlight /commands in magenta
  result = result.replace(/(^|\s)(\/[a-zA-Z0-9_-]+)/g, (_match, prefix, mention) => {
    return `${prefix}${MAGENTA_BOLD(mention)}`;
  });

  return result;
}
