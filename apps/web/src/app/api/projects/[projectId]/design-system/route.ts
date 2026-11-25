/**
 * The design system a project's file uses (Story 10.5), for the edit panel's "Design system"
 * section and the pickers.
 *
 * GET /api/projects/:projectId/design-system -> ProjectDesignSystem | null
 */
import { getDb } from '@greenfield/db';
import { NextResponse } from 'next/server';
import { apiActor, apiError } from '@/server/api';
import { projectDesignSystem } from '@/server/services/design-systems/follow';

export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/projects/[projectId]/design-system'>,
) {
  try {
    const actor = await apiActor();
    const { projectId } = await ctx.params;
    return NextResponse.json(await projectDesignSystem(getDb(), actor, projectId));
  } catch (e) {
    return apiError(e);
  }
}
