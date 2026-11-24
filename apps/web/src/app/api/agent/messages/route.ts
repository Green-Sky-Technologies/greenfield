/**
 * POST /api/agent/messages  <- { projectId, conversationId?, prompt, model?, selection?, frameId?, attachments? }
 *                           -> { conversationId, userMessageId, messageId, streamUrl }
 * Requires agent:run. Answers 503 `agent_unavailable` until Epic 4 brings the FigCraft tools.
 */
import { getDb } from '@greenfield/db';
import { NextResponse } from 'next/server';
import { apiActor, apiError, jsonBody } from '@/server/api';
import { messageStreamUrl, sendMessage } from '@/server/services/agent';

export async function POST(req: Request) {
  try {
    const actor = await apiActor();
    const sent = await sendMessage(getDb(), actor, await jsonBody(req, 512 * 1024));
    return NextResponse.json({ ...sent, streamUrl: messageStreamUrl(sent.messageId) });
  } catch (e) {
    return apiError(e);
  }
}
