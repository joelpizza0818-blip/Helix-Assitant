import readline from 'readline';
import chalk from 'chalk';
import prompts from 'prompts';
import { AgentClient } from '../client/agent-client';
import { Autocompleter } from './autocomplete';
import { renderHeader, BannerStatusOptions } from './banner';
import {
  ORANGE,
  ORANGE_BOLD,
  CYAN,
  CYAN_BOLD,
  GREEN,
  RED,
  RED_BOLD,
  YELLOW,
  YELLOW_BOLD,
  GRAY,
  BOLD,
  DIM,
  highlightMentions,
} from './colors';
import { handleConfigApiKey, handleShowApiKey } from '../commands/apikey';
import { handleCreateSkill, handleListSkills } from '../commands/skills';
import { handleCreateMcp, handleListMcp, handleMcpDefaults } from '../commands/mcp';
import { handleMicrophoneCommand } from '../commands/mic';
import { handleBrowserCommand } from '../commands/browser';
import { handleSubagentsCommand } from '../commands/subagents';
import type { ConfirmationRequest } from '../client/types';
import { formatTerminalMarkdown } from './markdown';
import { handleCapabilities, handleProviders, handleSettings } from '../commands/diagnostics';
import { renderJpegAsAscii } from './browser-ascii';
import { handleModelCommand } from '../commands/model';
import { handleMemoryCommand } from '../commands/memory';

export interface ReplOptions {
  wsUrl: string;
  wsToken?: string;
  plain?: boolean;
}

export class HelixRepl {
  private rl: readline.Interface | null = null;
  private client: AgentClient;
  private autocompleter: Autocompleter;
  private conversationId: string;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private voiceEnabled: boolean = true;
  private isCapturingVoice: boolean = false;
  private currentModel: string | null = null;
  private activeTaskId: string | null = null;
  private activeTasksCount: number = 0;
  private isProcessingPrompt: boolean = false;
  private plain: boolean = false;
  private browserLiveViewEnabled: boolean = false;

