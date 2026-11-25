/**
 * PUT /api/jobs/:id/file <- the job's saved .figcraft (job-token auth) -> { versionId }
 * The sandbox uploads its result once; it becomes an `agent` version (Story 4.5). 401 for a bad
 * token, 409 when the job already ended (the sandbox should stop).
 */
import { getDb } from '@greenfield/db';
import { NextResponse } from 'next/server';
import { saveAgentVersion } from '@/server/services/agent/agent-jobs';
import { JobTokenError, tokenFromHeaders } from '@/server/services/agent/job-tokens';
import { defaultDesignFileStorage, MAX_DESIGN_FILE_BYTES } from '@/server/services/design-files';
import { ValidationError } from '@/server/services/types';

export const maxDuration = 60;

export async function PUT(req: Request, ctx: RouteContext<'/api/jobs/[jobId]/file'>) {
  try {
    const { jobId } = await ctx.params;
    if (Number(req.headers.get('content-length') ?? 0) > MAX_DESIGN_FILE_BYTES)
      throw new ValidationError('Document too large');
    const bytes = new Uint8Array(await req.arrayBuffer());
    const storage = defaultDesignFileStorage();
    const token = tokenFromHeaders(req.headers);
    return NextResponse.json(await saveAgentVersion(getDb(), storage, token, jobId, bytes));
  } catch (e) {
    if (e instanceof JobTokenError) {
      const gone = e.message === 'Job is no longer running';
      return NextResponse.json(
        { error: gone ? 'gone' : 'unauthorized' },
        { status: gone ? 409 : 401 },
      );
    }
    if (e instanceof ValidationError)
      return NextResponse.json({ error: 'invalid', message: e.message }, { status: 400 });
    console.error('[jobs] upload failed', e instanceof Error ? e.name : typeof e);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
