/**
 * GET /api/file-versions/:id -> 200 application/octet-stream (streamed), x-version: the version
 * as URI-encoded JSON. A stored version of a project's document, e.g. a job's result (Story
 * 4.5), for the tab to open for review. Needs project:read in the version's workspace.
 */
import { getDb } from '@greenfield/db';
import { NextResponse } from 'next/server';
import { apiActor, apiError } from '@/server/api';
import { loadFileVersion } from '@/server/services/agent/agent-jobs';
import { defaultDesignFileStorage } from '@/server/services/design-files';

export async function GET(_req: Request, ctx: RouteContext<'/api/file-versions/[versionId]'>) {
  try {
    const actor = await apiActor();
    const { versionId } = await ctx.params;
    const v = await loadFileVersion(getDb(), actor, defaultDesignFileStorage(), versionId);
    return new NextResponse(v.body, {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/octet-stream',
        'content-length': String(v.size),
        'x-version': encodeURIComponent(JSON.stringify(v.version)),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
