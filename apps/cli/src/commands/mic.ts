mport chalk from 'chalk';
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
      console.log(GRAY('\nActivando micrÃ³fono en el agente HELIX...'));
      await client.saveSettings({ voice_enabled: true });
      console.log(`${GREEN('ðŸŸ¢ MicrÃ³fono:')} ${chalk.greenBright.bold('ACTIVO')} ${DIM('(Escuchando wake word: "hey helix").')}\n`);
      return true;
    } catch (err) {
      console.log(RED(`âœ– Error al activar micrÃ³fono: ${(err as Error).message}\n`));
      return currentVoiceState;
    }
  }

  if (normalizedAction === 'disable' || normalizedAction === 'off' || normalizedAction === 'false') {
    try {
      console.log(GRAY('\nDesactivando micrÃ³fono en el agente HELIX...'));
      await client.saveSettings({ voice_enabled: false });
      console.log(`${RED('ðŸ”´ MicrÃ³fono:')} ${chalk.redBright.bold('INACTIVO')} ${DIM('(Entrada por voz deshabilitada).')}\n`);
      return false;
    } catch (err) {
      console.log(RED(`âœ– Error al desactivar micrÃ³fono: ${(err as Error).message}\n`));
      return currentVoiceState;
    }
  }

  // If no action or invalid action, show current status and instructions
  try {
    const settings = await client.getSettings();
    const isEnabled = settings.voice_enabled ?? currentVoiceState;
    const wakeWord = (settings.wake_word as string) || 'hey helix';

    console.log(`\n${BOLD('ðŸŽ¤ Estado del MicrÃ³fono y Reconocimiento de Voz:')}\n`);
    if (isEnabled) {
      console.log(`  Estado:      ${GREEN('ðŸŸ¢ ACTIVO')}`);
      console.log(`  Wake Word:   ${chalk.cyan.bold(`"${wakeWord}"`)}`);
      console.log(`  Detalles:    El agente procesarÃ¡ tu voz al decir "${wakeWord}".`);
    } else {
      console.log(`  Estado:      ${RED('ðŸ”´ INACTIVO')}`);
      console.log(`  Detalles:    La captura de voz estÃ¡ desactivada.`);
    }
    console.log(`\n  ${DIM('Uso: /microphone enable | /microphone disable')}\n`);
    return isEnabled;
  } catch (err) {
    console.log(RED(`  Error al consultar configuraciÃ³n de voz: ${(err as Error).message}\n`));
    return currentVoiceState;
  }
}
