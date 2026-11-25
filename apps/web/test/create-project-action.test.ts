/**
 * Creating a project with the workspace's default design system (Story 10.4) is all or nothing:
 * when attaching the system fails, the action reports an error and leaves no project, file or
 * attachment row and no stored document. Clerk is replaced by a settable actor.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignFileStorage } from '@/server/services/design-files';
import type { Actor } from '@/server/services/types';

const h = vi.hoisted(() => ({
  actor: null as Actor | null,
  db: null as unknown,
  storage: null as DesignFileStorage | null,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/context', () => ({ requireActor: async () => h.actor, db: () => h.db }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/services/design-files', async (orig) => ({
  ...(await orig<typeof import('@/server/services/design-files')>()),
  defaultDesignFileStorage: () => h.storage,
}));

const { redirect } = await import('next/navigation');
const { designSystemAttachments, designSystems, eq, files, projects } =
  await import('@greenfield/db');
const { makeActor, reset, testDb } = await import('./helpers');
const { localFsStorage } = await import('@/server/services/design-files');
const { createDesignSystem, publishDesignSystem, setDefaultDesignSystem } =
  await import('@/server/services/design-systems');
const { createProjectAction } = await import('@/server/actions/projects');

const LIBRARY = new Uint8Array(
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures/voirdire-library.figcraft')),
);
const { db, close } = testDb();
h.db = db;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-project-action-'));
const local = localFsStorage(dir);
afterAll(async () => {
  await close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await reset(db);
  h.storage = local;
  vi.mocked(redirect).mockClear();
});

/** An admin whose workspace has a published default system. */
async function withDefaultSystem() {
  const admin = await makeActor(db, 'admin');
  const { system } = await createDesignSystem(db, admin, local, {
    name: 'Voirdire',
    bytes: LIBRARY,
  });
  await publishDesignSystem(db, admin, local, { systemId: system.id });
  await setDefaultDesignSystem(db, admin, { systemId: system.id });
  h.actor = admin;
  return { admin, systemId: system.id };
}

const form = (name: string) => {
  const f = new FormData();
  f.set('name', name);
  return f;
};

/** Stored project documents in the workspace. */
const storedDocuments = (workspaceId: string) =>
  fs.existsSync(path.join(dir, 'design-files', workspaceId))
    ? fs
        .readdirSync(path.join(dir, 'design-files', workspaceId), { recursive: true })
        .filter((f) => String(f).endsWith('.figcraft'))
    : [];

describe('createProjectAction with a default design system', () => {
  it('creates the project, its document and the attachment, then opens it', async () => {
    const { admin } = await withDefaultSystem();
    const res = await createProjectAction(null, form('Landing'));
    expect(res.ok).toBe(true);
    const id = res.ok ? res.data.id : '';
    expect(redirect).toHaveBeenCalledWith(`/w/${admin.workspace.slug}/p/${id}`);
    const [file] = await db.select().from(files).where(eq(files.projectId, id));
    expect(file).toMatchObject({ name: 'Landing.figcraft' });
    expect(
      await db
        .select()
        .from(designSystemAttachments)
        .where(eq(designSystemAttachments.fileId, file!.id)),
    ).toHaveLength(1);
    expect(storedDocuments(admin.workspace.id)).toHaveLength(1);
  });

  it('leaves nothing behind when attaching the system fails', async () => {
    const { admin, systemId } = await withDefaultSystem();
    // The system is deleted after the document is stored and before the rows go in, so the
    // attachment's foreign key fails inside the transaction.
    h.storage = {
      ...local,
      put: async (key, bytes) => {
        await local.put(key, bytes);
        await db.delete(designSystems).where(eq(designSystems.id, systemId));
      },
    };
    const res = await createProjectAction(null, form('Landing'));
    expect(res).toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
    expect(redirect).not.toHaveBeenCalled();
    expect(
      await db.select().from(projects).where(eq(projects.workspaceId, admin.workspace.id)),
    ).toEqual([]);
    expect(await db.select().from(files).where(eq(files.workspaceId, admin.workspace.id))).toEqual(
      [],
    );
    expect(await db.select().from(designSystemAttachments)).toEqual([]);
    expect(storedDocuments(admin.workspace.id)).toEqual([]);
  });
});