  constructor(private options: ReplOptions) {
    this.conversationId = `cli_conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.plain = Boolean(options.plain);
    this.client = new AgentClient({
      wsUrl: options.wsUrl,
      wsToken: options.wsToken,
    });
    this.autocompleter = new Autocompleter(this.client);
  }

  public async start(): Promise<void> {
    this._setupClientEvents();

    try {
      await this.client.connect();
    } catch {
      // Connect in background if agent is still starting
    }

    await this._syncSettings();
    await this.autocompleter.refreshSuggestions();

    // Render persistent initial banner
    this.refreshBanner(true);

    this._startReadline();
  }

  private async _syncSettings(): Promise<void> {
    if (!this.client.connected) return;
    try {
      // CLI mode: disable camera/gesture engine and skip per-tool verification
      // (verification adds 2 extra LLM round-trips per tool call, not needed in CLI context)
      await this.client.saveSettings({
        camera_enabled: false,
        tool_verification_enabled: false,
      }).catch(() => {});
      const settings = await this.client.getSettings();
      if (typeof settings.voice_enabled === 'boolean') {
        this.voiceEnabled = settings.voice_enabled;
      }
      if (typeof settings.default_model === 'string') {
        this.currentModel = settings.default_model;
      }
    } catch {
      // Fallback defaults
    }
  }

  public refreshBanner(clearScreen: boolean = false): void {
    const status: BannerStatusOptions = {
      connected: this.client.connected,
      wsUrl: this.client.url,
      voiceEnabled: this.voiceEnabled,
      isCapturingVoice: this.isCapturingVoice,
      currentModel: this.currentModel,
      activeTasksCount: this.activeTasksCount,
    };
    renderHeader(status, clearScreen);
  }

  private waitingLogged: boolean = false;

  private _setupClientEvents(): void {
    this.client.on('connected', async () => {
      this.waitingLogged = false;
      await this._syncSettings();
      await this.autocompleter.refreshSuggestions();
      process.stdout.write(`\r\x1b[K${chalk.green('â—')} ${chalk.greenBright.bold('Conectado al agente HELIX')}  \n`);
      this._promptUser();
    });

    this.client.on('disconnected', () => {
      if (this.client.isStarting) {
        return; // Do not interrupt or print disconnect loops while agent is booting
      }
      if (!this.waitingLogged) {
        this.waitingLogged = true;
        console.log(`\n${RED('â—')} ${chalk.yellowBright('Esperando al servicio del agente HELIX en ws://127.0.0.1:8765...')}`);
        console.log(`${GRAY('  (Si no responde tras 3 reintentos, el CLI lo iniciarÃ¡ automÃ¡ticamente en segundo plano)')}\n`);
      }
      this._promptUser();
    });

    this.client.on('auto_spawning_agent', () => {
      process.stdout.write(`\n${CYAN_BOLD('âš™ï¸')} ${chalk.hex('#FF9F1C').bold('[AUTO-START]:')} Iniciando el servicio del agente HELIX en segundo plano...\n`);
      process.stdout.write(`${GRAY('  Por favor espere mientras termina de inicializarse (no se realizarÃ¡n reintentos hasta que estÃ© listo).')}\n`);
    });

    this.client.on('agent_starting_progress', (data: { elapsedSec: number }) => {
      process.stdout.write(`\r  ${chalk.hex('#FF9F1C')('â³')} ${chalk.gray(`Inicializando subsistemas de HELIX en segundo plano... (${data.elapsedSec}s)`)}`);
    });

    this.client.on('agent_ready', () => {
      process.stdout.write(`\r\x1b[K  ${chalk.green('âœ”')} ${chalk.greenBright('Servicio de HELIX listo. Conectando...')}\n\n`);
    });

    this.client.on('agent_start_failed', (data: { error?: string }) => {
      process.stdout.write(`\r\x1b[K\n  ${chalk.red('âœ–')} ${chalk.redBright('No se pudo iniciar el servicio automÃ¡ticamente:')} ${chalk.gray(data?.error || 'Tiempo agotado')}\n`);
      this._promptUser();
    });

    // Voice Capture indicator
    this.client.on('voice_capture_started', () => {
      this.isCapturingVoice = true;
      process.stdout.write(`\n${chalk.bgRed.white.bold(' ðŸŽ™ï¸   [VOZ DETECTADA - HEY HELIX]: Capturando audio... ')}\n`);
    });

    this.client.on('voice_capture_stopped', () => {
      this.isCapturingVoice = false;
      process.stdout.write(`\n${chalk.bgCyan.black.bold(' ðŸ”Š [AUDIO RECIBIDO]: Procesando voz... ')}\n`);
      this._promptUser();
    });

    // ReAct Step Progress
    this.client.on('react_step', (step: { iteration?: number; role?: string }) => {
      const iter = step?.iteration ?? 1;
      const role = step?.role ? chalk.gray(` (${step.role})`) : '';
      process.stdout.write(`\r  ${chalk.hex('#FF9F1C')('â—†')} ${chalk.gray(`Paso ${iter}${role} â€” Razonando...`)}`);
    });

    // Agent assistant message
    this.client.on('agent_message', (payload: { role?: string; content?: string; model?: string; provider?: string }) => {
      this.isProcessingPrompt = false;
      this.activeTaskId = null;
      if (this.activeTasksCount > 0) this.activeTasksCount--;

      const content = payload?.content ?? '';
      const modelBadge = payload?.model
        ? chalk.gray(` [${payload.model}]`)
        : '';

      // Clear any in-progress step line
      process.stdout.write('\r\x1b[K');

      // Branded header
      console.log('');
      console.log(`  ${chalk.hex('#FF8C00').bold('â¬¡ HELIX')}${modelBadge}`);

      // Content with subtle left border and clean Markdown formatting
      const formatted = formatTerminalMarkdown(content, this.plain);
      const contentLines = formatted.trim().split('\n');
      for (const line of contentLines) {
        console.log(`  ${chalk.gray('â”‚')} ${line}`);
      }
      console.log('');

      this.conversationHistory.push({ role: 'assistant', content });
      this._promptUser();
    });

    // Confirmation request from agent
    this.client.on('confirmation_request', async (req: ConfirmationRequest) => {
      await this._handleConfirmationDialog(req);
    });

    // Task updates
    this.client.on('task_update', (task: { task_id?: string; status?: string; prompt?: string }) => {
      if (task.status === 'RUNNING') {
        this.activeTaskId = task.task_id || null;
      }
    });

    this.client.on('browser_frame', (payload: {
      conversation_id?: string;
      mime_type?: string;
      image_base64?: string;
    }) => {
      if (
        !this.browserLiveViewEnabled
        || !payload?.conversation_id?.startsWith('cli_')
        || payload.mime_type !== 'image/jpeg'
        || typeof payload.image_base64 !== 'string'
      ) {
        return;
      }
      try {
        process.stdout.write('\r\x1b[K');
        console.log(`\n${CYAN_BOLD('  HELIX LIVE BROWSER')}`);
        console.log(renderJpegAsAscii(payload.image_base64));
        this._promptUser();
      } catch (error) {
        console.log(RED(`  No se pudo representar el cuadro del navegador: ${(error as Error).message}`));
      }
    });
  }

  private async _handleConfirmationDialog(req: ConfirmationRequest): Promise<void> {
    console.log(`\n${YELLOW_BOLD('âš ï¸   CONFIRMACIÃ“N DE ACCIÃ“N REQUERIDA')}`);
    console.log(`  AcciÃ³n:      ${chalk.white.bold(req.action || req.tool || 'AcciÃ³n del sistema')}`);
    if (req.description) {
      console.log(`  DescripciÃ³n: ${DIM(req.description)}`);
    }
    if (req.arguments && Object.keys(req.arguments).length > 0) {
      console.log(`  ParÃ¡metros:  ${GRAY(JSON.stringify(req.arguments))}`);
    }

    this.rl?.pause();
    try {
      const answer = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: 'Â¿Permitir al agente ejecutar esta acciÃ³n?',
        initial: true,
      });

      const reqId = req.request_id || req.id || '';
      if (answer && answer.confirmed) {
        this.client.confirmAction(reqId);
        console.log(GREEN('  âœ” AcciÃ³n confirmada.\n'));
      } else {
        this.client.rejectAction(reqId);
        console.log(RED('  âœ– AcciÃ³n rechazada.\n'));
      }
    } finally {
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        try {
          process.stdin.setRawMode(false);
        } catch {}
      }
      this.rl?.resume();
      this._promptUser();
    }
  }

  private _startReadline(): void {
    if (process.stdin.setEncoding) {
      process.stdin.setEncoding('utf-8');
    }
    const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: (line: string) => this.autocompleter.completer(line),
      terminal: isInteractive,
    });

    this.rl = rl;

    rl.on('line', async (line: string) => {
      await this._handleInputLine(line.trim());
    });

    rl.on('close', () => {
      console.log(DIM('\nCerrando sesiÃ³n de HELIX CLI...'));
      this.client.close();
      process.exit(0);
    });

    // Ctrl+C handling: Cancel active task if running, or exit
    rl.on('SIGINT', () => {
      if (this.isProcessingPrompt && this.activeTaskId) {
        console.log(YELLOW('\n[!] Cancelando tarea activa...'));
        this.client.cancelTask(this.activeTaskId);
        this.isProcessingPrompt = false;
        this.activeTaskId = null;
        this._promptUser();
      } else {
        console.log(DIM('\nÂ¡Hasta pronto!'));
        this.client.close();
        process.exit(0);
      }
    });

    this._promptUser();
  }

  private _promptUser(): void {
    if (!this.rl) return;
    const promptPrefix = `  ${chalk.hex('#FF8C00').bold('helix')} ${chalk.gray('â¯')} `;
    this.rl.setPrompt(promptPrefix);
    this.rl.prompt();
  }

  private async _handleInputLine(line: string): Promise<void> {
    if (!line) {
      this._promptUser();
      return;
    }

    if (this.client.isStarting) {
      console.log(`\n  ${chalk.yellow('âš ï¸')}  ${chalk.yellowBright('El servicio de HELIX se estÃ¡ iniciando en segundo plano. Espera a que termine antes de enviar comandos o reintentar.')}\n`);
      this._promptUser();
      return;
    }

    // --- Slash commands handling ---
    if (line.startsWith('/')) {
      const parts = line.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = line.slice(cmd.length).trim();

      switch (cmd) {
        case '/help':
          this.autocompleter.renderHelp();
          break;

        case '/clear':
          this.refreshBanner(true);
          break;

        case '/config-apikey':
          this.rl?.pause();
          try {
            await handleConfigApiKey(this.client);
          } finally {
            if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
              try { process.stdin.setRawMode(false); } catch {}
            }
            this.rl?.resume();
          }
          break;

        case '/show-apikey':
          await handleShowApiKey(this.client);
          break;

        case '/skill':
          await handleListSkills(this.client, args || undefined);
          break;

        case '/create-skill':
          this.rl?.pause();
          try {
            await handleCreateSkill(this.client);
            await this.autocompleter.refreshSuggestions();
          } finally {
            if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
              try { process.stdin.setRawMode(false); } catch {}
            }
            this.rl?.resume();
          }
          break;

        case '/mcp':
          if (args?.trim().toLowerCase() === 'defaults') handleMcpDefaults();
          else await handleListMcp(this.client);
          break;

        case '/create-mcp':
          this.rl?.pause();
          try {
            await handleCreateMcp(this.client);
            await this.autocompleter.refreshSuggestions();
          } finally {
            if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
              try { process.stdin.setRawMode(false); } catch {}
            }
            this.rl?.resume();
          }
          break;

        case '/microphone': {
          const newState = await handleMicrophoneCommand(this.client, args, this.voiceEnabled);
          this.voiceEnabled = newState;
          break;
        }

        case '/browser': {
          const browserArgs = args.trim().split(/\s+/);
          if (browserArgs[0]?.toLowerCase() === 'live') {
            const requestedState = browserArgs[1]?.toLowerCase();
            if (requestedState && !['on', 'off'].includes(requestedState)) {
              console.log(YELLOW('  Uso: /browser live [on|off]\n'));
              break;
            }
            this.browserLiveViewEnabled = requestedState
              ? requestedState === 'on'
              : !this.browserLiveViewEnabled;
            console.log(
              this.browserLiveViewEnabled
                ? GREEN('  Vista ASCII del navegador activada.\n')
                : YELLOW('  Vista ASCII del navegador desactivada.\n'),
            );
            break;
          }
          await handleBrowserCommand(this.client, args);
          break;
        }

        case '/subagents':
          await handleSubagentsCommand(this.client, args);
          break;

        case '/tasks':
          await this._handleListTasks();
          break;

        case '/model':
          await handleModelCommand(this.client, args);
          break;

        case '/models':
          await this._handleListModels();
          break;

        case '/memory':
          await handleMemoryCommand(this.client, args);
          break;

        case '/status':
          await this._handleStatus();
          break;

        case '/providers':
          await handleProviders(this.client);
          break;

        case '/capabilities':
          await handleCapabilities(this.client);
          break;

        case '/settings':
          await handleSettings(this.client);
          break;

        case '/stop':
          console.log(RED_BOLD('\n[PARADA DE EMERGENCIA]: Cancelando todas las tareas activas...'));
          this.client.emergencyStop();
          this.isProcessingPrompt = false;
          this.activeTaskId = null;
          console.log(GREEN('âœ” Todas las tareas han sido detenidas.\n'));
          break;

        case '/exit':
        case '/quit':
          this.client.close();
          process.exit(0);
          break;

        default:
          console.log(YELLOW(`Comando desconocido: "${cmd}". Escribe /help para ver la lista de comandos.`));
          break;
      }

      this._promptUser();
      return;
    }

    // --- Direct chat message / @skill / #mcp ---
    if (!this.client.connected) {
      console.log(YELLOW('âš  El agente no estÃ¡ conectado actualmente. Intentando enviar de todos modos...'));
    }

    // Highlight skills in strong orange (#FF8C00) and mcps in cyan
    const knownSkills = this.autocompleter.getSkills();
    const formattedEcho = highlightMentions(line, knownSkills);

    // Record user message in history
    this.conversationHistory.push({ role: 'user', content: line });
    this.isProcessingPrompt = true;
    this.activeTasksCount++;

    process.stdout.write(`  ${chalk.gray('â†’')} ${formattedEcho}\n`);
    process.stdout.write(`  ${chalk.hex('#FF9F1C')('â—†')} ${chalk.gray('Procesando...')}`);

    const sent = this.client.sendUserText(
      line,
      this.conversationId,
      this.conversationHistory.slice(-10)
    );

    if (!sent) {
      process.stdout.write('\r\x1b[K');
      console.log(RED('âœ– Error: No se pudo enviar el mensaje (WebSocket desconectado).'));
      this.isProcessingPrompt = false;
      this.activeTasksCount = Math.max(0, this.activeTasksCount - 1);
      this._promptUser();
    }
  }

  private async _handleListTasks(): Promise<void> {
    try {
      const tasks = await this.client.getTasks();
      console.log(`\n${BOLD('ðŸ“‹ Tareas Registradas en HELIX:')}\n`);
      if (!tasks || tasks.length === 0) {
        console.log(GRAY('  No hay tareas recientes registradas.\n'));
        return;
      }

      for (const t of tasks.slice(-10)) {
        let statusBadge = chalk.gray(t.status);
        if (t.status === 'COMPLETED') statusBadge = chalk.green('âœ” Completada');
        if (t.status === 'RUNNING') statusBadge = chalk.yellow('â³ En ejecuciÃ³n');
        if (t.status === 'FAILED') statusBadge = chalk.red('âœ– Fallida');
        if (t.status === 'CANCELLED') statusBadge = chalk.gray('â—‹ Cancelada');

        console.log(`  ${statusBadge} ${DIM(t.task_id)}`);
        if (t.prompt) console.log(`    ${chalk.white(t.prompt)}`);
        console.log('');
      }
    } catch (err) {
      console.log(RED(`  Error al obtener tareas: ${(err as Error).message}\n`));
    }
  }

  private async _handleListModels(): Promise<void> {
    try {
      const models = await this.client.getModels();
      console.log(`\n${BOLD('ðŸ§  Modelos Disponibles en Proveedores Configurados:')}\n`);
      if (!models || models.length === 0) {
        console.log(GRAY('  No hay modelos disponibles. Configura tus API Keys con /config-apikey.\n'));
        return;
      }

      for (const m of models) {
        console.log(`  ${CYAN('â€¢')} ${chalk.bold(m.id)} ${DIM(`[${m.provider}]`)}`);
      }
      console.log('');
    } catch (err) {
      console.log(RED(`  Error al obtener modelos: ${(err as Error).message}\n`));
    }
  }

  private async _handleStatus(): Promise<void> {
    console.log('');
    console.log(`  ${chalk.hex('#FF8C00').bold('â¬¡ Estado del Sistema')}`);
    console.log(`  ${chalk.gray('â”€'.repeat(40))}`);
    console.log(`  ${chalk.gray('Agente WS')}     ${this.client.connected ? chalk.green('â— Conectado') : chalk.red('â— Desconectado')} ${chalk.gray(this.client.url)}`);
    console.log(`  ${chalk.gray('MicrÃ³fono')}     ${this.voiceEnabled ? chalk.green('â— Activo') + chalk.gray(' (hey helix)') : chalk.red('â— Inactivo')}`);
    console.log(`  ${chalk.gray('ConversaciÃ³n')}  ${chalk.gray(this.conversationId)} ${chalk.gray(`(${this.conversationHistory.length} msgs)`)}`);
    console.log(`  ${chalk.gray('Skills')}        ${chalk.hex('#FF8C00').bold(this.autocompleter.getSkills().length.toString())} registradas`);
    console.log(`  ${chalk.gray('MCP Tools')}     ${chalk.cyan.bold(this.autocompleter.getMcpTools().length.toString())} disponibles`);
    console.log('');
  }
}
