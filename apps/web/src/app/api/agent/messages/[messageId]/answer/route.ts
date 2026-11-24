/**
 * POST /api/agent/messages/:id/answer <- { answers: [{ questionId, optionIds, other? }], skip?, model? }
 *                                     -> { conversationId, userMessageId, messageId, streamUrl }
 * Answers the follow-up questions an agent reply asked. Requires agent:run. Answers 503
 * `agent_unavailable` until Epic 4 brings the FigCraft tools.
 */
import { getDb } from '@greenfield/db';
import { NextResponse } from 'next/server';
import { apiActor, apiError, jsonBody } from '@/server/api';
import { answerQuestions, messageStreamUrl } from '@/server/services/agent';

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/agent/messages/[messageId]/answer'>,
) {
  try {
    const actor = await apiActor();
    const { messageId } = await ctx.params;
    const sent = await answerQuestions(getDb(), actor, messageId, await jsonBody(req, 64 * 1024));
    return NextResponse.json({ ...sent, streamUrl: messageStreamUrl(sent.messageId) });
  } catch (e) {
    return apiError(e);
  }
}
