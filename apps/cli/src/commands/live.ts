import readline from 'readline';
import chalk from 'chalk';
import { AgentClient } from '../client/agent-client';
import { ORANGE_BOLD, GREEN, RED, YELLOW, GRAY, DIM, BOLD } from '../ui/colors';
import { getUserFacingError } from '../ui/userError';

export interface VoiceCommandOptions {
  mode: 'live' | 'normal';
  wsUrl: string;
  wsToken?: string;
}

type VoicePayload = Record<string, unknown>;

const LEVEL_BARS = '▁▂▃▄▅▆▇█';

function renderLevelBar(level: number): string {
  const clamped = Math.max(0, Math.min(1, level));
  const filled = Math.round(clamped * 12);
  return `${chalk.hex('#FF9F1C')('█'.repeat(filled))}${chalk.gray('░'.repeat(12 - filled))}`;
}

function stateLabel(state: string): string {
  switch (state) {
    case 'LISTENING':
      return chalk.green('◉ ESCUCHANDO');
    case 'PROCESSING':
      return chalk.cyan('◌ TRANSCRIBIENDO');
    case 'THINKING':
      return chalk.hex('#FFB300')('◆ PENSANDO');
    case 'SPEAKING':
      return chalk.hex('#FF8C00')('▶ HABLANDO');
    case 'AWAITING_CONFIRMATION':
      return chalk.yellow('⚠ CONFIRMACIÓN PENDIENTE');
    case 'INTERRUPTED':
      return chalk.magenta('✋ INTERRUMPIDO');
    case 'MUTED':
      return chalk.gray('⊘ SILENCIADO');
    case 'ERROR':
      return chalk.red('✖ ERROR');
    case 'IDLE':
      return chalk.gray('○ EN ESPERA');
    default:
      return chalk.gray(state);
  }
}

