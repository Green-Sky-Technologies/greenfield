/** Interactive turns never stay "streaming" forever (review #8). */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { agentConversations, agentMessages, eq } from '@greenfield/db';
import { MemoryJobRunner } from '@greenfield/sandbox-runner';
import { getProjectChat } from '@/server/services/agent';
import { reapJobs } from '@/server/services/jobs';
import { createProject } from '@/server/services/projects';
import { makeActor, reset, testDb } from './helpers';

const { db, close } = testDb();
afterAll(close);
beforeEach(() => reset(db));

describe('staleness sweep', () => {
  it('settles abandoned interactive replies on read and from the reaper, not job messages', async () => {
    const editor = await makeActor(db, 'editor');
    const project = await createProject(db, editor, { name: 'P' });
    const [conv] = await db
      .insert(agentConversations)
      .values({ workspaceId: editor.workspace.id, projectId: project.id, createdBy: editor.userId })
      .returning();
    const old = new Date(Date.now() - 10 * 60_000);
    const insert = (seq: number, over: Partial<typeof agentMessages.$inferInsert>) =>
      db
        .insert(agentMessages)
        .values({
          conversationId: conv!.id,
          workspaceId: editor.workspace.id,
          seq,
          role: 'assistant',
          content: { v: 1, turns: [] },
          ...over,
        })
        .returning()
        .then((r) => r[0]!);
    const dead = await insert(1, { status: 'streaming', createdAt: old });
    const fresh = await insert(2, { status: 'streaming' });
    const job = await insert(3, {
      status: 'streaming',
      createdAt: old,
      jobId: crypto.randomUUID(),
    });

    const chat = await getProjectChat(db, editor, project.id);
    const byId = new Map(chat.messages.map((m) => [m.id, m]));
    expect(byId.get(dead.id)).toMatchObject({
      status: 'error',
      error: expect.stringMatching(/interrupted/),
    });
    expect(byId.get(fresh.id)!.status).toBe('streaming');
    expect(byId.get(job.id)!.status).toBe('streaming');

    // The cron sweep catches the fresh one once it's old.
    const res = await reapJobs(db, {
      runner: new MemoryJobRunner(),
      now: () => new Date(Date.now() + 10 * 60_000),
    });
    expect(res.settledMessages).toBe(1);
    const [f] = await db.select().from(agentMessages).where(eq(agentMessages.id, fresh.id));
    expect(f!.status).toBe('error');
  });
});
