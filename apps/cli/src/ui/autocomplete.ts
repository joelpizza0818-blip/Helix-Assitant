mport chalk from 'chalk';
import type { AgentClient } from '../client/agent-client';
import { formatSkill, formatMcp, ORANGE, CYAN, MAGENTA, DIM } from './colors';

export interface CommandDefinition {
  command: string;
  description: string;
  usage?: string;
}

export const SLASH_COMMANDS: CommandDefinition[] = [
  { command: '/create-skill', description: 'Crear una nueva skill interactiva para HELIX' },
  { command: '/skill', description: 'Listar o inspeccionar skills registradas', usage: '/skill [nombre]' },
  { command: '/mcp', description: 'Listar servidores MCP y sus herramientas' },
  { command: '/create-mcp', description: 'Registrar y configurar un nuevo servidor MCP' },
  { command: '/browser', description: 'Ver estado del navegador web o abrir URLs', usage: '/browser [open <url>]' },
  { command: '/config-apikey', description: 'Configurador interactivo de API Keys (OpenAI, Anthropic, Gemini, etc.)' },
  { command: '/show-apikey', description: 'Ver estado y validez de las API Keys configuradas' },
  { command: '/microphone', description: 'Ver o alternar estado del micrÃ³fono', usage: '/microphone [enable|disable]' },
  { command: '/tasks', description: 'Ver tareas activas y recientes del agente' },
  { command: '/models', description: 'Listar modelos disponibles de proveedores configurados' },
  { command: '/status', description: 'Mostrar resumen del estado del sistema' },
  { command: '/clear', description: 'Limpiar pantalla y restaurar el banner de HELIX' },
  { command: '/stop', description: 'Parada de emergencia de todas las tareas activas' },
  { command: '/help', description: 'Mostrar ayuda de comandos y atajos' },
  { command: '/exit', description: 'Salir del CLI' },
];

export class Autocompleter {
  private skills: string[] = [];
  private mcpTools: string[] = [];

  constructor(private client?: AgentClient) {}

  public async refreshSuggestions(): Promise<void> {
    if (!this.client || !this.client.connected) return;
    try {
      const skills = await this.client.getSkills();
      if (skills) {
        this.skills = skills.map((s) => s.name);
      }
    } catch {
      // Ignored if client is offline
    }

    try {
      const servers = await this.client.getMcpServers();
      if (servers) {
        const tools: string[] = [];
        for (const s of servers) {
          tools.push(s.name);
          if (s.tools) {
            for (const t of s.tools) {
              tools.push(`${s.name}_${t.name}`);
            }
          }
        }
        this.mcpTools = tools;
      }
    } catch {
      // Ignored
    }
  }

  public getSkills(): string[] {
    return this.skills;
  }

  public getMcpTools(): string[] {
    return this.mcpTools;
  }

  /**
   * Completer function matching readline specification:
   * (line: string) => [string[], string]
   */
  public completer(line: string): [string[], string] {
    const trimmed = line.trimStart();

    // 1. Skill sub-arguments for /skill <name>
    if (trimmed.startsWith('/skill ')) {
      const arg = trimmed.slice('/skill '.length).toLowerCase();
      const hits = this.skills
        .filter((s) => s.toLowerCase().startsWith(arg))
        .map((s) => `/skill ${s}`);
      return [hits.length ? hits : this.skills.map((s) => `/skill ${s}`), line];
    }

    // 2. Microphone sub-arguments
    if (trimmed.startsWith('/microphone ')) {
      const arg = trimmed.slice('/microphone '.length).toLowerCase();
      const options = ['/microphone enable', '/microphone disable'];
      const hits = options.filter((o) => o.toLowerCase().startsWith(trimmed.toLowerCase()));
      return [hits.length ? hits : options, line];
    }

    // 3. Browser sub-arguments
    if (trimmed.startsWith('/browser ')) {
      const options = ['/browser open https://'];
      return [options, line];
    }

    // 4. Slash command autocompletion
    if (trimmed.startsWith('/')) {
      const hits = SLASH_COMMANDS
        .map((c) => c.command)
        .filter((c) => c.toLowerCase().startsWith(trimmed.toLowerCase()));
      return [hits.length ? hits : SLASH_COMMANDS.map((c) => c.command), line];
    }

    // 5. In-line @skill mention autocompletion
    const lastAtMatch = /(?:^|\s)(@)([a-zA-Z0-9_-]*)$/.exec(line);
    if (lastAtMatch) {
      const prefix = line.slice(0, line.length - lastAtMatch[2].length);
      const query = lastAtMatch[2].toLowerCase();
      const matches = this.skills.filter((s) => s.toLowerCase().startsWith(query));
      const hits = (matches.length ? matches : this.skills).map((s) => `${prefix}${s} `);
      return [hits, line];
    }

    // 6. In-line #mcp mention autocompletion
    const lastHashMatch = /(?:^|\s)(#)([a-zA-Z0-9_-]*)$/.exec(line);
    if (lastHashMatch) {
      const prefix = line.slice(0, line.length - lastHashMatch[2].length);
      const query = lastHashMatch[2].toLowerCase();
      const matches = this.mcpTools.filter((t) => t.toLowerCase().startsWith(query));
      const hits = (matches.length ? matches : this.mcpTools).map((t) => `${prefix}${t} `);
      return [hits, line];
    }

    return [[], line];
  }

  /**
   * Formats the list of commands for display.
   */
  public renderHelp(): void {
    console.log('');
    console.log(`  ${chalk.hex('#FF8C00').bold('â¬¡ Comandos Disponibles')}  ${chalk.gray('(/ + [Tab] para autocompletar)')}`);
    console.log(`  ${chalk.gray('â”€'.repeat(50))}`);
    for (const cmd of SLASH_COMMANDS) {
      const usage = cmd.usage ? `  ${chalk.gray(cmd.usage)}` : '';
      console.log(`  ${chalk.magenta(cmd.command.padEnd(16))} ${chalk.gray(cmd.description)}${usage}`);
    }

    console.log('');
    console.log(`  ${chalk.hex('#FF8C00').bold('â¬¡ Prefijos Especiales')}`);
    console.log(`  ${chalk.gray('â”€'.repeat(50))}`);
    console.log(`  ${formatSkill('nombre')}            ${chalk.gray('Invoca una skill registrada')}`);
    console.log(`  ${formatMcp('herramienta')}       ${chalk.gray('Invoca herramientas MCP')}`);
    console.log('');
  }
}
