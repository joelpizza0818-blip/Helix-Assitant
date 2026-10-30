/**
 * /memory — CLI command for inspecting the Adaptive Learning Harness.
 *
 * Subcommands:
 *   /memory           — show quick stats summary
 *   /memory stats     — detailed episode + rule counts
 *   /memory rules     — list top learned rules
 *   /memory reset     — run maintenance / pruning cycle
 */
import chalk from 'chalk';
import type { AgentClient } from '../client/agent-client';
import { GREEN, YELLOW, RED, GRAY, DIM, BOLD, ORANGE_BOLD, CYAN } from '../ui/colors';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LearnedRule {
  category: string;
  rule: string;
  confidence: number;
  uses: number;
}

interface LearningStats {
  episode_count: number;
  rule_count: number;
  correction_count: number;
  skill_count: number;
  top_rules: LearnedRule[];
  last_episode_at?: string;
  user_md_exists: boolean;
}

// ── Request helper ────────────────────────────────────────────────────────────

type RequestableClient = AgentClient & {
  request: <T>(type: string, payload: unknown) => Promise<T>;
};

async function fetchLearningStats(client: AgentClient): Promise<LearningStats | null> {
  try {
    return await (client as RequestableClient).request<LearningStats>('GET_LEARNING_STATS', {});
  } catch {
    return null;
  }
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderStats(stats: LearningStats): void {
  console.log('');
  console.log(`  ${chalk.hex('#FF8C00').bold('⬡ Sistema de Aprendizaje Adaptativo')}`);
  console.log(`  ${chalk.gray('─'.repeat(48))}`);

  const ep = stats.episode_count;
  const ru = stats.rule_count;
  const co = stats.correction_count;
  const sk = stats.skill_count;

  console.log(`  ${chalk.gray('Episodios registrados')}   ${chalk.white.bold(ep.toString())}`);
  console.log(`  ${chalk.gray('Correcciones del usuario')} ${co > 0 ? chalk.yellow.bold(co.toString()) : chalk.white(co.toString())}`);
  console.log(`  ${chalk.gray('Reglas aprendidas')}       ${chalk.cyan.bold(ru.toString())}`);
  console.log(`  ${chalk.gray('Skills auto-generadas')}   ${chalk.magenta.bold(sk.toString())}`);

  if (stats.last_episode_at) {
    const d = new Date(stats.last_episode_at);
    console.log(`  ${chalk.gray('Último episodio')}         ${DIM(d.toLocaleString())}`);
  }

  const userMdStatus = stats.user_md_exists
    ? chalk.green('✔ USER.md activo')
    : chalk.gray('○ Sin perfil generado aún');
  console.log(`  ${chalk.gray('Perfil feedforward')}      ${userMdStatus}`);
  console.log('');
}

function renderRules(stats: LearningStats): void {
  if (!stats.top_rules || stats.top_rules.length === 0) {
    console.log(GRAY('  No hay reglas aprendidas todavía. Interactúa con HELIX para que aprenda tus preferencias.\n'));
    return;
  }

  console.log('');
  console.log(`  ${chalk.hex('#FF8C00').bold(`✦ Top ${stats.top_rules.length} Reglas Aprendidas`)}`);
  console.log(`  ${chalk.gray('─'.repeat(56))}`);

  for (const rule of stats.top_rules) {
    const conf = Math.round(rule.confidence * 100);
    const bar = '█'.repeat(Math.min(10, Math.floor(conf / 10)));
    const confColor = conf >= 80 ? chalk.green : conf >= 50 ? chalk.yellow : chalk.gray;
    console.log(`  ${chalk.cyan(`[${rule.category}]`).padEnd(24)} ${chalk.white(rule.rule)}`);
    console.log(`    ${DIM('Confianza:')} ${confColor(`${conf}%`)} ${chalk.gray(bar)}  ${DIM(`(${rule.uses} usos)`)}`);
    console.log('');
  }
}

// ── Command handlers ──────────────────────────────────────────────────────────

export async function handleMemoryStats(client: AgentClient): Promise<void> {
  const stats = await fetchLearningStats(client);

  if (!stats) {
    console.log(YELLOW('  ⚠ El harness de aprendizaje no está disponible (agente desconectado o versión antigua).\n'));
    return;
  }

  renderStats(stats);
  if (stats.top_rules?.length) {
    console.log(DIM('  Usa /memory rules para ver las reglas detalladas.'));
    console.log('');
  }
}

export async function handleMemoryRules(client: AgentClient): Promise<void> {
  const stats = await fetchLearningStats(client);

  if (!stats) {
    console.log(YELLOW('  ⚠ El harness de aprendizaje no está disponible.\n'));
    return;
  }

  renderStats(stats);
  renderRules(stats);
}

export async function handleMemoryReset(client: AgentClient): Promise<void> {
  try {
    const result = await (client as RequestableClient).request<{ pruned_rules_count: number; pruned_skills: string[] }>(
      'RUN_LEARNING_MAINTENANCE',
      {},
    );

    console.log('');
    console.log(GREEN('  ✔ Mantenimiento del harness completado.'));
    console.log(`  ${chalk.gray('Reglas podadas:')}  ${chalk.white.bold(String(result.pruned_rules_count ?? 0))}`);
    const pruned = result.pruned_skills ?? [];
    if (pruned.length) {
      console.log(`  ${chalk.gray('Skills podadas:')} ${chalk.white(pruned.join(', '))}`);
    } else {
      console.log(`  ${chalk.gray('Skills podadas:')} ${DIM('ninguna')}`);
    }
    console.log('');
  } catch (err) {
    console.log(RED(`  ✖ Error durante mantenimiento: ${(err as Error).message}\n`));
  }
}

/** Top-level dispatcher for /memory <args> */
export async function handleMemoryCommand(client: AgentClient, args: string): Promise<void> {
  const sub = args.trim().split(/\s+/)[0]?.toLowerCase() || '';

  switch (sub) {
    case '':
    case 'stats':
      await handleMemoryStats(client);
      break;
    case 'rules':
      await handleMemoryRules(client);
      break;
    case 'reset':
    case 'maintenance':
    case 'prune':
      await handleMemoryReset(client);
      break;
    default:
      console.log(YELLOW(`  Subcomando desconocido: "${sub}". Opciones: stats, rules, reset\n`));
  }
}
