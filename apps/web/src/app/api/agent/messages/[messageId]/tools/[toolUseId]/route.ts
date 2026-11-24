/**
 * POST /api/agent/messages/:id/tools/:toolUseId (Story 4.2): the editor tab's side of a tool call.
 *   <- { action: 'claim', clientId }                                  -> 200 { ok: true } | 409
 *   <- { action: 'result', clientId, content, isError, touched }      -> 200 { ok, duplicate?, ready? }
 * A call is claimed once (the idempotency key is the message and tool_use id), so it never runs
 * twice. When the last result of a step arrives, the next model step runs after the response.
 */
import { getDb } from '@greenfield/db';
import { after, NextResponse } from 'next/server';
import { apiActor, apiError, jsonBody } from '@/server/api';
import { runTurn } from '@/server/services/agent';
import { toolCallAction } from '@/server/services/agent/turn';

export const maxDuration = 300;

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/agent/messages/[messageId]/tools/[toolUseId]'>,
) {
  try {
    const actor = await apiActor();
    const { messageId, toolUseId } = await ctx.params;
    // Results may carry a render (PNG, base64).
    const r = await toolCallAction(
      getDb(),
      actor,
      messageId,
      toolUseId,
      await jsonBody(req, 8 << 20),
    );
    if (r.ok && r.ready) after(() => runTurn(getDb(), actor, messageId).then(() => undefined));
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  } catch (e) {
    return apiError(e);
  }
}
