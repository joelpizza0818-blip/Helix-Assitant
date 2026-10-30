/**
 * /model — CLI command for viewing and switching the active AI model.
 *
 * Subcommands:
 *   /model            — show current model + provider
 *   /model list       — list all model tiers (Free, Local Ollama, Cloud)
 *   /model set <id>   — switch to a model by id
 *   /model effort <low|medium|high> — set effort/quality level
 */
import chalk from 'chalk';
import type { AgentClient } from '../client/agent-client';
import { CYAN, CYAN_BOLD, GREEN, YELLOW, GRAY, DIM, BOLD, ORANGE_BOLD, RED } from '../ui/colors';

// ── Model catalog (mirrors ModelSelectorDropdown.tsx) ──────────────────────────
export interface ModelEntry {
  id: string;
  label: string;
  tier: 'free' | 'local' | 'cloud';
  provider: string;
  badge?: string;
}

export const FREE_MODELS: ModelEntry[] = [
  {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    label: 'Llama 3.2 3B Instruct',
    tier: 'free',
    provider: 'free',
    badge: '0-cost',
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct:free',
    label: 'Qwen 2.5 Coder 32B',
    tier: 'free',
    provider: 'free',
    badge: '0-cost',
  },
  {
    id: 'deepseek/deepseek-r1:free',
    label: 'DeepSeek R1',
    tier: 'free',
    provider: 'free',
    badge: '0-cost · razonamiento',
  },
  {
    id: 'google/gemini-flash-1.5:free',
    label: 'Gemini Flash 1.5',
    tier: 'free',
    provider: 'free',
    badge: '0-cost · rápido',
  },
];

export const LOCAL_MODELS: ModelEntry[] = [
  { id: 'ollama/llama3', label: 'Llama 3 (local)', tier: 'local', provider: 'ollama' },
  { id: 'ollama/mistral', label: 'Mistral 7B (local)', tier: 'local', provider: 'ollama' },
  { id: 'ollama/deepseek-coder', label: 'DeepSeek Coder (local)', tier: 'local', provider: 'ollama' },
  { id: 'ollama/phi3', label: 'Phi-3 Mini (local)', tier: 'local', provider: 'ollama' },
  { id: 'ollama/qwen2.5-coder', label: 'Qwen 2.5 Coder (local)', tier: 'local', provider: 'ollama' },
];

