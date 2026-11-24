/**
 * GET /api/comments?projectId=…[&status=open|resolved]  -> { threads }
 *
 * The project's comment threads as mirrored from its saved file (Story 6.1). People write
 * comments in the editor; they reach the server with the file (PUT /api/projects/:id/file).
 */
import { getDb } from '@greenfield/db';
import { NextResponse, type NextRequest } from 'next/server';
import { apiActor, apiError } from '@/server/api';
import { listComments } from '@/server/services/comments';
import { NotFoundError } from '@/server/services/types';

export async function GET(req: NextRequest) {
  try {
    const actor = await apiActor();
    const projectId = req.nextUrl.searchParams.get('projectId');
    if (!projectId) throw new NotFoundError('Project not found');
    const status = req.nextUrl.searchParams.get('status');
    const threads = await listComments(getDb(), actor, projectId, {
      resolved: status === 'resolved' ? true : status === 'open' ? false : undefined,
    });
    return NextResponse.json({ threads });
  } catch (e) {
    return apiError(e);
  }
}
