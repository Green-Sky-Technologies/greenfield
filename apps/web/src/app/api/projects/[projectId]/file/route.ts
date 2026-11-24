/**
 * The project's design file (a `.figcraft` document), Story 3.1.
 *
 * GET  /api/projects/:projectId/file -> 200 application/octet-stream, streamed
 *                                     | 204 when nothing is saved yet
 *      Both carry x-file-name (the document's name), x-storage and x-upload-prefix.
 * POST /api/projects/:projectId/file <- { key, sessionId } -> { size, storage }
 *      Commit an object the browser uploaded to Blob (./upload) as the document.
 * PUT  /api/projects/:projectId/file <- the raw bytes, x-session-id -> { size, storage }
 *      The local-folder fallback (dev and tests). On Vercel, bodies cap at 4.5 MB, so the browser
 *      uploads to Blob and POSTs the commit instead.
 *
 * Reading needs project:read; saving needs design:edit and the project's edit lock held by the
 * caller's tab (409 otherwise). Bodies are never logged.
 */
import { getDb } from '@greenfield/db';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiActor, apiError, jsonBody } from '@/server/api';
import {
  commitDesignFile,
  defaultDesignFileStorage,
  designFilePrefix,
  getDesignFile,
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
    const db = getDb();
    const file = await getDesignFile(db, actor, storage, { projectId });
    const headers: Record<string, string> = {
      'cache-control': 'no-store',
      'x-storage': storage.kind,
      'x-upload-prefix': designFilePrefix(actor.workspace.id, projectId),
      'x-file-name': encodeURIComponent(file.name),
    };
    const stored = file.key && (await storage.read(file.key));
    if (!stored) return new NextResponse(null, { status: 204, headers });
    // Streamed, so documents bigger than a function's 4.5 MB response body still load.
    return new NextResponse(stored.body, {
      headers: {
        ...headers,
        'content-type': 'application/octet-stream',
        'content-length': String(stored.size),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

const commitBody = z.object({ key: z.string().max(512), sessionId: z.string().max(64) }).strict();

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const actor = await apiActor();
    const { projectId } = await ctx.params;
    const body = commitBody.safeParse(await jsonBody(req, 4096));
    if (!body.success) throw new ValidationError('Expected { key, sessionId }');
    const storage = defaultDesignFileStorage();
    const r = await commitDesignFile(getDb(), actor, storage, { projectId, ...body.data });
    return NextResponse.json({ size: r.size, storage: storage.kind });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const actor = await apiActor();
    const { projectId } = await ctx.params;
    const declared = Number(req.headers.get('content-length') ?? NaN);
    if (declared > MAX_DESIGN_FILE_BYTES) throw new ValidationError('File too large');
    const bytes = new Uint8Array(await req.arrayBuffer());
    // A body cut short (a proxy buffer limit, a dropped connection) must not become the document.
    if (Number.isFinite(declared) && declared !== bytes.byteLength)
      throw new ValidationError('Incomplete upload');
    const storage = defaultDesignFileStorage();
    const r = await saveDesignFile(getDb(), actor, storage, {
      projectId,
      bytes,
      sessionId: req.headers.get('x-session-id'),
    });
    return NextResponse.json({ size: r.size, storage: storage.kind });
  } catch (e) {
    return apiError(e);
  }
}
