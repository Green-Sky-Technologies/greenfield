/**
 * Story 1.2: the agent's tools and jobs were built on the HTML model, so running the agent fails
 * clearly (AgentUnavailableError, 503) until Epic 4. Stored conversations stay readable.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import { parseSse } from '@greenfield/agent';
import { agentConversations, agentMessages, eq, jobs } from '@greenfield/db';
import { recordingSandboxApi } from '@greenfield/sandbox-runner';
import { apiError } from '@/server/api';
import {
  answerQuestions,
  cancelMessage,
  getProjectChat,
  messageEvents,
  sendMessage,
} from '@/server/services/agent';
import { jobRunner } from '@/server/services/agent/runner';
import { createJob, startJob } from '@/server/services/jobs';
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
  it('sendMessage authorizes and validates, then reports the agent as unavailable', async () => {
    const editor = await makeActor(db, 'editor');
    const viewer = await makeActor(db, 'viewer', editor.workspace);
    const outsider = await makeActor(db, 'editor');
    const project = await createProject(db, editor, { name: 'P' });

    await expect(
      sendMessage(db, editor, { projectId: project.id, prompt: 'hi' }),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
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

    const res = apiError(new AgentUnavailableError());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'agent_unavailable' });
  });

  it('answerQuestions is unavailable too', async () => {
    const editor = await makeActor(db, 'editor');
    const project = await createProject(db, editor, { name: 'P' });
    const msg = await storedReply(editor, project.id);
    await expect(
      answerQuestions(db, editor, msg.id, { answers: [], skip: true }),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
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

  it('a job started through the app runner fails at once, without retries', async () => {
    const editor = await makeActor(db, 'editor');
    const project = await createProject(db, editor, { name: 'P' });
    const job = await createJob(db, editor, {
      kind: 'generate',
      projectId: project.id,
      input: { prompt: 'A page' },
    });
    // The app's runner over an in-memory sandbox: preparing the spec throws.
    const api = recordingSandboxApi();
    const runner = jobRunner({ api });
    const after = await startJob(db, job.id, { runner });
    expect(after).toMatchObject({ status: 'failed' });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row!.error).toContain('not available');
    expect(api.sandboxes.size).toBe(0);
  });
});
