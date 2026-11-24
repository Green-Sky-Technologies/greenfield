/**
 * Client-token route for browser uploads of the design file to private Vercel Blob (Story 3.1).
 *
 * POST /api/projects/:projectId/file/upload <- @vercel/blob/client `upload()`'s token request
 *      (clientPayload: { sessionId }) -> { type, clientToken }
 *
 * The token is issued only to an Editor whose tab holds the project's edit lock, for one fresh
 * save key under the project's prefix, private, at most MAX_DESIGN_FILE_BYTES. The upload itself
 * replaces nothing: the browser then POSTs the key to ../file to commit it, which checks the lock
 * again. No upload-completed callback is used: preview deployments sit behind deployment
 * protection, and the commit has to answer the browser (a refused save must stay unsaved).
 *
 * 501 when no Blob store is configured (the local fallback saves with PUT ../file).
 */
import { getDb } from '@greenfield/db';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse, type NextRequest } from 'next/server';
import { apiActor, apiError, jsonBody } from '@/server/api';
import { authorizeDesignFileUpload } from '@/server/services/design-files';
import { ValidationError } from '@/server/services/types';

type Ctx = RouteContext<'/api/projects/[projectId]/file/upload'>;

function sessionIdFrom(clientPayload: string | null): unknown {
  try {
    return (JSON.parse(clientPayload ?? '') as { sessionId?: unknown }).sessionId;
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const actor = await apiActor();
    const { projectId } = await ctx.params;
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token)
      return NextResponse.json(
        { error: 'not_configured', message: 'No Blob store is configured' },
        { status: 501 },
      );
    const body = (await jsonBody(req, 16 * 1024)) as HandleUploadBody;
    if (body?.type !== 'blob.generate-client-token')
      throw new ValidationError('Only token requests are accepted');
    const r = await handleUpload({
      token,
      request: req,
      body,
      onBeforeGenerateToken: (pathname, clientPayload) =>
        authorizeDesignFileUpload(getDb(), actor, {
          projectId,
          pathname,
          sessionId: sessionIdFrom(clientPayload),
        }),
    });
    return NextResponse.json(r);
  } catch (e) {
    return apiError(e);
  }
}
