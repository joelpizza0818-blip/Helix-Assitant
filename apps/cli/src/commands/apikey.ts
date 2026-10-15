import prompts from 'prompts';
import chalk from 'chalk';
import type { AgentClient } from '../client/agent-client';
import { CYAN, GREEN, RED, YELLOW, GRAY, BOLD, DIM } from '../ui/colors';

const KNOWN_PROVIDERS = [
  { title: 'OpenAI (GPT-4o, o1, o3-mini)', value: 'openai' },
  { title: 'Anthropic (Claude 3.5 Sonnet, Claude 3.7)', value: 'anthropic' },
  { title: 'Google (Gemini 2.0 Flash / Pro)', value: 'google' },
  { title: 'Groq (Llama 3.3, DeepSeek R1)', value: 'groq' },
  { title: 'Mistral AI (Mistral Large, Codestral)', value: 'mistral' },
  { title: 'Ollama / Local Custom Provider', value: 'ollama' },
];

export async function handleShowApiKey(client: AgentClient): Promise<void> {
  console.log(`\n${BOLD('🔑 Configuración Actual de API Keys:')}\n`);

  try {
    const providers = await client.getProviders();
    if (!providers || providers.length === 0) {
      console.log(GRAY('  No se encontraron proveedores registrados en el agente.\n'));
      return;
    }

    for (const provider of providers) {
      const statusIcon = provider.configured ? GREEN('●') : GRAY('○');
      const providerTitle = provider.configured
        ? chalk.greenBright.bold(provider.name || provider.id)
        : chalk.gray(provider.name || provider.id);

      console.log(`  ${statusIcon} ${providerTitle} ${DIM(`(${provider.models_available || 0} modelos disponibles)`)}`);

      if (provider.keys && provider.keys.length > 0) {
        for (const slot of provider.keys) {
          let healthBadge: string;
          switch (slot.health) {
            case 'healthy':
              healthBadge = chalk.green('✔ Válida / Activa');
              break;
            case 'degraded':
              healthBadge = chalk.yellow('⚠ Degradada');
              break;
            case 'cooldown':
              healthBadge = chalk.red('⏳ Cooldown');
              break;
            case 'unconfigured':
              healthBadge = chalk.gray('○ No configurada');
              break;
            default:
              healthBadge = chalk.gray(slot.health);
          }

          const maskedText = slot.configured ? chalk.cyan('••••••••••••••••') : chalk.gray('vacío');
          console.log(`     ${GRAY('Slot ' + slot.slot + ':')} ${maskedText}  [${healthBadge}]`);
        }
      } else {
        console.log(`     ${GRAY('Sin slots de claves registrados')}`);
      }
      console.log('');
    }
  } catch (error) {
    console.log(RED(`  Error al consultar API keys del agente: ${(error as Error).message}\n`));
  }
}

export async function handleConfigApiKey(client: AgentClient): Promise<void> {
  console.log(`\n${BOLD('⚙️  Configurador Interactivo de API Keys')}\n`);

  // 1. Select Provider
  const providerAnswer = await prompts({
    type: 'select',
    name: 'provider',
    message: 'Selecciona el proveedor de IA para configurar:',
    choices: KNOWN_PROVIDERS,
  });

  const providerId = providerAnswer.provider as string | undefined;
  if (!providerId) {
    console.log(YELLOW('Operación cancelada.\n'));
    return;
  }

  // 2. Select Slot
  const slotAnswer = await prompts({
    type: 'select',
    name: 'slot',
    message: `Selecciona el Slot para ${providerId.toUpperCase()}:`,
    choices: [
      { title: 'Slot 1 (Principal)', value: 1 },
      { title: 'Slot 2 (Respaldo)', value: 2 },
      { title: 'Slot 3 (Rotación)', value: 3 },
      { title: 'Añadir nuevo Slot', value: 4 },
    ],
  });

  const slotNumber = slotAnswer.slot as number | undefined;
  if (!slotNumber) {
    console.log(YELLOW('Operación cancelada.\n'));
    return;
  }

  // 3. Prompt for API Key
  const keyAnswer = await prompts({
    type: 'password',
    name: 'apiKey',
    message: `Introduce la API Key para ${providerId.toUpperCase()} (Slot ${slotNumber}):`,
    validate: (val: string) => (val && val.trim().length > 0 ? true : 'La API Key no puede estar vacía'),
  });

  const apiKey = (keyAnswer.apiKey as string | undefined)?.trim();
  if (!apiKey) {
    console.log(YELLOW('Operación cancelada.\n'));
    return;
  }

  console.log(CYAN(`\n  Validando clave con ${providerId}...`));

  try {
    const health = await client.validateKey(providerId, slotNumber, apiKey);
    if (health === 'healthy') {
      console.log(GREEN(`\n  ✔ ¡API Key validada y guardada con éxito en el almacén seguro!`));
      console.log(DIM(`  Proveedor: ${providerId} | Slot: ${slotNumber} | Estado: healthy\n`));
    } else {
      console.log(YELLOW(`\n  ⚠ La clave fue procesada pero su estado es: ${health}\n`));
    }
  } catch (err) {
    console.log(RED(`\n  ✖ Error al validar la API Key: ${(err as Error).message}\n`));
  }
}