export async function runVoiceCommand(options: VoiceCommandOptions): Promise<number> {
  const { mode, wsUrl, wsToken } = options;
  const client = new AgentClient({ wsUrl, wsToken, autoReconnect: false });
  const sessionId = `cli_${mode}_${Date.now()}`;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let currentState = 'INITIALIZING';
  let currentLevel = 0;
  let activeConfirmationId: string | null = null;
  let phase: 'starting' | 'recording' | 'processing' | 'live' | 'finished' =
    mode === 'live' ? 'live' : 'starting';
  let statusDrawn = false;
  let finished = false;

  const clearStatus = () => {
    if (statusDrawn) {
      process.stdout.write('\r\x1b[K');
      statusDrawn = false;
    }
  };

  const drawStatus = () => {
    if (finished) return;
    process.stdout.write(
      `\r\x1b[K  ${stateLabel(currentState)}  ${renderLevelBar(currentLevel)}  ${GRAY('nivel local')}`
    );
    statusDrawn = true;
  };

  const log = (message: string) => {
    clearStatus();
    console.log(message);
    if (phase === 'live' || phase === 'recording') drawStatus();
  };

  let resolveFinish: () => void = () => {};
  let exitCode = 0;
  const completion = new Promise<number>((resolve) => {
    resolveFinish = () => resolve(exitCode);
  });

  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    phase = 'finished';
    exitCode = code;
    clearStatus();
    if (sessionId) {
      client.send('VOICE_SESSION_STOP', { session_id: sessionId });
    }
    rl.close();
    client.close();
    setTimeout(() => resolveFinish(), 120);
  };

  const sendConfirmationText = (text: string) => {
    client.send('VOICE_CONFIRMATION_TEXT', {
      session_id: sessionId,
      request_id: activeConfirmationId,
      text,
    });
  };

  client.on('VOICE_STATE', (payload: VoicePayload) => {
    if (typeof payload?.state === 'string') {
      currentState = payload.state;
      if (payload.state === 'IDLE' && mode === 'normal' && phase === 'processing') {
        // The normal turn is complete: transcript and reply were already shown.
        setTimeout(() => finish(0), 60);
        return;
      }
      drawStatus();
    }
  });

  client.on('VOICE_SESSION_READY', () => {
    clearStatus();
    console.log(`${GREEN('✔')} ${BOLD('Helix Voice listo')} ${GRAY('· STT/TTS locales, sin nube, coste $0')}`);
    if (mode === 'normal') {
      phase = 'recording';
      client.send('VOICE_RECORDING_START', { session_id: sessionId });
      console.log(`${YELLOW('● Grabando')} ${GRAY('Habla ahora. Pulsa Enter para terminar la grabación.')}`);
    } else {
      console.log(`${GRAY('Habla con naturalidad. Puedes interrumpir a Helix en cualquier momento.')}`);
    }
    console.log(DIM('  Ctrl+C para finalizar la llamada.\n'));
    rl.setPrompt(chalk.hex('#FF8C00')('voz ❯ '));
    rl.prompt();
  });

  client.on('VOICE_TRANSCRIPT', (payload: VoicePayload) => {
    if (payload?.final && payload?.text) {
      clearStatus();
      console.log(`  ${chalk.hex('#FFB300')('🗣️  Tú:')} "${String(payload.text)}"`);
    }
  });

  client.on('VOICE_ASSISTANT_TEXT', (payload: VoicePayload) => {
    const speech = String(payload?.speech_text || payload?.text || '').trim();
    if (!speech) return;
    log(`  ${chalk.hex('#FF8C00').bold('⬡ Helix:')} ${speech}`);
    if (payload?.had_code) {
      log(`  ${GRAY('El código y los detalles completos están en pantalla; no se leen en voz alta.')}`);
    }
  });

  client.on('VOICE_CONFIRMATION_REQUEST', (payload: VoicePayload) => {
    activeConfirmationId =
      typeof payload?.request_id === 'string' ? payload.request_id : null;
    clearStatus();
    console.log(`\n  ${chalk.yellowBright.bold('⚠️  CONFIRMACIÓN REQUERIDA')}`);
    console.log(`  ${String(payload?.speech_text || payload?.what_will_change || payload?.action || 'Acción pendiente')}`);
    console.log(`  ${GRAY('Responde "sí", "dale", "cancela" o describe un cambio. También puedes hablar por el micrófono.')}\n`);
    rl.prompt();
  });

  client.on('VOICE_CONFIRMATION_RESOLVED', () => {
    activeConfirmationId = null;
  });

  client.on('VOICE_LEVEL', (payload: VoicePayload) => {
    if (phase === 'finished') return;
    if (typeof payload?.level === 'number') {
      currentLevel = payload.level;
      drawStatus();
    }
  });

  client.on('VOICE_ERROR', (payload: VoicePayload) => {
    const message = String(payload?.message || 'Error en la sesión de voz.');
    const code = String(payload?.code || '');
    clearStatus();
    console.error(`${RED('✖')} ${message}`);
    if (code === 'SERVER_AUDIO_FAILED') {
      console.error(DIM('  La captura local del host requiere el paquete opcional "sounddevice":'));
      console.error(DIM('  .venv\\Scripts\\python.exe -m pip install sounddevice'));
      finish(1);
    } else if (payload?.recoverable === false) {
      finish(1);
    } else {
      if (phase === 'live') drawStatus();
    }
  });

  client.on('VOICE_SESSION_CLOSED', () => {
    if (!finished) {
      log(GRAY('Sesión de voz finalizada.'));
      finish(0);
    }
  });

  client.on('disconnected', () => {
    if (!finished) {
      clearStatus();
      console.error(RED('✖ Se perdió la conexión con HELIX.'));
      finish(1);
    }
  });

  rl.on('line', (line: string) => {
    const text = line.trim();
    if (!text) {
      if (mode === 'normal' && phase === 'recording') {
        phase = 'processing';
        client.send('VOICE_RECORDING_STOP', { session_id: sessionId });
        console.log(GRAY('  Procesando tu grabación...'));
      } else {
        rl.prompt();
      }
      return;
    }

    if (mode === 'live' && text.toLowerCase() === '/interrumpir') {
      client.send('VOICE_INTERRUPT', { session_id: sessionId });
      clearStatus();
      console.log(GRAY('  Helix se detuvo. Puedes hablar ahora.'));
      rl.prompt();
      return;
    }

    if (mode === 'normal' && phase === 'recording') {
      phase = 'processing';
      client.send('VOICE_RECORDING_STOP', { session_id: sessionId });
      console.log(GRAY('  Procesando tu grabación...'));
    }

    if (activeConfirmationId) {
      clearStatus();
      console.log(`  ${chalk.gray('→')} ${text}`);
      sendConfirmationText(text);
    } else if (mode === 'live') {
      clearStatus();
      console.log(GRAY('  No hay ninguna confirmación pendiente. Habla por el micrófono o escribe /salir.'));
    }
    rl.prompt();
  });

  rl.on('SIGINT', () => {
    clearStatus();
    console.log(DIM('\nFinalizando Helix Voice...'));
    finish(0);
  });

  rl.on('close', () => {
    finish(0);
  });

  try {
    console.log(ORANGE_BOLD(`\n  ╭─ HELIX ${mode === 'live' ? 'LIVE VOICE' : 'NORMAL AUDIO'} ─ $0 local ─╮`));
    console.log(GRAY(`  Conectando con ${wsUrl}...`));
    await client.connect();
    client.send('VOICE_SESSION_START', {
      session_id: sessionId,
      mode,
      server_audio: true,
      tts_enabled: true,
      opening_greeting: mode === 'live',
      silence_ms: 1000,
    });
  } catch (error) {
    clearStatus();
    console.error(RED(`✖ ${getUserFacingError(
      error,
      'No se pudo conectar con el agente. Abre HELIX Desktop y vuelve a intentarlo.',
    )}`));
    rl.close();
    client.close();
    return 1;
  }

  return completion;
}
