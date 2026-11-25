'use server';

import { run, type ActionResult } from '@/server/actions/result';
import { db, requireActor } from '@/server/context';
import { getFileDesignSystem } from '@/server/services/design-systems';

/**
 * The type families of the design system a project's file started from (Story 5.11: the font
 * picker lists them first), in the system's order; empty when it has none.
 */
export async function designSystemFontsAction(projectId: string): Promise<ActionResult<string[]>> {
  const actor = await requireActor();
  return run(async () => {
    const found = await getFileDesignSystem(db(), actor, { projectId });
    const families = (found?.version.summary ?? []).flatMap((item) =>
      item.kind === 'type' ? [item.fontFamily] : [],
    );
    return [...new Set(families)];
  });
}
