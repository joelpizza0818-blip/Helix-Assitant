import fs from 'fs';
import path from 'path';
import { getSettingsFilePath } from '../config/env';

const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Resolves the only user-controlled directory used by the CLI skill catalog.
 * HELIX_SKILLS_DIR is explicit; otherwise it follows the agent's settings path.
 */
export function getUserSkillsDirectory(): string {
  const configured = process.env.HELIX_SKILLS_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(path.dirname(getSettingsFilePath()), 'skills');
}

/**
 * Returns names only. The file contents are deliberately never read: skill
 * instructions can contain secrets and are not needed for autocomplete.
 * Discovery is shallow and rejects symlinked entries to avoid following paths
 * outside the user's skills directory.
 */
export function discoverUserSkillNames(skillsDirectory = getUserSkillsDirectory()): string[] {
  const root = path.resolve(skillsDirectory);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !SKILL_NAME.test(entry.name)) continue;

    const skillFile = path.join(root, entry.name, 'SKILL.md');
    try {
      const file = fs.lstatSync(skillFile);
      if (file.isFile() && !file.isSymbolicLink()) names.push(entry.name);
    } catch {
      // Ignore incomplete, inaccessible, or malformed user entries.
    }
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
