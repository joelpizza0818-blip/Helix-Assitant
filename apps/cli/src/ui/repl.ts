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
import { getUserFacingError } from './userError';
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
  private activeVoiceSessionId: string | null = null;
  private activeVoiceConfirmationId: string | null = null;

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
      process.stdout.write(`\r\x1b[K${chalk.green('●')} ${chalk.greenBright.bold('Conectado al agente HELIX')}  \n`);
      this._promptUser();
    });

    this.client.on('disconnected', () => {
      if (this.client.isStarting) {
        return; // Do not interrupt or print disconnect loops while agent is booting
      }
      if (!this.waitingLogged) {
        this.waitingLogged = true;
        console.log(`\n${RED('●')} ${chalk.yellowBright('Esperando al servicio del agente HELIX en ws://127.0.0.1:8765...')}`);
        console.log(`${GRAY('  (Si no responde tras 3 reintentos, el CLI lo iniciará automáticamente en segundo plano)')}\n`);
      }
      this._promptUser();
    });

    this.client.on('auto_spawning_agent', () => {
      process.stdout.write(`\n${CYAN_BOLD('⚙️')} ${chalk.hex('#FF9F1C').bold('[AUTO-START]:')} Iniciando el servicio del agente HELIX en segundo plano...\n`);
      process.stdout.write(`${GRAY('  Por favor espere mientras termina de inicializarse (no se realizarán reintentos hasta que esté listo).')}\n`);
    });

    this.client.on('agent_starting_progress', (data: { elapsedSec: number }) => {
      process.stdout.write(`\r  ${chalk.hex('#FF9F1C')('⏳')} ${chalk.gray(`Inicializando subsistemas de HELIX en segundo plano... (${data.elapsedSec}s)`)}`);
    });

    this.client.on('agent_ready', () => {
      process.stdout.write(`\r\x1b[K  ${chalk.green('✔')} ${chalk.greenBright('Servicio de HELIX listo. Conectando...')}\n\n`);
    });

    this.client.on('agent_start_failed', (data: { error?: string }) => {
      process.stdout.write(`\r\x1b[K\n  ${chalk.red('✖')} ${chalk.redBright(getUserFacingError(
        data?.error,
        'No se pudo iniciar el agente local. Abre HELIX Desktop y vuelve a intentarlo.',
      ))}\n`);
      this._promptUser();
    });

    // Voice Capture indicator
    this.client.on('voice_capture_started', () => {
      this.isCapturingVoice = true;
      process.stdout.write(`\n${chalk.bgRed.white.bold(' 🎙️   [VOZ DETECTADA - HEY HELIX]: Capturando audio... ')}\n`);
    });

    this.client.on('voice_capture_stopped', () => {
      this.isCapturingVoice = false;
      process.stdout.write(`\n${chalk.bgCyan.black.bold(' 🔊 [AUDIO RECIBIDO]: Procesando voz... ')}\n`);
      this._promptUser();
    });

    // Live Voice session events
    this.client.on('VOICE_STATE', (payload: { state?: string }) => {
      if (payload?.state) {
        process.stdout.write(`\r  ${chalk.hex('#FF9F1C')('◉')} ${chalk.gray(`[Helix Live Voice: ${payload.state}]`)} `);
      }
    });

    this.client.on('VOICE_TRANSCRIPT', (payload: { text?: string; final?: boolean }) => {
      if (payload?.text && payload.final) {
        process.stdout.write(`\r\x1b[K  ${chalk.hex('#FFB300')('🗣️  Tú:')} "${payload.text}"\n`);
      }
    });

    this.client.on('VOICE_ASSISTANT_TEXT', (payload: { speech_text?: string; had_code?: boolean }) => {
      if (payload?.speech_text) {
        process.stdout.write(`\r\x1b[K  ${chalk.hex('#FF8C00').bold('⬡ Helix:')} ${payload.speech_text}\n`);
      }
    });

    this.client.on('VOICE_CONFIRMATION_REQUEST', (payload: { request_id?: string; speech_text?: string; action?: string }) => {
      this.activeVoiceConfirmationId = payload?.request_id || null;
      process.stdout.write(`\r\x1b[K\n  ${chalk.yellowBright.bold('⚠️  CONFIRMACIÓN REQUERIDA:')} ${payload?.speech_text || payload?.action}\n  ${chalk.gray('(Responde "sí", "dale" o "cancela" aquí, o habla por voz. Nunca se aprueba por silencio)')}\n`);
    });

    this.client.on('VOICE_CONFIRMATION_RESOLVED', () => {
      this.activeVoiceConfirmationId = null;
    });

    this.client.on('VOICE_SESSION_CLOSED', () => {
      this.activeVoiceSessionId = null;
      this.activeVoiceConfirmationId = null;
    });

    this.client.on('VOICE_ERROR', (payload: { message?: string; code?: string }) => {
      process.stdout.write(`\r\x1b[K  ${chalk.red('✖')} ${payload?.message || 'Error en la sesión de voz.'}\n`);
      if (payload?.code === 'SERVER_AUDIO_FAILED') {
        process.stdout.write(chalk.gray('  La captura del host requiere el paquete opcional sounddevice.\n'));
      }
    });

    // ReAct Step Progress
    this.client.on('react_step', (step: { iteration?: number; role?: string }) => {
      const iter = step?.iteration ?? 1;
      const role = step?.role ? chalk.gray(` (${step.role})`) : '';
      process.stdout.write(`\r  ${chalk.hex('#FF9F1C')('◆')} ${chalk.gray(`Paso ${iter}${role} — Razonando...`)}`);
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
      console.log(`  ${chalk.hex('#FF8C00').bold('⬡ HELIX')}${modelBadge}`);

      // Content with subtle left border and clean Markdown formatting
      const formatted = formatTerminalMarkdown(content, this.plain);
      const contentLines = formatted.trim().split('\n');
      for (const line of contentLines) {
        console.log(`  ${chalk.gray('│')} ${line}`);
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
        console.log(RED(`  ${getUserFacingError(
          error,
          'No se pudo mostrar la vista del navegador. Cierra y vuelve a abrir la sesión.',
        )}`));
      }
    });
  }

  private async _handleConfirmationDialog(req: ConfirmationRequest): Promise<void> {
    console.log(`\n${YELLOW_BOLD('⚠️   CONFIRMACIÓN DE ACCIÓN REQUERIDA')}`);
    console.log(`  Acción:      ${chalk.white.bold(req.action || req.tool || 'Acción del sistema')}`);
    if (req.description) {
      console.log(`  Descripción: ${DIM(req.description)}`);
    }
    if (req.arguments && Object.keys(req.arguments).length > 0) {
      console.log(`  Parámetros:  ${GRAY(JSON.stringify(req.arguments))}`);
    }

    this.rl?.pause();
    try {
      const answer = await prompts({
        type: 'confirm',
        name: 'confirmed',
        message: '¿Permitir al agente ejecutar esta acción?',
        initial: true,
      });

      const reqId = req.request_id || req.id || '';
      if (answer && answer.confirmed) {
        this.client.confirmAction(reqId);
        console.log(GREEN('  ✔ Acción confirmada.\n'));
      } else {
        this.client.rejectAction(reqId);
        console.log(RED('  ✖ Acción rechazada.\n'));
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
      console.log(DIM('\nCerrando sesión de HELIX CLI...'));
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
        console.log(DIM('\n¡Hasta pronto!'));
        this.client.close();
        process.exit(0);
      }
    });

    this._promptUser();
  }

  private _promptUser(): void {
    if (!this.rl) return;
    const promptPrefix = `  ${chalk.hex('#FF8C00').bold('helix')} ${chalk.gray('❯')} `;
    this.rl.setPrompt(promptPrefix);
    this.rl.prompt();
  }

  private async _handleInputLine(line: string): Promise<void> {
    if (!line) {
      this._promptUser();
      return;
    }

    if (this.client.isStarting) {
      console.log(`\n  ${chalk.yellow('⚠️')}  ${chalk.yellowBright('El servicio de HELIX se está iniciando en segundo plano. Espera a que termine antes de enviar comandos o reintentar.')}\n`);
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

        case '/live':
        case '/live-voice': {
          const action = args.trim().toLowerCase();
          if (action === 'stop' || action === 'off' || action === 'end') {
            if (this.activeVoiceSessionId) {
              this.client.send('VOICE_SESSION_STOP', { session_id: this.activeVoiceSessionId });
              this.activeVoiceSessionId = null;
            }
            this.activeVoiceConfirmationId = null;
            console.log(YELLOW('  Helix Live Voice finalizado.\n'));
          } else {
            const sid = `cli_voice_${Date.now()}`;
            this.activeVoiceSessionId = sid;
            this.activeVoiceConfirmationId = null;
            console.log(ORANGE_BOLD('\n  Iniciando Helix Live Voice ($0 local)...'));
            console.log(GRAY('  Captura de audio activa en el host. Habla con naturalidad.'));
            console.log(DIM('  (Usa "/live stop" para finalizar la llamada)\n'));
            this.client.send('VOICE_SESSION_START', {
              session_id: sid,
              mode: 'live',
              server_audio: true,
              language: 'es',
              tts_enabled: true,
              silence_ms: 700,
            });
          }
          break;
        }

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
          console.log(GREEN('✔ Todas las tareas han sido detenidas.\n'));
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

    // --- Typed answers to a pending voice confirmation ---
    if (this.activeVoiceConfirmationId && this.activeVoiceSessionId) {
      process.stdout.write(`  ${chalk.gray('→')} ${highlightMentions(line, this.autocompleter.getSkills())}\n`);
      const sent = this.client.send('VOICE_CONFIRMATION_TEXT', {
        session_id: this.activeVoiceSessionId,
        request_id: this.activeVoiceConfirmationId,
        text: line,
      });
      if (!sent) {
        console.log(RED('✖ No se pudo enviar la confirmación (WebSocket desconectado).'));
      }
      this._promptUser();
      return;
    }

    // --- Direct chat message / @skill / #mcp ---
    if (!this.client.connected) {
      console.log(YELLOW('⚠ El agente no está conectado actualmente. Intentando enviar de todos modos...'));
    }

    // Highlight skills in strong orange (#FF8C00) and mcps in cyan
    const knownSkills = this.autocompleter.getSkills();
    const formattedEcho = highlightMentions(line, knownSkills);

    // Record user message in history
    this.conversationHistory.push({ role: 'user', content: line });
    this.isProcessingPrompt = true;
    this.activeTasksCount++;

    process.stdout.write(`  ${chalk.gray('→')} ${formattedEcho}\n`);
    process.stdout.write(`  ${chalk.hex('#FF9F1C')('◆')} ${chalk.gray('Procesando...')}`);

    const sent = this.client.sendUserText(
      line,
      this.conversationId,
      this.conversationHistory.slice(-10)
    );

    if (!sent) {
      process.stdout.write('\r\x1b[K');
      console.log(RED('✖ Error: No se pudo enviar el mensaje (WebSocket desconectado).'));
      this.isProcessingPrompt = false;
      this.activeTasksCount = Math.max(0, this.activeTasksCount - 1);
      this._promptUser();
    }
  }

  private async _handleListTasks(): Promise<void> {
    try {
      const tasks = await this.client.getTasks();
      console.log(`\n${BOLD('📋 Tareas Registradas en HELIX:')}\n`);
      if (!tasks || tasks.length === 0) {
        console.log(GRAY('  No hay tareas recientes registradas.\n'));
        return;
      }

      for (const t of tasks.slice(-10)) {
        let statusBadge = chalk.gray(t.status);
        if (t.status === 'COMPLETED') statusBadge = chalk.green('✔ Completada');
        if (t.status === 'RUNNING') statusBadge = chalk.yellow('⏳ En ejecución');
        if (t.status === 'FAILED') statusBadge = chalk.red('✖ Fallida');
        if (t.status === 'CANCELLED') statusBadge = chalk.gray('○ Cancelada');

        console.log(`  ${statusBadge} ${DIM(t.task_id)}`);
        if (t.prompt) console.log(`    ${chalk.white(t.prompt)}`);
        console.log('');
      }
    } catch (err) {
      console.log(RED(`  ${getUserFacingError(err, 'No se pudieron cargar las tareas. Comprueba que HELIX esté conectado e inténtalo de nuevo.')}\n`));
    }
  }

  private async _handleListModels(): Promise<void> {
    try {
      const models = await this.client.getModels();
      console.log(`\n${BOLD('🧠 Modelos Disponibles en Proveedores Configurados:')}\n`);
      if (!models || models.length === 0) {
        console.log(GRAY('  No hay modelos disponibles. Configura tus API Keys con /config-apikey.\n'));
        return;
      }

      for (const m of models) {
        console.log(`  ${CYAN('•')} ${chalk.bold(m.id)} ${DIM(`[${m.provider}]`)}`);
      }
      console.log('');
    } catch (err) {
      console.log(RED(`  ${getUserFacingError(err, 'No se pudieron cargar los modelos. Comprueba la conexión e inténtalo de nuevo.')}\n`));
    }
  }

  private async _handleStatus(): Promise<void> {
    console.log('');
    console.log(`  ${chalk.hex('#FF8C00').bold('⬡ Estado del Sistema')}`);
    console.log(`  ${chalk.gray('─'.repeat(40))}`);
    console.log(`  ${chalk.gray('Agente WS')}     ${this.client.connected ? chalk.green('● Conectado') : chalk.red('● Desconectado')} ${chalk.gray(this.client.url)}`);
    console.log(`  ${chalk.gray('Micrófono')}     ${this.voiceEnabled ? chalk.green('● Activo') + chalk.gray(' (hey helix)') : chalk.red('● Inactivo')}`);
    console.log(`  ${chalk.gray('Conversación')}  ${chalk.gray(this.conversationId)} ${chalk.gray(`(${this.conversationHistory.length} msgs)`)}`);
    console.log(`  ${chalk.gray('Skills')}        ${chalk.hex('#FF8C00').bold(this.autocompleter.getSkills().length.toString())} registradas`);
    console.log(`  ${chalk.gray('MCP Tools')}     ${chalk.cyan.bold(this.autocompleter.getMcpTools().length.toString())} disponibles`);
    console.log('');
  }
}
