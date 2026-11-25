/**
 * Claude follows the file's design system (Story 10.5): what an agent turn needs from it (the
 * prefix block and the check's rules), and what the project page shows about it. Null when the
 * file uses no system.
 */
import { designSystemVersions, designSystems, eq, type Db } from '@greenfield/db';
import type { Actor } from '../types';
import { checkLayers, rulesFor, systemPrompt, type SystemRules, type Violation } from './check';
import { getFileDesignSystem } from './index';

export interface TurnDesignSystem {
  prompt: string;
  rules: SystemRules;
}

export async function designSystemForTurn(
  db: Db,
  actor: Actor,
  projectId: string,
): Promise<TurnDesignSystem | null> {
  const ds = await getFileDesignSystem(db, actor, { projectId });
  if (!ds) return null;
  return {
    prompt: systemPrompt({
      name: ds.system.name,
      version: ds.version.version,
      guide: ds.version.guide,
      summary: ds.version.summary,
    }),
    rules: rulesFor(ds.system.name, ds.version.summary),
  };
}

export interface ProjectDesignSystem {
  system: { id: string; name: string };
  /** The version the file is on, and the published one (newer means an update is waiting). */
  version: number;
  published: number | null;
  /** What the file has from it ("Libraries in use"). */
  counts: { colours: number; type: number; components: number; spacing: number };
  rules: SystemRules;
}

export async function projectDesignSystem(
  db: Db,
  actor: Actor,
  projectId: string,
): Promise<ProjectDesignSystem | null> {
  const ds = await getFileDesignSystem(db, actor, { projectId });
  if (!ds) return null;
  const [row] = await db
    .select({ version: designSystemVersions.version })
    .from(designSystems)
    .innerJoin(designSystemVersions, eq(designSystemVersions.id, designSystems.publishedVersionId))
    .where(eq(designSystems.id, ds.system.id));
  const items = ds.version.summary;
  const counts = { colours: 0, type: 0, components: 0, spacing: 0 };
  for (const i of items)
    if (i.kind === 'colours') counts.colours += i.colours.length;
    else if (i.kind === 'spacing') counts.spacing += i.values.length;
    else if (i.kind === 'type') counts.type++;
    else counts.components++;
  return {
    system: ds.system,
    version: ds.version.version,
    published: row?.version ?? null,
    counts,
    rules: rulesFor(ds.system.name, items),
  };
}

/** Check layers (as the editor's `node.get` returns them) against the file's system. */
export async function checkProjectLayers(
  db: Db,
  actor: Actor,
  projectId: string,
  layers: unknown[],
): Promise<{ system: string; violations: Violation[] } | null> {
  const ds = await designSystemForTurn(db, actor, projectId);
  if (!ds) return null;
  return { system: ds.rules.name, violations: checkLayers(layers, ds.rules) };
}
