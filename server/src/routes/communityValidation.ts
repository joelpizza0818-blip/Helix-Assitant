import type { Prisma } from '@prisma/client';
import { z } from 'zod';

const SubmissionSchema = z.object({
  type: z.enum(['plugin', 'skill', 'agent']),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(12).max(600),
  manifest: z.unknown(),
}).strict();

const PluginManifestSchema = z.object({
  url: z.string().trim().url().max(2048).refine(isSafePluginUrl),
}).strict();

const SkillManifestSchema = z.object({
  triggers: z.array(z.string().trim().min(1).max(100)).max(20),
  tools: z.array(z.string().trim().min(1).max(80)).max(20),
  instructions: z.string().trim().min(1).max(15000),
}).strict();

const AgentManifestSchema = z.object({
  role: z.enum(['planning', 'coding', 'automation', 'research', 'analysis', 'general']),
  capabilities: z.array(z.string().trim().min(1).max(40)).max(20),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  instructions: z.string().max(6000).default(''),
}).strict();

export interface CommunitySubmission {
  type: 'plugin' | 'skill' | 'agent';
  name: string;
  description: string;
  manifest: Prisma.InputJsonObject;
}

function isSafePluginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || localHttp)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function parseCommunitySubmission(value: unknown): CommunitySubmission | null {
  const parsed = SubmissionSchema.safeParse(value);
  if (!parsed.success) return null;
  if (
    parsed.data.type === 'agent'
    && (parsed.data.name.length > 40 || parsed.data.description.length > 500)
  ) return null;
  const manifest = parsed.data.type === 'plugin'
    ? PluginManifestSchema.safeParse(parsed.data.manifest)
    : parsed.data.type === 'skill'
      ? SkillManifestSchema.safeParse(parsed.data.manifest)
      : AgentManifestSchema.safeParse(parsed.data.manifest);
  if (!manifest.success) return null;
  return {
    ...parsed.data,
    manifest: manifest.data as Prisma.InputJsonObject,
  };
}

export function isCommunityModerator(
  email: string | null,
  allowedEmails = process.env.HELIX_COMMUNITY_MODERATOR_EMAILS ?? '',
): boolean {
  if (!email) return false;
  const allowlist = allowedEmails
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}
