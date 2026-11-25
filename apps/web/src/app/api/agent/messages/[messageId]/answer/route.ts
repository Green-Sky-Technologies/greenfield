/**
 * POST /api/agent/messages/:id/answer
 *   <- { answers: [{ questionId, optionIds, other? }], skip?, model?, context?, scope? }
 *   -> { conversationId, userMessageId, messageId, streamUrl }
 * Answers (or skips) the follow-up questions an agent reply asked (Story 4.4), then runs the
 * reply that continues the request, like a new message. Requires agent:run.
 */
import { getDb } from '@greenfield/db';
import { after, NextResponse } from 'next/server';
import { apiActor, apiError, jsonBody } from '@/server/api';
import { answerQuestions, messageStreamUrl, runTurn } from '@/server/services/agent';

export const maxDuration = 300;

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/agent/messages/[messageId]/answer'>,
) {
  try {
    const actor = await apiActor();
    const { messageId } = await ctx.params;
    const sent = await answerQuestions(getDb(), actor, messageId, await jsonBody(req, 512 * 1024));
    after(() => runTurn(getDb(), actor, sent.messageId).then(() => undefined));
    return NextResponse.json({ ...sent, streamUrl: messageStreamUrl(sent.messageId) });
  } catch (e) {
    return apiError(e);
  }
}
