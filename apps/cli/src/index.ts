mport { Command } from 'commander';
import { HelixRepl } from './ui/repl';
import { getWsUrl, getWsToken } from './config/env';
import { AgentClient } from './client/agent-client';
import type { HelixSettings } from './client/types';
import { handleShowApiKey } from './commands/apikey';
import { ORANGE, CYAN, GREEN, RED, BOLD, DIM } from './ui/colors';
import { getAsciiLogo } from './ui/banner';

const program = new Command();

program
  .name('helix')
  .description('HELIX - Interactive Terminal CLI for Windows AI Desktop Agent')
  .version('0.1.0')
  .option('-u, --ws-url <url>', 'URL del servidor WebSocket del agente', getWsUrl())
  .option('-t, --token <token>', 'Token de autenticaciÃ³n WebSocket de HELIX', getWsToken())
  .action(async (options) => {
    // Default action: start interactive chat REPL
    const repl = new HelixRepl({
      wsUrl: options.wsUrl || getWsUrl(),
      wsToken: options.token || getWsToken(),
    });
    await repl.start();
  });

program
  .command('chat')
  .description('Iniciar sesiÃ³n de chat interactivo con HELIX')
  .action(async () => {
    const opts = program.opts();
    const repl = new HelixRepl({
      wsUrl: opts.wsUrl || getWsUrl(),
      wsToken: opts.token || getWsToken(),
    });
    await repl.start();
  });

program
  .command('run <prompt>')
  .description('Ejecutar un prompt directamente y esperar la respuesta')
  .action(async (promptText: string) => {
    const opts = program.opts();
    const client = new AgentClient({
      wsUrl: opts.wsUrl || getWsUrl(),
      wsToken: opts.token || getWsToken(),
      autoReconnect: false,
    });

    console.log(CYAN(`Conectando con HELIX en ${client.url}...`));
    try {
      await client.connect();
    } catch (err) {
      console.error(RED(`No se pudo conectar al agente HELIX: ${(err as Error).message}`));
      process.exit(1);
    }

    console.log(DIM(`Prompt: ${promptText}\n`));
    const convId = `cli_run_${Date.now()}`;

    client.on('react_step', (step: { iteration?: number }) => {
      process.stdout.write(`\r${DIM(`[ReAct Step ${step?.iteration || 1}...]`)}`);
    });

    client.on('agent_message', (payload: { content?: string }) => {
      process.stdout.write('\r\x1b[K');
      console.log(payload?.content || '');
      client.close();
      process.exit(0);
    });

    client.sendUserText(promptText, convId);

    // Timeout safety
    setTimeout(() => {
      console.error(RED('\nTiempo de espera agotado sin respuesta del agente.'));
      client.close();
      process.exit(1);
    }, 60000);
  });

program
  .command('status')
  .description('Consultar el estado del agente y los subsistemas')
  .action(async () => {
    const opts = program.opts();
    const client = new AgentClient({
      wsUrl: opts.wsUrl || getWsUrl(),
      wsToken: opts.token || getWsToken(),
      autoReconnect: false,
    });

    console.log(getAsciiLogo());
    console.log(BOLD('Consultando estado de HELIX...\n'));

    try {
      await client.connect();
      console.log(`  ${GREEN('â— Conectado')} al agente en ${client.url}`);

      const [settings, skills, mcpServers] = await Promise.all([
        client.getSettings().catch(() => ({} as HelixSettings)),
        client.getSkills().catch(() => []),
        client.getMcpServers().catch(() => []),
      ]);

      const micStatus = settings.voice_enabled !== false ? GREEN('ðŸŸ¢ Activo') : RED('ðŸ”´ Inactivo');
      console.log(`  MicrÃ³fono:   ${micStatus}`);
      console.log(`  Skills:      ${ORANGE(skills.length.toString())} registradas`);
      console.log(`  MCP Servers: ${CYAN(mcpServers.length.toString())} configurados`);
      console.log('');
      client.close();
    } catch (err) {
      console.log(`  ${RED('â— Desconectado')} del agente en ${client.url}`);
      console.log(DIM(`  Detalle: ${(err as Error).message}\n`));
    }
  });

program
  .command('apikeys')
  .description('Mostrar el estado de las claves API configuradas')
  .action(async () => {
    const opts = program.opts();
    const client = new AgentClient({
      wsUrl: opts.wsUrl || getWsUrl(),
      wsToken: opts.token || getWsToken(),
      autoReconnect: false,
    });

    try {
      await client.connect();
      await handleShowApiKey(client);
    } catch (err) {
      console.error(RED(`Error de conexiÃ³n con el agente: ${(err as Error).message}`));
    } finally {
      client.close();
    }
  });

program.parse(process.argv);
