/**
 * POST /api/agent/messages  <- { projectId, conversationId?, prompt, model?, selection?, frameId?,
 *                                attachments?, context?, scope? }
 *                           -> { conversationId, userMessageId, messageId, streamUrl }
 * Requires agent:run. The reply runs after the response; follow it on streamUrl (SSE). Its tool
 * calls appear there for the sender's editor tab to run (Story 4.2).
 */
import { getDb } from '@greenfield/db';
import { after, NextResponse } from 'next/server';
import { apiActor, apiError, jsonBody } from '@/server/api';
import { messageStreamUrl, runTurn, sendMessage } from '@/server/services/agent';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const actor = await apiActor();
    const sent = await sendMessage(getDb(), actor, await jsonBody(req, 512 * 1024));
    if (sent.needsRun) after(() => runTurn(getDb(), actor, sent.messageId).then(() => undefined));
    return NextResponse.json({ ...sent, streamUrl: messageStreamUrl(sent.messageId) });
  } catch (e) {
    return apiError(e);
  }
}
