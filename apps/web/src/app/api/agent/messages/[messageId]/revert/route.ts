/**
 * POST /api/agent/messages/:id/revert <- { how: 'undo' | 'batch' } -> MessageView
 * Marks a reply's changes as reverted after the tab ran `planRevert` ("Undo all", Story 4.7).
 */
import { getDb } from '@greenfield/db';
import { NextResponse } from 'next/server';
import { apiActor, apiError, jsonBody } from '@/server/api';
import { revertTurn } from '@/server/services/agent';

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/agent/messages/[messageId]/revert'>,
) {
  try {
    const actor = await apiActor();
    const { messageId } = await ctx.params;
    return NextResponse.json(
      await revertTurn(getDb(), actor, messageId, await jsonBody(req, 1024)),
    );
  } catch (e) {
    return apiError(e);
  }
}
