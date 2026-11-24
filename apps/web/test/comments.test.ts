import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import { activity, agentConversations, eq, notifications, projects } from '@greenfield/db';
import {
  createThread,
  linkAgentConversation,
  listMentionableMembers,
  listNotifications,
  listThreads,
  markNotificationsRead,
  replyToThread,
  setThreadStatus,
  updateThreadFallback,
} from '@/server/services/comments';
import { createProject } from '@/server/services/projects';
import { NotFoundError, ValidationError, type Actor } from '@/server/services/types';
import { upsertMember } from '@/server/services/workspaces';
import { makeActor, reset, testDb } from './helpers';

const { db, close } = testDb();
afterAll(close);
beforeEach(() => reset(db));

async function setup() {
  const editor = await makeActor(db, 'editor');
  await upsertMember(db, editor.workspace.id, editor.userId, 'editor');
  const viewer = await makeActor(db, 'viewer', editor.workspace);
  await upsertMember(db, editor.workspace.id, viewer.userId, 'viewer');
  const project = await createProject(db, editor, { name: 'P' });
  // Node and frame ids are the editor's; the server stores them as given.
  return { editor, viewer, project, frameId: '0:1' };
}

const nodeAnchor = (frameId: string, nodeId = '0:7') => ({
  type: 'node' as const,
  frameId,
  nodeId,
});

