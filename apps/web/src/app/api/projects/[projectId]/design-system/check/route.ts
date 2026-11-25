/**
 * Check layers against the file's design system (Story 10.5): the same deterministic check the
 * agent's turns get, for layers the tab reads with `node.get` (fields `CHECK_FIELDS`).
 *
 * POST /api/projects/:projectId/design-system/check <- { layers: EditorNode[] }
 *   -> { system, violations } | null (the file uses no system)
 */
import { getDb } from '@greenfield/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiActor, apiError, jsonBody } from '@/server/api';
import { checkProjectLayers } from '@/server/services/design-systems/follow';
import { ValidationError } from '@/server/services/types';

const body = z.object({ layers: z.array(z.unknown()).max(50) }).strict();

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/projects/[projectId]/design-system/check'>,
) {
  try {
    const actor = await apiActor();
    const { projectId } = await ctx.params;
    const parsed = body.safeParse(await jsonBody(req, 2 * 1024 * 1024));
    if (!parsed.success) throw new ValidationError('Expected { layers: [...] }');
    return NextResponse.json(
      await checkProjectLayers(getDb(), actor, projectId, parsed.data.layers),
    );
  } catch (e) {
    return apiError(e);
  }
}
