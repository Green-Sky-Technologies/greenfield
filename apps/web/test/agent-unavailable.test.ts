/**
 * Story 1.2 switched the agent off (AgentUnavailableError, 503). Stories 4.2–4.5 turned it back
 * on (agent-*.test.ts); what's left here: validation, the 503 shape non-agent jobs still use, and
 * stored conversations staying readable.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import { parseSse } from '@greenfield/agent';
import { agentConversations, agentMessages } from '@greenfield/db';
import { apiError } from '@/server/api';
import { cancelMessage, getProjectChat, messageEvents, sendMessage } from '@/server/services/agent';
import { createProject } from '@/server/services/projects';
import { AgentUnavailableError, NotFoundError, ValidationError } from '@/server/services/types';
import { makeActor, reset, testDb } from './helpers';

const { db, close } = testDb();
afterAll(close);
beforeEach(() => reset(db));

async function storedReply(editor: Awaited<ReturnType<typeof makeActor>>, projectId: string) {
  const [conv] = await db
    .insert(agentConversations)
    .values({ workspaceId: editor.workspace.id, projectId, createdBy: editor.userId })
    .returning();
  const [msg] = await db
    .insert(agentMessages)
    .values({
      conversationId: conv!.id,
      workspaceId: editor.workspace.id,
      seq: 1,
      role: 'assistant',
      status: 'streaming',
      content: { v: 1, turns: [{ role: 'assistant', content: [{ type: 'text', text: 'Hi' }] }] },
    })
    .returning();
  return msg!;
}

describe('agent while unavailable', () => {
  it('sendMessage authorizes and validates', async () => {
    const editor = await makeActor(db, 'editor');
    const viewer = await makeActor(db, 'viewer', editor.workspace);
    const outsider = await makeActor(db, 'editor');
    const project = await createProject(db, editor, { name: 'P' });

    await expect(
      sendMessage(db, viewer, { projectId: project.id, prompt: 'hi' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      sendMessage(db, outsider, { projectId: project.id, prompt: 'hi' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendMessage(db, editor, { projectId: project.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await db.select().from(agentMessages)).toEqual([]);
    await expect(
      sendMessage(db, editor, { projectId: project.id, prompt: 'hi', context: 'not a document' }),
    ).rejects.toBeInstanceOf(ValidationError);
    const sent = await sendMessage(db, editor, { projectId: project.id, prompt: 'hi' });
    expect(sent.needsRun).toBe(true);
    expect((await db.select().from(agentMessages)).map((m) => m.status).sort()).toEqual([
      'complete',
      'pending',
    ]);

    const res = apiError(new AgentUnavailableError());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'agent_unavailable' });
  });

  it('stored conversations can still be read, streamed and cancelled', async () => {
    const editor = await makeActor(db, 'editor');
    const project = await createProject(db, editor, { name: 'P' });
    const msg = await storedReply(editor, project.id);

    const chat = await getProjectChat(db, editor, project.id);
    expect(chat.messages.map((m) => m.text)).toEqual(['Hi']);

    expect((await cancelMessage(db, editor, msg.id)).status).toBe('cancelled');
    let text = '';
    for await (const f of messageEvents(db, editor, msg.id, { pollMs: 5 })) text += f;
    expect(parseSse(text).map((e) => e.event)).toEqual(['open', 'message', 'done']);
  });
});
