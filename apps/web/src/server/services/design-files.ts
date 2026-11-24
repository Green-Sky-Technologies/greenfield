/**
 * The project's design file: one `.figcraft` document per project (Story 3.1). The bytes live in
 * private Vercel Blob (or a local directory when no BLOB_READ_WRITE_TOKEN is set); the `files`
 * row says which object is the document.
 *
 * A save writes a new object (`design-files/<workspace>/<project>/<saveId>.figcraft`) and then
 * commits it: the row moves to the new key only if the caller's tab still holds the project's
 * edit lock. A save from a stale lock is refused and its object deleted, so it never replaces
 * the document. In production the browser uploads straight to Blob (function bodies cap at
 * 4.5 MB) with a client token from `authorizeDesignFileUpload`, then calls `commitDesignFile`;
 * the local fallback sends the bytes to `saveDesignFile`.
 *
 * Framework-free like every service: `(db, actor, storage, input)`. Bytes are never logged.
 */
import { assertCan } from '@greenfield/authz';
import { and, editLocks, eq, files, gt, type Db } from '@greenfield/db';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { EDIT_LOCK_TTL_MS } from './locks';
import { getProject } from './projects';
import { ConflictError, ValidationError, type Actor } from './types';

/** Largest document accepted. */
export const MAX_DESIGN_FILE_BYTES = 64 * 1024 * 1024;
export const DESIGN_FILE_CONTENT_TYPE = 'application/octet-stream';

