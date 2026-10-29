import chalk from 'chalk';
import type { AgentClient } from '../client/agent-client';
import { CYAN, GREEN, RED, YELLOW, GRAY, BOLD, DIM } from '../ui/colors';

export async function handleBrowserCommand(
  client: AgentClient,
  args?: string
): Promise<void> {
  const parts = args ? args.trim().split(/\s+/) : [];
  const subCommand = parts[0]?.toLowerCase();
  const targetUrl = parts[1];

  if (subCommand === 'open' && targetUrl) {
    console.log(CYAN(`\n  Solicitando al agente abrir en navegador: ${targetUrl}...`));
    client.sendUserText(
      `Por favor abre la siguiente URL en el navegador: ${targetUrl}`,
      `cli_browser_${Date.now()}`
    );
    console.log(GREEN(`  ✔ Comando enviado al agente.\n`));
    return;
  }

  try {
    const settings = await client.getSettings();
    const engine = (settings.browser_engine as string) || 'chromium';
    const headless = settings.browser_headless !== false;

    console.log(`\n${BOLD('🌐 Estado de Navegación y Browser Bridge:')}\n`);
    console.log(`  Motor:       ${CYAN(engine.toUpperCase())}`);
    console.log(`  Modo:        ${headless ? chalk.yellow('Headless') : chalk.green('Ventana Visible')}`);
    console.log(`  Descargas:   ${settings.block_downloads ? RED('Bloqueadas') : GREEN('Permitidas')}`);
    console.log(`  Dominios:    ${settings.block_untrusted_domains ? YELLOW('Filtrado Estricto') : GRAY('Abierto')}`);
    console.log(`\n  ${DIM('Comandos disponibles:')}`);
    console.log(`    ${CYAN('/browser')}              ${DIM('- Ver estado de navegación')}`);
    console.log(`    ${CYAN('/browser open <url>')}   ${DIM('- Abrir URL con el agente')}`);
    console.log(`    ${CYAN('/browser live [on|off]')} ${DIM('- Alternar la vista ASCII de capturas')}\n`);
  } catch (err) {
    console.log(RED(`  Error al consultar estado del navegador: ${(err as Error).message}\n`));
  }
}
