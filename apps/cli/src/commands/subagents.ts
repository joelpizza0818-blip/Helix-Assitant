import type { AgentClient } from '../client/agent-client';
import { CYAN_BOLD, DIM, RED, YELLOW } from '../ui/colors';

interface SubagentProfile {
  profile_id: string;
  name: string;
}

interface SubagentStatus {
  profile_id?: string;
  name?: string;
  status?: string;
  progress?: number;
  current_action?: string;
}

function boundedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\r\n|]/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 3)}...` : clean;
}

function statusLabel(status?: string): string {
  const normalized = status?.toLowerCase() || 'idle';
  if (['running', 'active', 'in_progress'].includes(normalized)) return 'RUNNING';
  if (['failed', 'error'].includes(normalized)) return 'FAILED';
  if (['completed', 'done'].includes(normalized)) return 'DONE';
  if (['cancelled', 'canceled'].includes(normalized)) return 'STOPPED';
  return 'IDLE';
}

export function renderSubagentPanel(
  profiles: SubagentProfile[],
  statuses: SubagentStatus[],
): string {
  const statusByProfile = new Map<string, SubagentStatus>();
  for (const status of statuses) {
    if (status.profile_id) statusByProfile.set(status.profile_id, status);
  }

  const rows = profiles.map((profile) => {
    const status = statusByProfile.get(profile.profile_id);
    const profileId = boundedText(profile.profile_id, 22);
    const name = boundedText(profile.name, 18);
    const state = statusLabel(status?.status);
    const progress = Number.isFinite(status?.progress) ? ` ${status?.progress}%` : '';
    const action = boundedText(status?.current_action, 26);
    return [
      profileId.padEnd(22),
      name.padEnd(18),
      `${state}${progress}`,
      action,
    ];
  });

  const headings = ['PROFILE ID', 'NAME', 'STATE', 'CURRENT ACTION'];
  const widths = [22, 18, 16, 26];
  const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
  const row = (values: string[]) =>
    `| ${values.map((value, index) => value.padEnd(widths[index])).join(' | ')} |`;
  const lines = [
    border,
    row(headings),
    border,
    ...(rows.length > 0
      ? rows.map(row)
      : [row(['No profiles', 'available', '', ''])]),
    border,
  ];
  return lines.join('\n');
}

function asArray<T>(
  value: unknown,
  label: string,
  isItem: (item: unknown) => item is T,
): T[] {
  if (!Array.isArray(value) || !value.every(isItem)) {
    throw new Error(`Agent returned an invalid ${label} list.`);
  }
  return value;
}

function isSubagentProfile(value: unknown): value is SubagentProfile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.profile_id === 'string'
    && typeof profile.name === 'string';
}

function isSubagentStatus(value: unknown): value is SubagentStatus {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return (status.profile_id === undefined || typeof status.profile_id === 'string')
    && (status.status === undefined || typeof status.status === 'string')
    && (status.progress === undefined || typeof status.progress === 'number')
    && (status.current_action === undefined || typeof status.current_action === 'string');
}

export async function handleSubagentsCommand(
  client: AgentClient,
  args = '',
): Promise<void> {
  const trimmed = args.trim();
  const chatMatch = trimmed.match(/^chat\s+(\S+)\s+([\s\S]+)$/i);
  if (chatMatch) {
    const [, profileId, message] = chatMatch;
    try {
      const result = await client.request<unknown>(
        'CHAT_SUBAGENT',
        { profile_id: profileId, message: message.trim() },
        120000,
      );
      console.log('\n' + CYAN_BOLD(`  SUBAGENT ${profileId}`));
      if (
        result !== null
        && typeof result === 'object'
        && 'response' in result
        && typeof result.response === 'string'
      ) {
        console.log(result.response);
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      console.log('');
    } catch (error) {
      console.log(RED(`  No se pudo contactar al subagente: ${(error as Error).message}\n`));
    }
    return;
  }

  if (trimmed && !/^list$/i.test(trimmed)) {
    console.log(YELLOW('  Uso: /subagents [list] | /subagents chat <id> <mensaje>\n'));
    return;
  }

  try {
    const [profilesValue, statusesValue] = await Promise.all([
      client.request<unknown[]>('GET_SUBAGENT_PROFILES'),
      client.request<unknown[]>('GET_SUBAGENT_STATUS'),
    ]);
    const profiles = asArray(profilesValue, 'subagent profile', isSubagentProfile);
    const statuses = asArray(statusesValue, 'subagent status', isSubagentStatus);
    console.log(`\n${CYAN_BOLD('  HELIX SUBAGENTS')}`);
    console.log(renderSubagentPanel(profiles, statuses));
    console.log(DIM('  Chat: /subagents chat <profile_id> <mensaje>\n'));
  } catch (error) {
    console.log(RED(`  No se pudo cargar el panel de subagentes: ${(error as Error).message}\n`));
  }
}