/** The small storage surface design files need; Vercel Blob and a local directory implement it. */
export interface DesignFileStorage {
  readonly kind: 'vercel-blob' | 'local-fs';
  /** The object's size, or null when there is none. */
  head(key: string): Promise<{ size: number } | null>;
  read(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  copy(fromKey: string, toKey: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function vercelBlobStorage(token: string): DesignFileStorage {
  const blob = () => import('@vercel/blob');
  return {
    kind: 'vercel-blob',
    async head(key) {
      const { head, BlobNotFoundError } = await blob();
      try {
        return { size: (await head(key, { token })).size };
      } catch (e) {
        if (e instanceof BlobNotFoundError) return null;
        throw e;
      }
    },
    async read(key) {
      const { get } = await blob();
      const r = await get(key, { access: 'private', token, useCache: false });
      if (!r || r.statusCode !== 200) return null;
      return { body: r.stream, size: r.blob.size };
    },
    async put(key, bytes) {
      const { put } = await blob();
      await put(key, Buffer.from(bytes), {
        access: 'private',
        token,
        contentType: DESIGN_FILE_CONTENT_TYPE,
        addRandomSuffix: false,
      });
    },
    async copy(fromKey, toKey) {
      const { copy } = await blob();
      await copy(fromKey, toKey, {
        access: 'private',
        token,
        contentType: DESIGN_FILE_CONTENT_TYPE,
        addRandomSuffix: false,
      });
    },
    async delete(key) {
      const { del } = await blob();
      await del(key, { token });
    },
  };
}

/** Files under `dir`, keyed by the same pathnames Blob would use. Writes are atomic (rename). */
export function localFsStorage(dir: string): DesignFileStorage {
  const resolve = (key: string) => {
    const p = path.resolve(dir, key);
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('Invalid storage key');
    return p;
  };
  const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
  const write = async (key: string, bytes: Uint8Array) => {
    const p = resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, p);
  };
  return {
    kind: 'local-fs',
    async head(key) {
      try {
        return { size: (await fs.stat(resolve(key))).size };
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    async read(key) {
      const p = resolve(key);
      try {
        const { size } = await fs.stat(p);
        const body = Readable.toWeb(createReadStream(p)) as ReadableStream<Uint8Array>;
        return { body, size };
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    put: write,
    async copy(fromKey, toKey) {
      await write(toKey, await fs.readFile(resolve(fromKey)));
    },
    async delete(key) {
      await fs.rm(resolve(key), { force: true });
    },
  };
}

/** Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else `<cwd>/.data/blob` (gitignored). */
export function defaultDesignFileStorage(): DesignFileStorage {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return vercelBlobStorage(token);
  return localFsStorage(
    process.env.GREENFIELD_LOCAL_BLOB_DIR ?? path.join(process.cwd(), '.data', 'blob'),
  );
}

/** Every object of a project's files lives under this prefix. */
export const designFilePrefix = (workspaceId: string, projectId: string) =>
  `design-files/${workspaceId}/${projectId}/`;

/** Where Story 1.2 kept the document, before the `files` row existed. Read-only now. */
const legacyKey = (workspaceId: string, projectId: string) =>
  `${designFilePrefix(workspaceId, projectId)}document.figcraft`;

/** A save's object name: a random UUID (see newDesignFileKey). */
const SAVE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.figcraft$/;
const SESSION_RE = /^[\w-]{8,64}$/;

/** A fresh object key for one save of the project's document. */
export const newDesignFileKey = (workspaceId: string, projectId: string) =>
  `${designFilePrefix(workspaceId, projectId)}${randomUUID()}.figcraft`;

function checkSaveKey(actor: Actor, projectId: string, key: unknown): string {
  const prefix = designFilePrefix(actor.workspace.id, projectId);
  if (
    typeof key !== 'string' ||
    !key.startsWith(prefix) ||
    !SAVE_KEY_RE.test(key.slice(prefix.length))
  )
    throw new ValidationError('Invalid upload pathname');
  return key;
}

function checkSession(sessionId: unknown): string {
  if (typeof sessionId !== 'string' || !SESSION_RE.test(sessionId))
    throw new ValidationError('Invalid session id');
  return sessionId;
}

/** The name the host gives the document when it opens it in the editor. */
/** The file name a project's document is opened and saved under. */
export function documentName(projectName: string): string {
  const base = projectName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim() || 'Untitled';
  return `${base.slice(0, 120)}.figcraft`;
}

/** The caller's tab holds a live edit lock on the project (services/locks). */
const holdsLock = (actor: Actor, projectId: string, sessionId: string) =>
  and(
    eq(editLocks.projectId, projectId),
    eq(editLocks.holderUserId, actor.userId),
    eq(editLocks.sessionId, sessionId),
    gt(editLocks.heartbeatAt, new Date(Date.now() - EDIT_LOCK_TTL_MS)),
  );

const STALE_LOCK =
  'Your edit lock has expired or moved to another tab or person. Reload to get the latest version.';

/** Editors may change the project's document unless it's archived. */
async function editableProject(db: Db, actor: Actor, projectId: string) {
  assertCan(actor.role, 'design:edit');
  const project = await getProject(db, actor, projectId); // workspace-scoped
  if (project.archivedAt)
    throw new ValidationError('This project is archived. Restore it to edit.');
  return project;
}

/** The checks every save passes before any bytes are written. */
async function checkCanSave(db: Db, actor: Actor, projectId: string, sessionId: string) {
  const project = await editableProject(db, actor, projectId);
  const [lock] = await db
    .select({ projectId: editLocks.projectId })
    .from(editLocks)
    .where(holdsLock(actor, project.id, sessionId))
    .limit(1);
  if (!lock) throw new ConflictError(STALE_LOCK);
  return project;
}

export interface DesignFileInfo {
  /** The name the host gives the document in the editor (from the project's name). */
  name: string;
  /** The object holding the document's bytes; null when nothing has been saved yet. */
  key: string | null;
}

/** The project's document: its name, and where it's stored. */
export async function getDesignFile(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: { projectId: string },
): Promise<DesignFileInfo> {
  const project = await getProject(db, actor, input.projectId); // project:read, workspace-scoped
  const name = documentName(project.name);
  const [row] = await db
    .select({ key: files.blobKey })
    .from(files)
    .where(and(eq(files.projectId, project.id), eq(files.workspaceId, actor.workspace.id)))
    .limit(1);
  if (row) return { name, key: row.key };
  const legacy = legacyKey(actor.workspace.id, project.id);
  return { name, key: (await storage.head(legacy)) ? legacy : null };
}

/** The project's document as bytes (tests and small files; the route streams instead). */
export async function loadDesignFile(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: { projectId: string },
): Promise<{ name: string; bytes: Uint8Array } | null> {
  const file = await getDesignFile(db, actor, storage, input);
  const r = file.key && (await storage.read(file.key));
  if (!r) return null;
  return { name: file.name, bytes: new Uint8Array(await new Response(r.body).arrayBuffer()) };
}

/**
 * Authorize a browser upload to Blob (the `handleUpload` token callback). The pathname must be a
 * fresh save key of this project and the caller's tab must hold the edit lock. Returns the
 * constraints baked into the client token.
 */
export async function authorizeDesignFileUpload(
  db: Db,
  actor: Actor,
  input: { projectId: string; pathname: unknown; sessionId: unknown },
) {
  const sessionId = checkSession(input.sessionId);
  const project = await checkCanSave(db, actor, input.projectId, sessionId);
  checkSaveKey(actor, project.id, input.pathname);
  return {
    allowedContentTypes: [DESIGN_FILE_CONTENT_TYPE],
    maximumSizeInBytes: MAX_DESIGN_FILE_BYTES,
    addRandomSuffix: false,
    allowOverwrite: false,
    validUntil: Date.now() + 10 * 60 * 1000,
  };
}

/**
 * Make an uploaded object the project's document. Refused (ConflictError) when the caller's tab
 * no longer holds the edit lock; the refused object is deleted and the stored document is
 * untouched. The previous object is deleted once the row has moved (versions are Story 3.3).
 */
export async function commitDesignFile(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: { projectId: string; key: unknown; sessionId: unknown },
): Promise<{ size: number }> {
  const sessionId = checkSession(input.sessionId);
  const project = await editableProject(db, actor, input.projectId);
  const key = checkSaveKey(actor, project.id, input.key);
  // The lock is checked in the transaction below, so a refused upload is deleted too.
  const stored = await storage.head(key);
  if (!stored) throw new ValidationError('Upload not found');
  if (stored.size === 0 || stored.size > MAX_DESIGN_FILE_BYTES) {
    await storage.delete(key);
    throw new ValidationError(stored.size === 0 ? 'Empty file' : 'File too large');
  }

  const r = await db.transaction(async (tx) => {
    // Lock the lock row: a take-over or hand-off waits for this commit, or wins before it.
    const [lock] = await tx
      .select({ projectId: editLocks.projectId })
      .from(editLocks)
      .where(holdsLock(actor, project.id, sessionId))
      .for('update');
    const [current] = await tx
      .select({ key: files.blobKey })
      .from(files)
      .where(eq(files.projectId, project.id));
    if (!lock) return { committed: false, current: current?.key ?? null };
    const row = {
      name: documentName(project.name),
      blobKey: key,
      size: stored.size,
      updatedBy: actor.userId,
    };
    await tx
      .insert(files)
      .values({ ...row, workspaceId: actor.workspace.id, projectId: project.id })
      .onConflictDoUpdate({ target: files.projectId, set: { ...row, updatedAt: new Date() } });
    return {
      committed: true,
      current: current?.key ?? legacyKey(actor.workspace.id, project.id),
    };
  });
  if (!r.committed) {
    // Never delete the stored document (a retried commit of a key that already won).
    if (r.current !== key) await storage.delete(key).catch(() => {});
    throw new ConflictError(STALE_LOCK);
  }
  if (r.current !== key) await storage.delete(r.current).catch(() => {});
  return { size: stored.size };
}

/** Save bytes the server received (the local fallback, and small files): write, then commit. */
export async function saveDesignFile(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: { projectId: string; bytes: Uint8Array; sessionId: unknown },
): Promise<{ size: number }> {
  const sessionId = checkSession(input.sessionId);
  const project = await checkCanSave(db, actor, input.projectId, sessionId);
  if (input.bytes.byteLength === 0) throw new ValidationError('Empty file');
  if (input.bytes.byteLength > MAX_DESIGN_FILE_BYTES) throw new ValidationError('File too large');
  const key = newDesignFileKey(actor.workspace.id, project.id);
  await storage.put(key, input.bytes);
  return commitDesignFile(db, actor, storage, { projectId: project.id, key, sessionId });
}

/** Copy one project's document to another (duplicating a project). No-op when there is none. */
export async function copyDesignFile(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: { fromProjectId: string; toProjectId: string },
): Promise<void> {
  assertCan(actor.role, 'project:create');
  const [from, to] = await Promise.all([
    getDesignFile(db, actor, storage, { projectId: input.fromProjectId }),
    getProject(db, actor, input.toProjectId),
  ]);
  if (!from.key) return;
  const key = newDesignFileKey(actor.workspace.id, to.id);
  await storage.copy(from.key, key);
  const size = (await storage.head(key))?.size ?? 0;
  const row = { name: documentName(to.name), blobKey: key, size, updatedBy: actor.userId };
  await db
    .insert(files)
    .values({ ...row, workspaceId: actor.workspace.id, projectId: to.id })
    .onConflictDoUpdate({ target: files.projectId, set: { ...row, updatedAt: new Date() } });
}
