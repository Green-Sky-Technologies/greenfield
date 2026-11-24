import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import { editLocks, eq, files } from '@greenfield/db';
import {
  authorizeDesignFileUpload,
  commitDesignFile,
  copyDesignFile,
  designFilePrefix,
  loadDesignFile,
  localFsStorage,
  newDesignFileKey,
  saveDesignFile,
} from '@/server/services/design-files';
import { acquireLock, heartbeat, releaseLock, requestControl } from '@/server/services/locks';
import { createProject, duplicateProject, setProjectArchived } from '@/server/services/projects';
import { upsertMember } from '@/server/services/workspaces';
import { ConflictError, NotFoundError, ValidationError, type Actor } from '@/server/services/types';
import { makeActor, reset, testDb } from './helpers';

const { db, close } = testDb();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-files-'));
const storage = localFsStorage(dir);
afterAll(async () => {
  await close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => reset(db));

const S1 = 'session-aaaa-1111';
const S2 = 'session-bbbb-2222';
const bytes = (...b: number[]) => new Uint8Array(b);
const load = async (actor: Actor, projectId: string) => [
  ...((await loadDesignFile(db, actor, storage, { projectId }))?.bytes ?? []),
];
/** Objects stored under the project's prefix. */
const objects = (actor: Actor, projectId: string) => {
  const d = path.join(dir, designFilePrefix(actor.workspace.id, projectId));
  return fs.existsSync(d) ? fs.readdirSync(d) : [];
};

async function setup() {
  const editor = await makeActor(db, 'editor');
  const other = await makeActor(db, 'editor', editor.workspace);
  const viewer = await makeActor(db, 'viewer', editor.workspace);
  const outsider = await makeActor(db, 'admin');
  for (const a of [editor, other, viewer]) await upsertMember(db, a.workspace.id, a.userId, a.role);
  const p = await createProject(db, editor, { name: 'Poster: v1' });
  await acquireLock(db, editor, p.id, { sessionId: S1 });
  return { editor, other, viewer, outsider, p };
}

/** Age the lock past its 2-minute TTL, as if the holder's tab died. */
const expire = (projectId: string) =>
  db
    .update(editLocks)
    .set({ heartbeatAt: new Date(Date.now() - 3 * 60 * 1000) })
    .where(eq(editLocks.projectId, projectId));

describe('design files (Story 3.1)', () => {
  it('saves and loads the project document, scoped to the workspace', async () => {
    const { editor, viewer, outsider, p } = await setup();
    expect(await loadDesignFile(db, editor, storage, { projectId: p.id })).toBeNull();

    await saveDesignFile(db, editor, storage, {
      projectId: p.id,
      bytes: bytes(1, 2, 3),
      sessionId: S1,
    });
    const file = await loadDesignFile(db, viewer, storage, { projectId: p.id });
    expect(file?.name).toBe('Poster  v1.figcraft');
    expect([...file!.bytes]).toEqual([1, 2, 3]);
    const [row] = await db.select().from(files).where(eq(files.projectId, p.id));
    expect(row).toMatchObject({
      size: 3,
      updatedBy: editor.userId,
      workspaceId: editor.workspace.id,
    });

    await expect(
      saveDesignFile(db, viewer, storage, { projectId: p.id, bytes: bytes(9), sessionId: S1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(loadDesignFile(db, outsider, storage, { projectId: p.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      saveDesignFile(db, outsider, storage, { projectId: p.id, bytes: bytes(9), sessionId: S1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(), sessionId: S1 }),
    ).rejects.toBeInstanceOf(ValidationError);

    await setProjectArchived(db, editor, p.id, true);
    await expect(
      saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(9), sessionId: S1 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await load(editor, p.id)).toEqual([1, 2, 3]);
  });

  it('each save replaces the document and removes the previous object', async () => {
    const { editor, p } = await setup();
    await saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(1), sessionId: S1 });
    await saveDesignFile(db, editor, storage, {
      projectId: p.id,
      bytes: bytes(2, 2),
      sessionId: S1,
    });
    expect(await load(editor, p.id)).toEqual([2, 2]);
    expect(objects(editor, p.id)).toHaveLength(1);
  });

  it('refuses a save from a stale lock instead of merging it', async () => {
    const { editor, other, p } = await setup();
    await saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(1), sessionId: S1 });
    const save = (actor: Actor, sessionId: string, b: number) =>
      saveDesignFile(db, actor, storage, { projectId: p.id, bytes: bytes(b), sessionId });

    // Without the lock (another editor, or a session that never had it).
    await expect(save(other, S2, 7)).rejects.toBeInstanceOf(ConflictError);
    await expect(save(editor, S2, 7)).rejects.toBeInstanceOf(ConflictError);

    // The holder's tab went to sleep: the lock expired, and another editor took over and saved.
    await expire(p.id);
    await expect(save(editor, S1, 8)).rejects.toBeInstanceOf(ConflictError);
    expect((await acquireLock(db, other, p.id, { sessionId: S2 })).acquired).toBe(true);
    await save(other, S2, 2);
    // The sleeping tab wakes: its heartbeat doesn't revive the lock, and its save is refused.
    await heartbeat(db, editor, p.id, { sessionId: S1 });
    await expect(save(editor, S1, 9)).rejects.toBeInstanceOf(ConflictError);
    expect(await load(editor, p.id)).toEqual([2]);
    expect(objects(editor, p.id)).toHaveLength(1); // refused uploads leave nothing behind

    // The other editor leaves; the lock is free, but the stale tab still doesn't hold it.
    await releaseLock(db, other, p.id, { sessionId: S2, leave: true });
    await expect(save(editor, S1, 9)).rejects.toBeInstanceOf(ConflictError);
    expect(await load(editor, p.id)).toEqual([2]);
  });

  it('a second tab of the same user takes over saving from the first', async () => {
    const { editor, p } = await setup();
    await acquireLock(db, editor, p.id, { sessionId: S2 });
    await expect(
      saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(1), sessionId: S1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(2), sessionId: S2 });
    expect(await load(editor, p.id)).toEqual([2]);
  });

  it('after a hand-off, the receiving tab saves and the previous holder is refused', async () => {
    const { editor, other, p } = await setup();
    await heartbeat(db, other, p.id, { sessionId: S2 }); // the requester has the project open
    await requestControl(db, other, p.id, { sessionId: S2 });
    await releaseLock(db, editor, p.id, { sessionId: S1, handoff: true });
    await heartbeat(db, other, p.id, { sessionId: S2 }); // adopts the handed-off lock
    await saveDesignFile(db, other, storage, { projectId: p.id, bytes: bytes(5), sessionId: S2 });
    await expect(
      saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(6), sessionId: S1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await load(editor, p.id)).toEqual([5]);
  });

  it('browser uploads: a token only for the lock holder and a fresh key of the project', async () => {
    const { editor, other, viewer, outsider, p } = await setup();
    const key = newDesignFileKey(editor.workspace.id, p.id);
    const authorize = (actor: Actor, pathname: unknown, sessionId: unknown = S1) =>
      authorizeDesignFileUpload(db, actor, { projectId: p.id, pathname, sessionId });

    const t = await authorize(editor, key);
    expect(t).toMatchObject({
      allowedContentTypes: ['application/octet-stream'],
      maximumSizeInBytes: 64 * 1024 * 1024,
      allowOverwrite: false,
      addRandomSuffix: false,
    });
    await expect(authorize(viewer, key)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(authorize(other, key, S2)).rejects.toBeInstanceOf(ConflictError);
    await expect(authorize(outsider, key)).rejects.toBeInstanceOf(NotFoundError);
    await expect(authorize(editor, key, 'x')).rejects.toBeInstanceOf(ValidationError);
    for (const bad of [
      `${designFilePrefix(outsider.workspace.id, p.id)}abcdefgh-1234.figcraft`, // other workspace
      `${designFilePrefix(editor.workspace.id, p.id)}document.figcraft`, // the legacy key
      `${designFilePrefix(editor.workspace.id, p.id)}../x/abcdefgh-1234.figcraft`,
      `${designFilePrefix(editor.workspace.id, p.id)}abcdefgh-1234.png`,
      42,
    ])
      await expect(authorize(editor, bad)).rejects.toBeInstanceOf(ValidationError);
    await expire(p.id);
    await expect(authorize(editor, key)).rejects.toBeInstanceOf(ConflictError);
  });

  it('commits an uploaded object; a stale-lock commit deletes it and keeps the document', async () => {
    const { editor, p } = await setup();
    const commit = (key: string, sessionId = S1) =>
      commitDesignFile(db, editor, storage, { projectId: p.id, key, sessionId });

    const missing = newDesignFileKey(editor.workspace.id, p.id);
    await expect(commit(missing)).rejects.toBeInstanceOf(ValidationError);

    const first = newDesignFileKey(editor.workspace.id, p.id);
    await storage.put(first, bytes(1, 1));
    expect(await commit(first)).toEqual({ size: 2 });
    expect(await commit(first)).toEqual({ size: 2 }); // a retried commit is harmless
    expect(await load(editor, p.id)).toEqual([1, 1]);

    const late = newDesignFileKey(editor.workspace.id, p.id);
    await storage.put(late, bytes(3));
    await expire(p.id); // the lock went stale while the upload ran
    await expect(commit(late)).rejects.toBeInstanceOf(ConflictError);
    expect(await storage.head(late)).toBeNull();
    expect(await load(editor, p.id)).toEqual([1, 1]);
    // A retry of the commit that won, after the lock went stale: refused, document kept.
    await expect(commit(first)).rejects.toBeInstanceOf(ConflictError);
    expect(await load(editor, p.id)).toEqual([1, 1]);
  });

  it('a 20 MB document saves and loads intact', async () => {
    const { editor, p } = await setup();
    const big = new Uint8Array(20 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 4093) big[i] = i % 251;
    await saveDesignFile(db, editor, storage, { projectId: p.id, bytes: big, sessionId: S1 });
    const back = (await loadDesignFile(db, editor, storage, { projectId: p.id }))!.bytes;
    expect(back.byteLength).toBe(big.byteLength);
    expect(Buffer.from(back).equals(Buffer.from(big))).toBe(true);
  });

  it('reads a document saved before the files table (Story 1.2 key) until the next save', async () => {
    const { editor, p } = await setup();
    const legacy = `${designFilePrefix(editor.workspace.id, p.id)}document.figcraft`;
    await storage.put(legacy, bytes(4, 4));
    expect(await load(editor, p.id)).toEqual([4, 4]);
    await saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(5), sessionId: S1 });
    expect(await load(editor, p.id)).toEqual([5]);
    expect(await storage.head(legacy)).toBeNull();
  });

  it('copies the document when a project is duplicated, within the workspace only', async () => {
    const { editor, viewer, outsider, p } = await setup();
    const empty = await createProject(db, editor, { name: 'Empty' });
    await saveDesignFile(db, editor, storage, {
      projectId: p.id,
      bytes: bytes(4, 5),
      sessionId: S1,
    });

    const copy = await duplicateProject(db, editor, p.id);
    await copyDesignFile(db, editor, storage, { fromProjectId: p.id, toProjectId: copy.id });
    expect(await load(editor, copy.id)).toEqual([4, 5]);
    // The copy is its own object: saving the original doesn't change it.
    await saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(6), sessionId: S1 });
    expect(await load(editor, copy.id)).toEqual([4, 5]);

    // Nothing saved yet: nothing to copy.
    const copy2 = await duplicateProject(db, editor, empty.id);
    await copyDesignFile(db, editor, storage, { fromProjectId: empty.id, toProjectId: copy2.id });
    expect(await loadDesignFile(db, editor, storage, { projectId: copy2.id })).toBeNull();

    await expect(
      copyDesignFile(db, viewer, storage, { fromProjectId: p.id, toProjectId: copy.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const theirs = await createProject(db, outsider, { name: 'Theirs' });
    await expect(
      copyDesignFile(db, outsider, storage, { fromProjectId: p.id, toProjectId: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('local storage refuses keys outside its directory', async () => {
    await expect(storage.put('../escape', bytes(1))).rejects.toThrow('Invalid storage key');
  });
});
