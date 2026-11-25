/**
 * A new version built again from the system's repository (Story 10.6, with 10.2's builder).
 *
 * POST /api/design-systems/:systemId/rebuild -> progress as NDJSON (`build-stream.ts`), ending
 * with the version to review. Needs design_system:edit.
 */
import { getDb } from '@greenfield/db';
import { apiActor, apiError } from '@/server/api';
import { defaultDesignFileStorage } from '@/server/services/design-files';
import { rebuildDesignSystem } from '@/server/services/design-systems';
import { buildStream } from '../../build-stream';

export const maxDuration = 120;

export async function POST(
  _req: Request,
  ctx: RouteContext<'/api/design-systems/[systemId]/rebuild'>,
) {
  try {
    const actor = await apiActor();
    const { systemId } = await ctx.params;
    return buildStream(async (onStep) => {
      const v = await rebuildDesignSystem(
        getDb(),
        actor,
        defaultDesignFileStorage(),
        { systemId },
        { onStep },
      );
      return { id: systemId, version: v.version };
    });
  } catch (e) {
    return apiError(e);
  }
}
