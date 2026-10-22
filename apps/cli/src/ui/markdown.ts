import chalk from 'chalk';

/**
 * Formats Markdown text for optimal display in terminal emulators,
 * resolving visual noise from unparsed asterisks (*, **) and headers.
 */
export function formatTerminalMarkdown(content: string, plain = false): string {
  if (!content) return '';

  const lines = content.split('\n');
  const formattedLines = lines.map((line) => {
    let formatted = line;

    // Headers (#, ##, ###)
    const headerMatch = formatted.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      const title = headerMatch[2].trim();
      if (plain) {
        return title.toUpperCase();
      }
      return chalk.hex('#FF9F1C').bold(title);
    }

    // Bullet lists (* item, - item)
    if (/^\s*[*+-]\s+/.test(formatted)) {
      formatted = formatted.replace(/^(\s*)[*+-]\s+/, (_m, indent) => {
        return plain ? `${indent}- ` : `${indent}${chalk.hex('#FF8C00')('•')} `;
      });
    }

    // Inline bold (**text** or __text__)
    formatted = formatted.replace(/(\*\*|__)(.*?)\1/g, (_m, _delim, text) => {
      return plain ? text : chalk.bold(text);
    });

    // Inline italics (*text* or _text_)
    formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g, (_m, t1, t2) => {
      const text = t1 || t2;
      return plain ? text : chalk.whiteBright(text);
    });

    // Inline code (`code`)
    formatted = formatted.replace(/`([^`]+)`/g, (_m, code) => {
      return plain ? code : chalk.cyan(code);
    });

    return formatted;
  });

  return formattedLines.join('\n');
}
