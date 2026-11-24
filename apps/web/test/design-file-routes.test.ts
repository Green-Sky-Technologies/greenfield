/**
 * Design file route handlers (Story 3.1) against the real services and test database, with the
 * local storage fallback. Clerk is replaced by a settable actor.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getPayloadFromClientToken } from '@vercel/blob/client';
import type { Actor } from '@/server/services/types';

const h = vi.hoisted(() => ({ actor: null as Actor | null, db: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/server/context', () => ({ getActor: async () => h.actor, db: () => h.db }));
vi.mock('@greenfield/db', async (orig) => ({
  ...(await orig<typeof import('@greenfield/db')>()),
  getDb: () => h.db,
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-file-routes-'));
vi.stubEnv('GREENFIELD_LOCAL_BLOB_DIR', dir);
vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');

const { makeActor, reset, testDb } = await import('./helpers');
const { createProject } = await import('@/server/services/projects');
const { acquireLock } = await import('@/server/services/locks');
const { upsertMember } = await import('@/server/services/workspaces');
const { localFsStorage, newDesignFileKey } = await import('@/server/services/design-files');
const file = await import('@/app/api/projects/[projectId]/file/route');
const upload = await import('@/app/api/projects/[projectId]/file/upload/route');

const { db, close } = testDb();
h.db = db;
afterAll(async () => {
  await close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => reset(db));

const S1 = 'session-aaaa-1111';
const ctx = (projectId: string) => ({ params: Promise.resolve({ projectId }) });
const req = (init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(new URL('/x', 'http://localhost'), init);
const put = (b: Uint8Array, headers: Record<string, string> = {}) =>
  req({
    method: 'PUT',
    headers: { 'x-session-id': S1, 'content-length': String(b.byteLength), ...headers },
    body: Buffer.from(b),
  });

async function setup() {
  const editor = await makeActor(db, 'editor');
  const other = await makeActor(db, 'editor', editor.workspace);
  for (const a of [editor, other]) await upsertMember(db, a.workspace.id, a.userId, a.role);
  const p = await createProject(db, editor, { name: 'Poster' });
  await acquireLock(db, editor, p.id, { sessionId: S1 });
  h.actor = editor;
  return { editor, other, p };
}

describe('design file routes (Story 3.1)', () => {
  it('GET is 204 with the name before the first save, then streams the bytes', async () => {
    const { editor, p } = await setup();
    let r = await file.GET(req(), ctx(p.id));
    expect(r.status).toBe(204);
    expect(r.headers.get('x-file-name')).toBe('Poster.figcraft');
    expect(r.headers.get('x-storage')).toBe('local-fs');
    expect(r.headers.get('x-upload-prefix')).toBe(`design-files/${editor.workspace.id}/${p.id}/`);

    expect((await file.PUT(put(new Uint8Array([1, 2, 3])), ctx(p.id))).status).toBe(200);
    r = await file.GET(req(), ctx(p.id));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-length')).toBe('3');
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('PUT refuses a stale lock (409) and a body cut short (400)', async () => {
    const { other, p } = await setup();
    const r = await file.PUT(put(new Uint8Array([1, 2]), { 'content-length': '5' }), ctx(p.id));
    expect(r.status).toBe(400);
    h.actor = other;
    const stale = await file.PUT(put(new Uint8Array([9])), ctx(p.id));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toBe('conflict');
    expect((await file.GET(req(), ctx(p.id))).status).toBe(204);
  });

  it('POST commits an uploaded key; 409 from a stale lock', async () => {
    const { editor, other, p } = await setup();
    const key = newDesignFileKey(editor.workspace.id, p.id);
    await localFsStorage(dir).put(key, new Uint8Array([7, 7]));
    const commit = (body: unknown) =>
      file.POST(
        req({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        ctx(p.id),
      );
    expect((await commit({ key })).status).toBe(400);
    const ok = await commit({ key, sessionId: S1 });
    expect(await ok.json()).toEqual({ size: 2, storage: 'local-fs' });
    // Another editor's upload is refused and removed; the document stays.
    const theirs = newDesignFileKey(editor.workspace.id, p.id);
    await localFsStorage(dir).put(theirs, new Uint8Array([9]));
    h.actor = other;
    expect((await commit({ key: theirs, sessionId: S1 })).status).toBe(409);
    expect(await localFsStorage(dir).head(theirs)).toBeNull();
    h.actor = editor;
    expect([...new Uint8Array(await (await file.GET(req(), ctx(p.id))).arrayBuffer())]).toEqual([
      7, 7,
    ]);
  });

  it('the upload route issues a scoped client token to the lock holder only', async () => {
    const { editor, other, p } = await setup();
    const token = async (pathname: string, sessionId = S1) =>
      upload.POST(
        req({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'blob.generate-client-token',
            payload: { pathname, multipart: true, clientPayload: JSON.stringify({ sessionId }) },
          }),
        }),
        ctx(p.id),
      );
    const key = newDesignFileKey(editor.workspace.id, p.id);

    expect((await token(key)).status).toBe(501); // no Blob store: the local fallback uses PUT

    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_teststore_secretsecretsecret');
    try {
      const r = await token(key);
      expect(r.status).toBe(200);
      const { clientToken } = (await r.json()) as { clientToken: string };
      expect(getPayloadFromClientToken(clientToken)).toMatchObject({
        pathname: key,
        allowedContentTypes: ['application/octet-stream'],
        maximumSizeInBytes: 64 * 1024 * 1024,
        allowOverwrite: false,
      });
      expect(
        (await token(`design-files/${editor.workspace.id}/other/abcdefgh.figcraft`)).status,
      ).toBe(400);
      h.actor = other;
      expect((await token(key)).status).toBe(409);
      h.actor = null;
      expect((await token(key)).status).toBe(401);
    } finally {
      vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    }
  });
});