export const CLOUD_MODELS: ModelEntry[] = [
  { id: 'gpt-4o', label: 'GPT-4o', tier: 'cloud', provider: 'openai' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', tier: 'cloud', provider: 'openai' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', tier: 'cloud', provider: 'anthropic' },
  { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku', tier: 'cloud', provider: 'anthropic' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', tier: 'cloud', provider: 'gemini' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', tier: 'cloud', provider: 'gemini' },
];

export const ALL_MODELS: ModelEntry[] = [...FREE_MODELS, ...LOCAL_MODELS, ...CLOUD_MODELS];

// ── Helpers ───────────────────────────────────────────────────────────────────

function providerBadge(entry: ModelEntry): string {
  if (entry.tier === 'free') return chalk.green.bold('[0-COST]');
  if (entry.tier === 'local') return chalk.cyan.bold('[LOCAL]');
  return chalk.yellow.bold('[CLOUD]');
}

function findModel(id: string): ModelEntry | undefined {
  return ALL_MODELS.find((m) => m.id === id || m.id.startsWith(id));
}

// ── Command handlers ──────────────────────────────────────────────────────────

/** /model — show current model */
export async function handleModelStatus(client: AgentClient): Promise<void> {
  try {
    const settings = await client.getSettings();
    const modelId: string = (settings as Record<string, string>).default_model || '(none)';
    const provider: string = (settings as Record<string, string>).preferred_provider || '(none)';
    const entry = findModel(modelId);

    console.log('');
    console.log(`  ${chalk.hex('#FF8C00').bold('⬡ Modelo Activo')}`);
    console.log(`  ${chalk.gray('─'.repeat(44))}`);
    console.log(`  ${chalk.gray('ID')}           ${chalk.white.bold(modelId)}`);
    console.log(`  ${chalk.gray('Proveedor')}    ${chalk.white(provider)}`);
    if (entry) {
      console.log(`  ${chalk.gray('Nombre')}       ${entry.label}`);
      console.log(`  ${chalk.gray('Nivel')}        ${providerBadge(entry)} ${entry.badge ? DIM(`(${entry.badge})`) : ''}`);
    }
    const speed: string = (settings as Record<string, string>).speed_preference || 'balanced';
    const quality: string = (settings as Record<string, string>).quality_preference || 'balanced';
    console.log(`  ${chalk.gray('Velocidad')}    ${chalk.cyan(speed)}`);
    console.log(`  ${chalk.gray('Calidad')}      ${chalk.cyan(quality)}`);
    console.log('');
    console.log(DIM('  Usa /model list para ver opciones, /model set <id> para cambiar.'));
    console.log('');
  } catch (err) {
    console.log(RED(`  Error al obtener modelo: ${(err as Error).message}\n`));
  }
}

/** /model list — print the full model catalog */
export function handleModelList(): void {
  const printSection = (title: string, models: ModelEntry[]): void => {
    console.log(`\n  ${chalk.hex('#FF8C00').bold(title)}`);
    console.log(`  ${chalk.gray('─'.repeat(60))}`);
    for (const m of models) {
      const badge = providerBadge(m);
      const extra = m.badge ? DIM(` · ${m.badge}`) : '';
      console.log(`  ${badge}  ${chalk.white.bold(m.label.padEnd(32))} ${GRAY(m.id)}${extra}`);
    }
  };

  console.log('');
  console.log(`  ${BOLD('🧠 Catálogo de Modelos HELIX')}`);
  printSection('✦ Nivel 1 — Sin costo (OpenRouter Free)', FREE_MODELS);
  printSection('✦ Nivel 2 — Local Ollama (sin internet)', LOCAL_MODELS);
  printSection('✦ Nivel 3 — Nube con API Key propia', CLOUD_MODELS);
  console.log('');
  console.log(DIM('  Usa: /model set <model-id>   para activar un modelo'));
  console.log(DIM('  Usa: /model effort <low|medium|high>   para ajustar esfuerzo'));
  console.log('');
}

/** /model set <id> — switch the active model */
export async function handleModelSet(client: AgentClient, modelId: string): Promise<void> {
  if (!modelId) {
    console.log(YELLOW('  Uso: /model set <model-id>\n'));
    return;
  }

  const entry = findModel(modelId);
  const provider = entry?.provider || (modelId.startsWith('ollama/') ? 'ollama' : 'openai');

  try {
    await client.saveSettings({
      default_model: entry?.id ?? modelId,
      preferred_provider: provider,
    } as Parameters<typeof client.saveSettings>[0]);

    const badge = entry ? providerBadge(entry) : '';
    console.log('');
    console.log(GREEN('  ✔ Modelo actualizado correctamente.'));
    console.log(`  ${chalk.gray('Modelo:')}    ${chalk.white.bold(entry?.id ?? modelId)} ${badge}`);
    console.log(`  ${chalk.gray('Proveedor:')} ${chalk.white(provider)}`);
    console.log('');
  } catch (err) {
    console.log(RED(`  ✖ Error al cambiar modelo: ${(err as Error).message}\n`));
  }
}

/** /model effort <low|medium|high> — set effort/quality level */
export async function handleModelEffort(client: AgentClient, level: string): Promise<void> {
  const valid = ['low', 'medium', 'high'];
  const normalized = level?.toLowerCase();
  if (!normalized || !valid.includes(normalized)) {
    console.log(YELLOW('  Uso: /model effort <low|medium|high>\n'));
    return;
  }

  const speedMap: Record<string, string> = { low: 'fast', medium: 'balanced', high: 'balanced' };
  const qualityMap: Record<string, string> = { low: 'fast', medium: 'balanced', high: 'best' };

  try {
    await client.saveSettings({
      speed_preference: speedMap[normalized],
      quality_preference: qualityMap[normalized],
    } as Parameters<typeof client.saveSettings>[0]);

    console.log('');
    console.log(GREEN(`  ✔ Nivel de esfuerzo → ${chalk.white.bold(normalized.toUpperCase())}`));
    console.log(DIM(`  Velocidad: ${speedMap[normalized]}  |  Calidad: ${qualityMap[normalized]}`));
    console.log('');
  } catch (err) {
    console.log(RED(`  ✖ Error al ajustar esfuerzo: ${(err as Error).message}\n`));
  }
}

/** /model free-list — list free models fetched from bridge (live) */
export async function handleFreeModelList(client: AgentClient): Promise<void> {
  try {
    const result = await (client as AgentClient & { request: <T>(type: string, payload: unknown) => Promise<T> })
      .request<{ models: Array<{ id: string; label: string; provider: string }> }>('LIST_FREE_MODELS', {});

    if (!result?.models?.length) {
      // Fallback to static catalog
      handleModelList();
      return;
    }

    console.log(`\n  ${BOLD('✦ Modelos gratuitos disponibles (live):')} \n`);
    for (const m of result.models) {
      console.log(`  ${GREEN('[0-COST]')}  ${chalk.white.bold(m.label)}  ${GRAY(m.id)}`);
    }
    console.log('');
  } catch {
    // Agent not connected or handler not present — fall back to static
    handleModelList();
  }
}

/** Top-level dispatcher for /model <args> */
export async function handleModelCommand(client: AgentClient, args: string): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase() || '';

  switch (sub) {
    case '':
      await handleModelStatus(client);
      break;
    case 'list':
      handleModelList();
      break;
    case 'set':
      await handleModelSet(client, parts.slice(1).join(' '));
      break;
    case 'effort':
      await handleModelEffort(client, parts[1] || '');
      break;
    default:
      console.log(YELLOW(`  Subcomando desconocido: "${sub}". Opciones: list, set, effort\n`));
  }
}
