import chalk from 'chalk';
import type { AgentClient } from '../client/agent-client';
import { GREEN, RED, YELLOW, GRAY, BOLD, DIM } from '../ui/colors';

export async function handleMicrophoneCommand(
  client: AgentClient,
  action?: string,
  currentVoiceState: boolean = true
): Promise<boolean> {
  const normalizedAction = action?.toLowerCase().trim();

  if (normalizedAction === 'enable' || normalizedAction === 'on' || normalizedAction === 'true') {
    try {
      console.log(GRAY('\nActivando micrófono en el agente HELIX...'));
      await client.saveSettings({ voice_enabled: true });
      console.log(`${GREEN('🟢 Micrófono:')} ${chalk.greenBright.bold('ACTIVO')} ${DIM('(Escuchando wake word: "hey helix").')}\n`);
      return true;
    } catch (err) {
      console.log(RED(`✖ Error al activar micrófono: ${(err as Error).message}\n`));
      return currentVoiceState;
    }
  }

  if (normalizedAction === 'disable' || normalizedAction === 'off' || normalizedAction === 'false') {
    try {
      console.log(GRAY('\nDesactivando micrófono en el agente HELIX...'));
      await client.saveSettings({ voice_enabled: false });
      console.log(`${RED('🔴 Micrófono:')} ${chalk.redBright.bold('INACTIVO')} ${DIM('(Entrada por voz deshabilitada).')}\n`);
      return false;
    } catch (err) {
      console.log(RED(`✖ Error al desactivar micrófono: ${(err as Error).message}\n`));
      return currentVoiceState;
    }
  }

  // If no action or invalid action, show current status and instructions
  try {
    const settings = await client.getSettings();
    const isEnabled = settings.voice_enabled ?? currentVoiceState;
    const wakeWord = (settings.wake_word as string) || 'hey helix';

    console.log(`\n${BOLD('🎤 Estado del Micrófono y Reconocimiento de Voz:')}\n`);
    if (isEnabled) {
      console.log(`  Estado:      ${GREEN('🟢 ACTIVO')}`);
      console.log(`  Wake Word:   ${chalk.cyan.bold(`"${wakeWord}"`)}`);
      console.log(`  Detalles:    El agente procesará tu voz al decir "${wakeWord}".`);
    } else {
      console.log(`  Estado:      ${RED('🔴 INACTIVO')}`);
      console.log(`  Detalles:    La captura de voz está desactivada.`);
    }
    console.log(`\n  ${DIM('Uso: /microphone enable | /microphone disable')}\n`);
    return isEnabled;
  } catch (err) {
    console.log(RED(`  Error al consultar configuración de voz: ${(err as Error).message}\n`));
    return currentVoiceState;
  }
}
