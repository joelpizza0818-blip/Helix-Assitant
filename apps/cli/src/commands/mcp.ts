mport prompts from 'prompts';
import chalk from 'chalk';
import type { AgentClient } from '../client/agent-client';
import type { McpServerConfig } from '../client/types';
import { formatMcp, CYAN_BOLD, GREEN, RED, YELLOW, GRAY, BOLD, DIM } from '../ui/colors';

export async function handleListMcp(client: AgentClient): Promise<void> {
  console.log(`\n${BOLD('ðŸ”Œ Servidores y Herramientas MCP:')}\n`);

  try {
    const servers = await client.getMcpServers();
    if (!servers || servers.length === 0) {
      console.log(GRAY('  No hay servidores MCP configurados actualmente.'));
      console.log(DIM('  Usa /create-mcp para configurar uno nuevo.\n'));
      return;
    }

    for (const server of servers) {
      let statusBadge = chalk.gray('idle');
      if (server.status === 'connected') {
        statusBadge = chalk.green('â— Conectado');
      } else if (server.status === 'connecting') {
        statusBadge = chalk.yellow('â³ Conectando');
      } else if (server.status === 'error') {
        statusBadge = chalk.red('âœ– Error');
      }

      console.log(`  ${CYAN_BOLD('â—ˆ')} ${formatMcp(server.name)}  [${statusBadge}]`);
      console.log(`    ${GRAY('Comando:')} ${chalk.white(server.command)}`);
      if (server.error) {
        console.log(`    ${RED('Error:')} ${server.error}`);
      }
      if (server.tools && server.tools.length > 0) {
        console.log(`    ${DIM('Herramientas provistas:')}`);
        for (const tool of server.tools) {
          console.log(`      ${DIM('â€¢')} ${formatMcp(tool.name)}${tool.description ? DIM(` - ${tool.description}`) : ''}`);
        }
      }
      console.log('');
    }
  } catch (err) {
    console.log(RED(`  Error al obtener servidores MCP: ${(err as Error).message}\n`));
  }
}

export async function handleCreateMcp(client: AgentClient): Promise<void> {
  console.log(`\n${BOLD('âš™ï¸  Registrar Nuevo Servidor MCP')}\n`);

  const answers = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Nombre identificador del servidor MCP (ej. filesystem, github, fetch):',
      validate: (v: string) =>
        /^[a-zA-Z0-9_-]+$/.test(v) ? true : 'Usa solo letras, nÃºmeros, guiones y guiones bajos',
    },
    {
      type: 'text',
      name: 'command',
      message: 'Comando ejecutable o npx (ej. npx -y @modelcontextprotocol/server-filesystem C:\\work):',
      validate: (v: string) => (v && v.trim() ? true : 'El comando es requerido'),
    },
    {
      type: 'text',
      name: 'env',
      message: 'Variables de entorno opcionales (formato KEY=VALUE,KEY2=VALUE2):',
      initial: '',
    },
  ]);

  if (!answers.name || !answers.command) {
    console.log(YELLOW('\nOperaciÃ³n cancelada.\n'));
    return;
  }

  const envObj: Record<string, string> = {};
  if (answers.env && typeof answers.env === 'string') {
    const pairs = answers.env.split(',');
    for (const pair of pairs) {
      const [k, v] = pair.split('=');
      if (k && v) envObj[k.trim()] = v.trim();
    }
  }

  try {
    const currentSettings = await client.getSettings();
    const existingServers = (currentSettings.mcp_servers as McpServerConfig[]) || [];

    // Filter out existing with same name
    const updatedServers = existingServers.filter((s) => s.name !== answers.name);
    updatedServers.push({
      name: answers.name.trim(),
      command: answers.command.trim(),
      env: Object.keys(envObj).length > 0 ? envObj : undefined,
    });

    console.log(GRAY(`\nGuardando servidor MCP ${formatMcp(answers.name)}...`));
    await client.saveSettings({ mcp_servers: updatedServers });

    console.log(GREEN(`âœ” Â¡Servidor MCP ${formatMcp(answers.name)} registrado con Ã©xito!`));
    console.log(DIM(`  HELIX sincronizarÃ¡ las herramientas automÃ¡ticamente.\n`));
  } catch (err) {
    console.log(RED(`âœ– Error al registrar servidor MCP: ${(err as Error).message}\n`));
  }
}
