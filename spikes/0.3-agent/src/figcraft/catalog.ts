/** The command catalog (`list_commands`, saved by `pnpm tools` to commands.txt). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKE_DIR } from './mcp';

export interface CatalogEntry {
  id: string;
  undoable: boolean;
  line: string;
}

let cached: { text: string; entries: Map<string, CatalogEntry> } | null = null;

export function catalog() {
  if (cached) return cached;
  const text = readFileSync(join(SPIKE_DIR, 'commands.txt'), 'utf8').trimEnd();
  const entries = new Map<string, CatalogEntry>();
  for (const line of text.split('\n').slice(1)) {
    const m = /^([\w.]+)(\*?) — /.exec(line);
    if (m) entries.set(m[1]!, { id: m[1]!, undoable: m[2] === '*', line });
  }
  cached = { text, entries };
  return cached;
}

/** Unknown commands count as mutating (the safe side for scope checks). */
export const isMutating = (command: string) => catalog().entries.get(command)?.undoable ?? true;

export const catalogLines = (ids: readonly string[]) =>
  ids.map((id) => catalog().entries.get(id)?.line ?? `${id} (not in catalog)`).join('\n');
