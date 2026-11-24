/**
 * Story 0.1 spike (throwaway): one FigCraft document per project, stored as bytes in Vercel Blob
 * (or a local directory when no BLOB_READ_WRITE_TOKEN is set). Dev-only, behind
 * CRUNCH_FIGCRAFT_SPIKE=1; see spikes/0.1-embed/FINDINGS.md.
 *
 * Framework-free like every service: `(db, actor, storage, input)`. Bytes are never logged.
 */
import { assertCan } from '@crunch/authz';
import type { Db } from '@crunch/db';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getProject } from './projects';
import { ValidationError, type Actor } from './types';

/** The spike's routes and page exist only with the flag, and never in production builds. */
export function figcraftSpikeEnabled(): boolean {
  return process.env.CRUNCH_FIGCRAFT_SPIKE === '1' && process.env.NODE_ENV !== 'production';
}

/** Largest document the spike accepts. (A Vercel Function body tops out at 4.5 MB: see FINDINGS.) */
export const MAX_DESIGN_FILE_BYTES = 64 * 1024 * 1024;

/** The small storage surface the spike needs; Vercel Blob and a local directory implement it. */
export interface DesignFileStorage {
  readonly kind: 'vercel-blob' | 'local-fs';
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

export function vercelBlobStorage(token: string): DesignFileStorage {
  return {
    kind: 'vercel-blob',
    async get(key) {
      const { get } = await import('@vercel/blob');
      const r = await get(key, { access: 'private', token, useCache: false });
      if (!r || r.statusCode !== 200 || !r.stream) return null;
      return new Uint8Array(await new Response(r.stream).arrayBuffer());
    },
    async put(key, bytes) {
      const { put } = await import('@vercel/blob');
      await put(key, Buffer.from(bytes), {
        access: 'private',
        token,
        contentType: 'application/octet-stream',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
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
  return {
    kind: 'local-fs',
    async get(key) {
      try {
        return new Uint8Array(await fs.readFile(resolve(key)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async put(key, bytes) {
      const p = resolve(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, p);
    },
  };
}

/** Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else `<cwd>/.data/blob` (gitignored). */
export function defaultDesignFileStorage(): DesignFileStorage {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return vercelBlobStorage(token);
  return localFsStorage(
    process.env.CRUNCH_LOCAL_BLOB_DIR ?? path.join(process.cwd(), '.data', 'blob'),
  );
}

const keyFor = (workspaceId: string, projectId: string) =>
  `figcraft-spike/${workspaceId}/${projectId}/document.figcraft`;

/** The name the host gives the document when it opens it in the editor. */
function documentName(projectName: string): string {
  const base = projectName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim() || 'Untitled';
  return `${base.slice(0, 120)}.figcraft`;
}

export interface DesignFile {
  name: string;
  bytes: Uint8Array;
}

/** The project's document, or null when nothing has been saved yet. */
export async function loadDesignFile(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: { projectId: string },
): Promise<DesignFile | null> {
  const project = await getProject(db, actor, input.projectId); // project:read, workspace-scoped
  const bytes = await storage.get(keyFor(actor.workspace.id, project.id));
  return bytes ? { name: documentName(project.name), bytes } : null;
}

export async function saveDesignFile(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: { projectId: string; bytes: Uint8Array },
): Promise<{ size: number }> {
  assertCan(actor.role, 'design:edit');
  const project = await getProject(db, actor, input.projectId);
  if (project.archivedAt)
    throw new ValidationError('This project is archived. Restore it to edit.');
  if (input.bytes.byteLength === 0) throw new ValidationError('Empty file');
  if (input.bytes.byteLength > MAX_DESIGN_FILE_BYTES) throw new ValidationError('File too large');
  await storage.put(keyFor(actor.workspace.id, project.id), input.bytes);
  return { size: input.bytes.byteLength };
}
