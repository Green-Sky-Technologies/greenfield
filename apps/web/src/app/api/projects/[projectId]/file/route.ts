/**
 * The project's design file (a `.figcraft` document) as raw bytes.
 *
 * GET /api/projects/:projectId/file -> 200 application/octet-stream (x-file-name, x-storage)
 *                                     | 204 when nothing is saved yet
 * PUT /api/projects/:projectId/file <- the raw document bytes -> { size, storage, comments }
 *                                     (comments: threads mirrored from the file, or null)
 *
 * Reading needs project:read, saving design:edit (services/design-files). Bodies are never
 * logged.
 */
import { getDb } from '@greenfield/db';
import { NextResponse, type NextRequest } from 'next/server';
import { apiActor, apiError } from '@/server/api';
import {
  defaultDesignFileStorage,
  loadDesignFile,
  MAX_DESIGN_FILE_BYTES,
  saveDesignFile,
} from '@/server/services/design-files';
import { ValidationError } from '@/server/services/types';

type Ctx = RouteContext<'/api/projects/[projectId]/file'>;

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const actor = await apiActor();
    const { projectId } = await ctx.params;
    const storage = defaultDesignFileStorage();
    const file = await loadDesignFile(getDb(), actor, storage, { projectId });
    const headers = { 'cache-control': 'no-store', 'x-storage': storage.kind };
    if (!file) return new NextResponse(null, { status: 204, headers });
    return new NextResponse(Buffer.from(file.bytes), {
      headers: {
        ...headers,
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const actor = await apiActor();
    const { projectId } = await ctx.params;
    if (Number(req.headers.get('content-length') ?? 0) > MAX_DESIGN_FILE_BYTES)
      throw new ValidationError('File too large');
    const bytes = new Uint8Array(await req.arrayBuffer());
    const storage = defaultDesignFileStorage();
    const r = await saveDesignFile(getDb(), actor, storage, { projectId, bytes });
    return NextResponse.json({ size: r.size, storage: storage.kind, comments: r.comments });
  } catch (e) {
    return apiError(e);
  }
}
