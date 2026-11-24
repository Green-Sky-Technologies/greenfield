/**
 * Story 0.1 spike (dev-only, CRUNCH_FIGCRAFT_SPIKE=1): the project's FigCraft document bytes.
 *
 * GET /api/spike/figcraft/:projectId -> 200 application/octet-stream (x-file-name, x-storage)
 *                                       | 204 when nothing is saved yet
 * PUT /api/spike/figcraft/:projectId <- the raw document bytes -> { size, storage }
 *
 * 404 for everything when the flag is off. Bodies are never logged.
 */
import { getDb } from '@crunch/db';
import { NextResponse, type NextRequest } from 'next/server';
import { apiActor, apiError } from '@/server/api';
import {
  defaultDesignFileStorage,
  figcraftSpikeEnabled,
  loadDesignFile,
  MAX_DESIGN_FILE_BYTES,
  saveDesignFile,
} from '@/server/services/figcraft-spike';
import { ValidationError } from '@/server/services/types';

type Ctx = RouteContext<'/api/spike/figcraft/[projectId]'>;

const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!figcraftSpikeEnabled()) return notFound();
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
  if (!figcraftSpikeEnabled()) return notFound();
  try {
    const actor = await apiActor();
    const { projectId } = await ctx.params;
    if (Number(req.headers.get('content-length') ?? 0) > MAX_DESIGN_FILE_BYTES)
      throw new ValidationError('File too large');
    const bytes = new Uint8Array(await req.arrayBuffer());
    const storage = defaultDesignFileStorage();
    const r = await saveDesignFile(getDb(), actor, storage, { projectId, bytes });
    return NextResponse.json({ size: r.size, storage: storage.kind });
  } catch (e) {
    return apiError(e);
  }
}
