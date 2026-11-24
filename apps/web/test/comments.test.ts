/**
 * Story 6.1: comments live in the `.figcraft` file and every save mirrors them into
 * `comment_index`. Saves go through the real service with real `.figcraft` bytes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import { listComments, mirrorFileComments } from '@/server/services/comments';
import {
  commitDesignFile,
  localFsStorage,
  newDesignFileKey,
  saveDesignFile,
} from '@/server/services/design-files';
import { acquireLock } from '@/server/services/locks';
import { createProject, setProjectArchived } from '@/server/services/projects';
import { NotFoundError, ValidationError } from '@/server/services/types';
import { upsertMember, upsertUser } from '@/server/services/workspaces';
import { figcraftFile, type StoredThread } from './fakes/figcraft';
import { makeActor, reset, testDb } from './helpers';

const { db, close } = testDb();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comments-'));
const storage = localFsStorage(dir);
afterAll(async () => {
  await close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => reset(db));

const S1 = 'session-1';
const T0 = 1_795_000_000; // Unix seconds, as the editor stores them

async function setup() {
  const editor = await makeActor(db, 'editor');
  const viewer = await makeActor(db, 'viewer', editor.workspace);
  const outsider = await makeActor(db, 'admin');
  await upsertUser(db, { id: editor.userId, name: 'Ada Lovelace' });
  await upsertMember(db, editor.workspace.id, editor.userId, 'editor');
  const project = await createProject(db, editor, { name: 'Landing' });
  await acquireLock(db, editor, project.id, { sessionId: S1 });
  const save = (threads: StoredThread[], actor = editor, projectId = project.id) =>
    saveDesignFile(db, actor, storage, { projectId, bytes: figcraftFile(threads), sessionId: S1 });
  return { editor, viewer, outsider, project, save };
}

const heading: StoredThread = {
  id: 1,
  anchor: 3,
  author: 'Ada Lovelace',
  text: 'Tighten this heading @Bob',
  created: T0,
};

describe('comment mirror', () => {
  it('create: a saved thread is mirrored with its anchor, author and member id', async () => {
    const { editor, viewer, project, save } = await setup();
    expect(
      await save([heading, { id: 2, author: 'Claude', text: 'Free', created: T0 + 5 }]),
    ).toEqual({ size: expect.any(Number), comments: 2 });
    const threads = await listComments(db, editor, project.id);
    expect(threads).toEqual([
      {
        threadId: 1,
        pageId: 1,
        nodeId: 3,
        author: 'Ada Lovelace',
        authorId: editor.userId,
        body: 'Tighten this heading @Bob',
        replies: [],
        resolved: false,
        createdAt: new Date(T0 * 1000),
        updatedAt: new Date(T0 * 1000),
      },
      expect.objectContaining({ threadId: 2, nodeId: null, author: 'Claude', authorId: null }),
    ]);
    // Viewers can read the mirror (project:read).
    expect(await listComments(db, viewer, project.id)).toHaveLength(2);
  });

  it('reply and edit: replies are mirrored and move updatedAt', async () => {
    const { editor, project, save } = await setup();
    await save([heading]);
    await save([
      {
        ...heading,
        replies: [{ author: 'Bob', text: 'On it', created: T0 + 60, edited: T0 + 90 }],
      },
    ]);
    const [t] = await listComments(db, editor, project.id);
    expect(t!.replies).toEqual([
      {
        author: 'Bob',
        authorId: null,
        text: 'On it',
        createdAt: new Date((T0 + 60) * 1000).toISOString(),
        editedAt: new Date((T0 + 90) * 1000).toISOString(),
      },
    ]);
    expect(t!.updatedAt).toEqual(new Date((T0 + 90) * 1000));
    expect(t!.createdAt).toEqual(new Date(T0 * 1000));
  });

  it('resolve: the flag follows the file, and status filters', async () => {
    const { editor, project, save } = await setup();
    const other = { id: 2, author: 'Ada Lovelace', text: 'Other', created: T0 + 1 };
    await save([heading, other]);
    await save([{ ...heading, resolved: true }, other]);
    expect(
      (await listComments(db, editor, project.id, { resolved: true })).map((t) => t.threadId),
    ).toEqual([1]);
    expect(
      (await listComments(db, editor, project.id, { resolved: false })).map((t) => t.threadId),
    ).toEqual([2]);
    await save([heading, other]); // reopened
    expect(await listComments(db, editor, project.id, { resolved: true })).toEqual([]);
  });

  it('delete: threads gone from the file are removed; a reused id is a new thread', async () => {
    const { editor, project, save } = await setup();
    await save([
      heading,
      {
        id: 2,
        author: 'Ada Lovelace',
        text: 'Old',
        created: T0 + 1,
        replies: [{ author: 'Bob', text: 'r', created: T0 + 2 }],
      },
    ]);
    await save([heading]);
    expect((await listComments(db, editor, project.id)).map((t) => t.threadId)).toEqual([1]);
    // The editor reuses id 2 for the next thread.
    await save([heading, { id: 2, author: 'Bob', text: 'New', created: T0 + 100 }]);
    expect((await listComments(db, editor, project.id))[1]).toMatchObject({
      threadId: 2,
      author: 'Bob',
      body: 'New',
      replies: [],
      createdAt: new Date((T0 + 100) * 1000),
    });
    await save([]);
    expect(await listComments(db, editor, project.id)).toEqual([]);
  });

  it('matches authors to members only by a unique name', async () => {
    const { editor, save, project } = await setup();
    const twin = await makeActor(db, 'editor', editor.workspace);
    await upsertUser(db, { id: twin.userId, name: 'Grace' });
    await upsertMember(db, editor.workspace.id, twin.userId, 'editor');
    const third = await makeActor(db, 'editor', editor.workspace);
    await upsertUser(db, { id: third.userId, name: 'Grace' });
    await upsertMember(db, editor.workspace.id, third.userId, 'editor');
    // A member of another workspace with the same name doesn't count either.
    const outsider = await makeActor(db, 'editor');
    await upsertUser(db, { id: outsider.userId, name: 'Linus' });
    await upsertMember(db, outsider.workspace.id, outsider.userId, 'editor');

    await save([
      { id: 1, author: 'Grace', text: 'a', created: T0 },
      { id: 2, author: 'Linus', text: 'b', created: T0 + 1 },
    ]);
    expect((await listComments(db, editor, project.id)).map((t) => t.authorId)).toEqual([
      null,
      null,
    ]);
  });

  it("mirrors the editor's own saved file", async () => {
    const { editor, project } = await setup();
    // Saved by the pinned editor (packages/bridge/e2e/comments.spec.ts makes the same kind).
    const bytes = new Uint8Array(
      fs.readFileSync(
        new URL('../../../packages/bridge/test/fixtures/comments.figcraft', import.meta.url),
      ),
    );
    expect(
      await saveDesignFile(db, editor, storage, { projectId: project.id, bytes, sessionId: S1 }),
    ).toEqual({
      size: bytes.byteLength,
      comments: 2,
    });
    expect(await listComments(db, editor, project.id)).toEqual([
      expect.objectContaining({
        threadId: 1,
        nodeId: 3,
        author: 'Ada',
        body: 'Hello @Bob',
        replies: [expect.objectContaining({ author: 'Bob', text: 'edited reply' })],
      }),
      expect.objectContaining({ threadId: 2, nodeId: null, author: 'Claude', body: 'x' }),
    ]);
  });

  it('mirrors a document uploaded to Blob when it is committed', async () => {
    const { editor, project } = await setup();
    const key = newDesignFileKey(editor.workspace.id, project.id);
    await storage.put(key, figcraftFile([heading]));
    expect(
      await commitDesignFile(db, editor, storage, { projectId: project.id, key, sessionId: S1 }),
    ).toMatchObject({ comments: 1 });
    expect((await listComments(db, editor, project.id)).map((t) => t.threadId)).toEqual([1]);
  });

  it('tolerates duplicate and out-of-range ids', async () => {
    const { editor, project, save } = await setup();
    expect(
      await save([
        { ...heading, text: 'first' },
        { ...heading, text: 'second' },
        { id: 2 ** 40, author: 'A', text: 'huge', created: T0 },
      ]),
    ).toMatchObject({ comments: 1 });
    expect((await listComments(db, editor, project.id)).map((t) => t.body)).toEqual(['second']);
  });

  it('bytes that are not a .figcraft document leave the mirror alone', async () => {
    const { editor, project, save } = await setup();
    await save([heading]);
    const r = await saveDesignFile(db, editor, storage, {
      projectId: project.id,
      bytes: new Uint8Array([1, 2, 3]),
      sessionId: S1,
    });
    expect(r).toEqual({ size: 3, comments: null });
    expect(await listComments(db, editor, project.id)).toHaveLength(1);
  });

  it('cross-workspace: reads and writes are NotFound, and nothing leaks', async () => {
    const { editor, outsider, project, save } = await setup();
    await save([heading]);
    await expect(listComments(db, outsider, project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(save([], outsider)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      mirrorFileComments(db, outsider, { projectId: project.id, bytes: figcraftFile([]) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // The outsider's own project with the same thread id doesn't touch ours.
    const theirs = await createProject(db, outsider, { name: 'Theirs' });
    await acquireLock(db, outsider, theirs.id, { sessionId: S1 });
    await save([{ id: 1, author: 'Mallory', text: 'mine', created: T0 }], outsider, theirs.id);
    expect(await listComments(db, editor, project.id)).toEqual([
      expect.objectContaining({ threadId: 1, author: 'Ada Lovelace' }),
    ]);
    expect(await listComments(db, outsider, theirs.id)).toEqual([
      expect.objectContaining({ threadId: 1, author: 'Mallory' }),
    ]);
  });

  it('viewers cannot write comments (view-only role); archived projects refuse saves', async () => {
    const { editor, viewer, project, save } = await setup();
    await expect(save([heading], viewer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      mirrorFileComments(db, viewer, { projectId: project.id, bytes: figcraftFile([heading]) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await setProjectArchived(db, editor, project.id, true);
    await expect(save([heading])).rejects.toBeInstanceOf(ValidationError);
    await expect(
      mirrorFileComments(db, editor, { projectId: project.id, bytes: figcraftFile([heading]) }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await listComments(db, viewer, project.id)).toEqual([]);
  });
});
