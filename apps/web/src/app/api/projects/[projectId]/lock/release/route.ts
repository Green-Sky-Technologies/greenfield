/**
 * Release this tab's edit lock as the page goes away (Story 3.8).
 *
 * POST /api/projects/:id/lock/release?sessionId=… -> LockState
 *
 * The `pagehide` beacon: `navigator.sendBeacon` only POSTs, and WebKit drops a `keepalive`
 * DELETE sent while the page unloads. Same as `DELETE ../lock?sessionId=…&leave=1`.
 */
import { getDb } from '@greenfield/db';
import { NextResponse, type NextRequest } from 'next/server';
import { apiActor, apiError } from '@/server/api';
import { releaseLock } from '@/server/services/locks';

export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/projects/[projectId]/lock/release'>,
) {
  try {
    const actor = await apiActor();
    const { projectId } = await ctx.params;
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    return NextResponse.json(
      await releaseLock(getDb(), actor, projectId, { sessionId, leave: true }),
    );
  } catch (e) {
    return apiError(e);
  }
}
