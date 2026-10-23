// ═══════════════════════════════════════════════════════════════
// Cross-Platform Terminal & Stream Encoding Setup
// Compatible with: Windows CMD (CP850/437/1252/65001), PowerShell,
// Linux terminal (xterm/kitty/gnome), and Bash (MSYS2/Git Bash/WSL).
// ═══════════════════════════════════════════════════════════════
if (process.stdin.setEncoding) {
  process.stdin.setEncoding('utf-8');
}
if (process.stdout.setDefaultEncoding) {
  process.stdout.setDefaultEncoding('utf-8');
}
if (process.stderr.setDefaultEncoding) {
  process.stderr.setDefaultEncoding('utf-8');
}

// On Windows, force console code page to 65001 (UTF-8)
if (process.platform === 'win32') {
  try {
    const { execSync } = require('child_process');
    execSync('chcp 65001 >nul 2>&1', { stdio: 'ignore' });
  } catch {
    // Silently continue if chcp is unavailable
  }
}

import fs from 'node:fs';
import { Command } from 'commander';
import { HelixRepl } from './ui/repl';
import { getWsUrl, getWsToken } from './config/env';
import { AgentClient } from './client/agent-client';
import type { HelixSettings } from './client/types';
import { handleShowApiKey } from './commands/apikey';
import { ORANGE, CYAN, GREEN, RED, BOLD, DIM } from './ui/colors';
import { getAsciiLogo } from './ui/banner';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }
  return new Promise((resolve) => {
    let input = '';
    const onData = (chunk: Buffer | string) => {
      input += chunk.toString();
    };
    process.stdin.on('data', onData);
    process.stdin.once('end', () => {
      cleanup();
      if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);
      resolve(input.trim());
    });
    process.stdin.once('error', () => {
      cleanup();
      resolve('');
    });
    // If no data arrives and stream is not ended within 300ms, abort to prevent hanging
    const timer = setTimeout(() => {
      cleanup();
      if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);
      resolve(input.trim());
    }, 300);

    function cleanup() {
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
    }
    process.stdin.resume();
  });
}

const program = new Command();

program
  .name('helix')
  .description('HELIX - Interactive Terminal CLI for Windows AI Desktop Agent')
  .version('0.2.14')
  .option('-u, --ws-url <url>', 'URL del servidor WebSocket del agente', getWsUrl())
  .option('-t, --token <token>', 'Token de autenticación WebSocket de HELIX', getWsToken())
  .option('--plain', 'Desactivar formato enriquecido de Markdown y mostrar texto plano sin asteriscos')
  .action(async (options) => {
    // Default action: start interactive chat REPL
    const repl = new HelixRepl({
      wsUrl: options.wsUrl || getWsUrl(),
      wsToken: options.token || getWsToken(),
      plain: Boolean(options.plain),
    });
    await repl.start();
  });

program
  .command('chat')
  .description('Iniciar sesión de chat interactivo con HELIX')
  .action(async () => {
    const opts = program.opts();
    const repl = new HelixRepl({
      wsUrl: opts.wsUrl || getWsUrl(),
      wsToken: opts.token || getWsToken(),
      plain: Boolean(opts.plain),
    });
    await repl.start();
  });

program
  .command('run [prompt...]')
  .description('Ejecutar un prompt directamente y esperar la respuesta (soporta pipes: cat file | helix run)')
  .action(async (promptParts: string[]) => {
    let promptText = (promptParts || []).join(' ').trim();
    if (!promptText || promptText === '-') {
      promptText = await readStdin();
    }
    if (!promptText) {
      console.error(RED('Error: Debes proporcionar un prompt como argumento o a través de stdin (ej: echo "hola" | helix run).'));
      process.exit(1);
    }
    const opts = program.opts();
    const client = new AgentClient({
      wsUrl: opts.wsUrl || getWsUrl(),
      wsToken: opts.token || getWsToken(),
      autoReconnect: false,
    });

    console.log(DIM(`Prompt: ${promptText}\n`));
    console.log(CYAN(`Conectando con HELIX en ${client.url}...`));
    try {
      await client.connect();
    } catch (err) {
      console.error(RED(`No se pudo conectar al agente HELIX: ${(err as Error).message}`));
      process.exit(1);
    }

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
      console.log(`  ${GREEN('● Conectado')} al agente en ${client.url}`);

      const [settings, skills, mcpServers] = await Promise.all([
        client.getSettings().catch(() => ({} as HelixSettings)),
        client.getSkills().catch(() => []),
        client.getMcpServers().catch(() => []),
      ]);

      const micStatus = settings.voice_enabled !== false ? GREEN('🟢 Activo') : RED('🔴 Inactivo');
      console.log(`  Micrófono:   ${micStatus}`);
      console.log(`  Skills:      ${ORANGE(skills.length.toString())} registradas`);
      console.log(`  MCP Servers: ${CYAN(mcpServers.length.toString())} configurados`);
      console.log('');
      client.close();
    } catch (err) {
      console.log(`  ${RED('● Desconectado')} del agente en ${client.url}`);
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
      console.error(RED(`Error de conexión con el agente: ${(err as Error).message}`));
    } finally {
      client.close();
    }
  });

program.parse(process.argv);