describe('comment threads', () => {
  it('creates a node-pinned thread and lists it with its comments', async () => {
    const { editor, project, frameId } = await setup();
    const t = await createThread(db, editor, {
      projectId: project.id,
      anchor: nodeAnchor(frameId),
      body: 'Make this pop',
      fallback: { x: 40, y: 60 },
    });
    expect(t.status).toBe('open');
    expect(t.kind).toBe('discussion');
    expect(t.fallback).toEqual({ x: 40, y: 60 });
    expect(t.comments.map((c) => c.body)).toEqual(['Make this pop']);

    const list = await listThreads(db, editor, project.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(t.id);
  });

  it('supports canvas-position threads, replies, resolve and reopen', async () => {
    const { editor, project } = await setup();
    const t = await createThread(db, editor, {
      projectId: project.id,
      anchor: { type: 'canvas', x: 1500, y: 20 },
      body: 'Empty space here',
    });
    expect(t.fallback).toEqual({ x: 1500, y: 20 });
    const replied = await replyToThread(db, editor, t.id, { body: 'Agreed' });
    expect(replied.comments.map((c) => c.body)).toEqual(['Empty space here', 'Agreed']);

    const resolved = await setThreadStatus(db, editor, t.id, 'resolved');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy).toBe(editor.userId);
    expect(await listThreads(db, editor, project.id, { status: 'open' })).toHaveLength(0);
    const reopened = await setThreadStatus(db, editor, t.id, 'open');
    expect(reopened.status).toBe('open');
    expect(reopened.resolvedAt).toBeNull();

    const verbs = (await db.select().from(activity).where(eq(activity.projectId, project.id))).map(
      (r) => r.verb,
    );
    expect(verbs).toEqual(
      expect.arrayContaining([
        'comment.created',
        'comment.replied',
        'comment.resolved',
        'comment.reopened',
      ]),
    );
  });

  it('rejects malformed anchors and empty bodies', async () => {
    const { editor, project, frameId } = await setup();
    await expect(
      createThread(db, editor, {
        projectId: project.id,
        anchor: nodeAnchor(frameId, ''),
        body: 'x',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createThread(db, editor, { projectId: project.id, anchor: nodeAnchor(frameId), body: '  ' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('lets viewers read but never comment, reply or resolve', async () => {
    const { editor, viewer, project, frameId } = await setup();
    const t = await createThread(db, editor, {
      projectId: project.id,
      anchor: nodeAnchor(frameId),
      body: 'Hi',
    });
    expect(await listThreads(db, viewer, project.id)).toHaveLength(1);
    await expect(
      createThread(db, viewer, { projectId: project.id, anchor: nodeAnchor(frameId), body: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(replyToThread(db, viewer, t.id, { body: 'x' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setThreadStatus(db, viewer, t.id, 'resolved')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(updateThreadFallback(db, viewer, t.id, { x: 0, y: 0 })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('reports threads and projects from other workspaces as not found', async () => {
    const { editor, project, frameId } = await setup();
    const t = await createThread(db, editor, {
      projectId: project.id,
      anchor: nodeAnchor(frameId),
      body: 'Hi',
    });
    const outsider = await makeActor(db, 'editor');
    await expect(listThreads(db, outsider, project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(replyToThread(db, outsider, t.id, { body: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(setThreadStatus(db, outsider, t.id, 'resolved')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      createThread(db, outsider, {
        projectId: project.id,
        anchor: nodeAnchor(frameId),
        body: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(replyToThread(db, outsider, 'not-a-uuid', { body: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('creates notifications for mentioned members only', async () => {
    const { editor, viewer, project, frameId } = await setup();
    const outsider = await makeActor(db, 'editor');
    await upsertMember(db, outsider.workspace.id, outsider.userId, 'editor');

    const t = await createThread(db, editor, {
      projectId: project.id,
      anchor: nodeAnchor(frameId),
      body: '@viewer look',
      mentions: [viewer.userId, outsider.userId, editor.userId],
    });
    expect(t.comments[0]!.mentions).toEqual([viewer.userId]);

    const mine = await listNotifications(db, viewer);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.kind).toBe('mention');
    expect(mine[0]!.data).toMatchObject({ threadId: t.id, by: editor.userId });
    expect(await listNotifications(db, editor)).toHaveLength(0);
    expect(await listNotifications(db, outsider)).toHaveLength(0);

    await replyToThread(db, editor, t.id, { body: 'again', mentions: [viewer.userId] });
    expect(await listNotifications(db, viewer, { unreadOnly: true })).toHaveLength(2);

    // Someone else can't mark my notifications read.
    expect((await markNotificationsRead(db, editor, 'all')).updated).toBe(0);
    expect((await markNotificationsRead(db, viewer, [mine[0]!.id])).updated).toBe(1);
    expect(await listNotifications(db, viewer, { unreadOnly: true })).toHaveLength(1);
    expect((await markNotificationsRead(db, viewer, 'all')).updated).toBe(1);
    const rows = await db.select().from(notifications);
    expect(rows.every((r) => r.readAt !== null)).toBe(true);
  });

  it('lists mentionable members of the caller workspace only', async () => {
    const { editor, viewer } = await setup();
    const outsider = await makeActor(db, 'editor');
    await upsertMember(db, outsider.workspace.id, outsider.userId, 'editor');
    const ids = (await listMentionableMembers(db, editor)).map((m) => m.userId).sort();
    expect(ids).toEqual([editor.userId, viewer.userId].sort());
  });

  it('links agent conversations only to ask-agent threads', async () => {
    const { editor, project, frameId } = await setup();
    const discussion = await createThread(db, editor, {
      projectId: project.id,
      anchor: nodeAnchor(frameId),
      body: 'Hi',
    });
    const ask = await createThread(db, editor, {
      projectId: project.id,
      anchor: nodeAnchor(frameId),
      body: 'Make the card wider',
      kind: 'agent_request',
    });
    expect(ask.kind).toBe('agent_request');
    const conversation = async (a: Actor, projectId: string) =>
      (
        await db
          .insert(agentConversations)
          .values({ workspaceId: a.workspace.id, projectId, createdBy: a.userId })
          .returning({ id: agentConversations.id })
      )[0]!.id;
    const cid = await conversation(editor, project.id);
    expect((await linkAgentConversation(db, editor, ask.id, cid)).agentConversationId).toBe(cid);
    await expect(linkAgentConversation(db, editor, discussion.id, cid)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(linkAgentConversation(db, editor, ask.id, 'nope')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('only links conversations that exist in the same workspace and project', async () => {
    const { editor, project, frameId } = await setup();
    const ask = await createThread(db, editor, {
      projectId: project.id,
      anchor: nodeAnchor(frameId),
      body: 'Wider',
      kind: 'agent_request',
    });
    // Unknown id.
    await expect(
      linkAgentConversation(db, editor, ask.id, crypto.randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
    // A conversation of another project in the same workspace.
    const other = await createProject(db, editor, { name: 'Other' });
    const [otherConv] = await db
      .insert(agentConversations)
      .values({ workspaceId: editor.workspace.id, projectId: other.id, createdBy: editor.userId })
      .returning();
    await expect(linkAgentConversation(db, editor, ask.id, otherConv!.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // A conversation from another workspace.
    const outsider = await makeActor(db, 'editor');
    const foreignProject = await createProject(db, outsider, { name: 'F' });
    const [foreign] = await db
      .insert(agentConversations)
      .values({
        workspaceId: outsider.workspace.id,
        projectId: foreignProject.id,
        createdBy: outsider.userId,
      })
      .returning();
    await expect(linkAgentConversation(db, editor, ask.id, foreign!.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const [after] = await listThreads(db, editor, project.id);
    expect(after!.agentConversationId).toBeNull();
  });

  it('blocks comment changes (and mention notifications) in archived projects', async () => {
    const { editor, viewer, project, frameId } = await setup();
    const t = await createThread(db, editor, {
      projectId: project.id,
      anchor: nodeAnchor(frameId),
      body: 'Before archiving',
      kind: 'agent_request',
    });
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, project.id));

    const archived = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(ValidationError);
    await archived(
      createThread(db, editor, { projectId: project.id, anchor: nodeAnchor(frameId), body: 'x' }),
    );
    await archived(replyToThread(db, editor, t.id, { body: '@v', mentions: [viewer.userId] }));
    await archived(setThreadStatus(db, editor, t.id, 'resolved'));
    await archived(updateThreadFallback(db, editor, t.id, { x: 1, y: 1 }));
    await archived(linkAgentConversation(db, editor, t.id, crypto.randomUUID()));
    expect(await listNotifications(db, viewer)).toHaveLength(0);
    // Reading still works.
    const [still] = await listThreads(db, viewer, project.id);
    expect(still!.status).toBe('open');
    expect(still!.comments).toHaveLength(1);
  });

  it('updates the remembered fallback position', async () => {
    const { editor, project, frameId } = await setup();
    const t = await createThread(db, editor, {
      projectId: project.id,
      anchor: nodeAnchor(frameId),
      body: 'Hi',
    });
    await updateThreadFallback(db, editor, t.id, { x: 12, y: 34 });
    const [after] = await listThreads(db, editor, project.id);
    expect(after!.fallback).toEqual({ x: 12, y: 34 });
    await expect(updateThreadFallback(db, editor, t.id, { x: 'a' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
