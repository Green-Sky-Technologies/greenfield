import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import { designSystemAttachments, eq } from '@greenfield/db';
import {
  attachDefaultDesignSystem,
  createDesignSystem,
  deleteDesignSystem,
  getDesignSystem,
  getFileDesignSystem,
  listDesignSystems,
  publishDesignSystem,
  saveDesignSystemReview,
  setDefaultDesignSystem,
  setDesignSystemPolicy,
  unpublishDesignSystem,
} from '@/server/services/design-systems';
import { libraryItems, readLibraryFile } from '@/server/services/design-systems/library-file';
import { loadDesignFile, localFsStorage } from '@/server/services/design-files';
import { createProject } from '@/server/services/projects';
import { NotFoundError, ValidationError, type Actor } from '@/server/services/types';
import { figcraftFile } from './fakes/figcraft';
import { makeActor, reset, testDb } from './helpers';

/** Made in figcraft-web 0.18.1 through the bridge: two colour collections and a spacing one,
 * text styles display/xl, heading/m, body/m, and Button, Input, Card components whose fills are
 * bound to the colours. */
const LIBRARY = new Uint8Array(
  fs.readFileSync(path.join(import.meta.dirname, 'fixtures/voirdire-library.figcraft')),
);

const { db, close } = testDb();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-systems-'));
const storage = localFsStorage(dir);
afterAll(async () => {
  await close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => reset(db));

async function setup() {
  const admin = await makeActor(db, 'admin');
  const editor = await makeActor(db, 'editor', admin.workspace);
  const viewer = await makeActor(db, 'viewer', admin.workspace);
  const outsider = await makeActor(db, 'admin');
  return { admin, editor, viewer, outsider };
}

const create = (actor: Actor, name = 'Voirdire') =>
  createDesignSystem(db, actor, storage, { name, bytes: LIBRARY, guide: '# Voirdire' });
const keyOf = (items: { key: string; name: string }[], name: string) =>
  items.find((i) => i.name === name)!.key;

describe('design system model (10.1)', () => {
  it('creates a draft from a library file, with what the review offers', async () => {
    const { editor } = await setup();
    const { system, version } = await create(editor);
    expect(system).toMatchObject({ name: 'Voirdire', isDefault: false, publishedVersionId: null });
    expect(version).toMatchObject({
      version: 1,
      guide: '# Voirdire',
      dropped: [],
      publishedAt: null,
    });
    expect(version.items.map((i) => `${i.kind}:${i.name}`)).toEqual([
      'colours:Ink and paper',
      'colours:Accents',
      'type:display/xl',
      'type:heading/m',
      'type:body/m',
      'component:Button',
      'component:Input',
      'component:Card',
    ]);
    const ink = version.items[0]!;
    expect(ink.kind === 'colours' && ink.colours[0]).toEqual({ name: 'ink/900', hex: '#14140f' });
    expect(await listDesignSystems(db, editor)).toMatchObject([
      { name: 'Voirdire', isDefault: false, published: null, latest: { version: 1 }, usedIn: 0 },
    ]);
  });

  it('refuses files that are not FigCraft libraries', async () => {
    const { editor } = await setup();
    const bad = (bytes: Uint8Array) =>
      createDesignSystem(db, editor, storage, { name: 'X', bytes });
    await expect(bad(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(ValidationError);
    await expect(bad(figcraftFile([]))).rejects.toThrow(/no colour variables/);
    await expect(
      createDesignSystem(db, editor, storage, { name: ' ', bytes: LIBRARY }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('is scoped to the workspace: another workspace sees nothing and gets not found', async () => {
    const { editor, outsider } = await setup();
    const { system } = await create(editor);
    expect(await listDesignSystems(db, outsider)).toEqual([]);
    for (const call of [
      () => getDesignSystem(db, outsider, system.id),
      () => saveDesignSystemReview(db, outsider, { systemId: system.id, dropped: [] }),
      () => publishDesignSystem(db, outsider, storage, { systemId: system.id }),
      () => setDefaultDesignSystem(db, outsider, { systemId: system.id }),
      () => unpublishDesignSystem(db, outsider, { systemId: system.id }),
      () => deleteDesignSystem(db, outsider, storage, { systemId: system.id }),
    ])
      await expect(call()).rejects.toBeInstanceOf(NotFoundError);
    await expect(getDesignSystem(db, editor, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('viewers read but cannot create or review', async () => {
    const { editor, viewer } = await setup();
    const { system } = await create(editor);
    expect(await listDesignSystems(db, viewer)).toHaveLength(1);
    await expect(create(viewer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      saveDesignSystemReview(db, viewer, { systemId: system.id, dropped: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('review (10.3)', () => {
  it('saves keep/drop choices and the guide; only known items', async () => {
    const { editor } = await setup();
    const { system, version } = await create(editor);
    const accents = keyOf(version.items, 'Accents');
    const saved = await saveDesignSystemReview(db, editor, {
      systemId: system.id,
      dropped: [accents, accents],
      guide: 'Use rubric sparingly.',
    });
    expect(saved).toMatchObject({ dropped: [accents], guide: 'Use rubric sparingly.' });
    await expect(
      saveDesignSystemReview(db, editor, { systemId: system.id, dropped: ['colours:nope'] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('publishing removes dropped items from the library file, and what pointed at them', async () => {
    const { admin } = await setup();
    const { system, version } = await create(admin);
    const dropped = ['Accents', 'heading/m', 'Button'].map((n) => keyOf(version.items, n));
    await saveDesignSystemReview(db, admin, { systemId: system.id, dropped });
    const published = await publishDesignSystem(db, admin, storage, { systemId: system.id });

    expect(published.summary!.map((i) => i.name)).toEqual([
      'Ink and paper',
      'display/xl',
      'body/m',
      'Input',
      'Card',
    ]);
    const file = readLibraryFile(
      new Uint8Array(fs.readFileSync(path.join(dir, published.libraryKey!))),
    );
    expect(libraryItems(file.doc)).toEqual(published.summary);
    const vars = file.doc.variables!.variables!;
    expect(vars.map((v) => v.name)).not.toContain('rubric/500');
    // The spacing collection had no colours to review: it stays.
    expect(file.doc.variables!.collections!.map((c) => c.name)).toEqual([
      'Ink and paper',
      'Spacing',
    ]);
    const ids = new Set(vars.map((v) => v.id));
    for (const n of Object.values(file.doc.nodes)) {
      expect(n.name).not.toBe('Button');
      for (const v of Object.values((n.bound ?? {}) as Record<string, unknown>))
        expect(ids.has(v as string), `${String(n.name)} bound to a dropped variable`).toBe(true);
    }
    // The uploaded source is untouched.
    expect(fs.readFileSync(path.join(dir, version.sourceKey))).toEqual(Buffer.from(LIBRARY));
    await expect(
      saveDesignSystemReview(db, admin, { systemId: system.id, dropped: [] }),
    ).rejects.toThrow(/published/);
  });

  it('refuses to publish an empty system', async () => {
    const { admin } = await setup();
    const { system, version } = await create(admin);
    await saveDesignSystemReview(db, admin, {
      systemId: system.id,
      dropped: version.items.map((i) => i.key),
    });
    await expect(publishDesignSystem(db, admin, storage, { systemId: system.id })).rejects.toThrow(
      /Keep at least one/,
    );
  });
});

describe('publish and default (10.4)', () => {
  it('only admins publish and set the default, unless an admin lets editors', async () => {
    const { admin, editor } = await setup();
    const { system } = await create(editor);
    await expect(
      publishDesignSystem(db, editor, storage, { systemId: system.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setDesignSystemPolicy(db, editor, { managers: 'admins_and_editors' }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await setDesignSystemPolicy(db, admin, { managers: 'admins_and_editors' });
    await publishDesignSystem(db, editor, storage, { systemId: system.id });
    await setDefaultDesignSystem(db, editor, { systemId: system.id });
    expect((await listDesignSystems(db, editor))[0]).toMatchObject({
      isDefault: true,
      published: { version: 1 },
    });

    await setDesignSystemPolicy(db, admin, { managers: 'admins' });
    await expect(setDefaultDesignSystem(db, editor, { systemId: null })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('one default per workspace; it must be published and stays published', async () => {
    const { admin } = await setup();
    const a = (await create(admin, 'A')).system;
    const b = (await create(admin, 'B')).system;
    await expect(setDefaultDesignSystem(db, admin, { systemId: a.id })).rejects.toThrow(/Publish/);
    await publishDesignSystem(db, admin, storage, { systemId: a.id });
    await publishDesignSystem(db, admin, storage, { systemId: b.id });
    await setDefaultDesignSystem(db, admin, { systemId: a.id });
    await setDefaultDesignSystem(db, admin, { systemId: b.id });
    const list = await listDesignSystems(db, admin);
    expect(list.map((s) => [s.name, s.isDefault])).toEqual([
      ['B', true],
      ['A', false],
    ]);
    await expect(unpublishDesignSystem(db, admin, { systemId: b.id })).rejects.toThrow(/default/);
    await expect(deleteDesignSystem(db, admin, storage, { systemId: b.id })).rejects.toThrow(
      /default/,
    );
    await unpublishDesignSystem(db, admin, { systemId: a.id });
    expect((await listDesignSystems(db, admin))[1]!.published).toBeNull();
    await publishDesignSystem(db, admin, storage, { systemId: a.id });
    expect((await listDesignSystems(db, admin))[1]!.published).toMatchObject({ version: 1 });
  });

  it('a new project starts from the default system, and the file records it', async () => {
    const { admin, editor, outsider } = await setup();
    const { system, version } = await create(admin);
    await saveDesignSystemReview(db, admin, {
      systemId: system.id,
      dropped: [keyOf(version.items, 'Accents')],
      guide: 'Use ink on paper.',
    });

    const before = await createProject(db, editor, { name: 'Before' });
    expect(
      await attachDefaultDesignSystem(db, editor, storage, { projectId: before.id }),
    ).toBeNull();
    expect(await loadDesignFile(db, editor, storage, { projectId: before.id })).toBeNull();

    await publishDesignSystem(db, admin, storage, { systemId: system.id });
    await setDefaultDesignSystem(db, admin, { systemId: system.id });
    const p = await createProject(db, editor, { name: 'Landing' });
    expect(await attachDefaultDesignSystem(db, editor, storage, { projectId: p.id })).toEqual({
      systemId: system.id,
      versionId: version.id,
    });

    const file = await loadDesignFile(db, editor, storage, { projectId: p.id });
    const { doc } = readLibraryFile(file!.bytes);
    expect(doc.pages.map((id) => doc.nodes[String(id)]!.name)).toEqual(['Page 1', 'Voirdire']);
    expect(doc.current_page).toBe(doc.pages[0]);
    expect(libraryItems(doc).map((i) => i.name)).toEqual([
      'Ink and paper',
      'display/xl',
      'heading/m',
      'body/m',
      'Button',
      'Input',
      'Card',
    ]);
    expect(await getFileDesignSystem(db, editor, { projectId: p.id })).toEqual({
      system: { id: system.id, name: 'Voirdire' },
      version: {
        id: version.id,
        version: 1,
        guide: 'Use ink on paper.',
        summary: libraryItems(doc),
      },
    });
    expect(await getFileDesignSystem(db, editor, { projectId: before.id })).toBeNull();
    await expect(getFileDesignSystem(db, outsider, { projectId: p.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await listDesignSystems(db, admin))[0]!.usedIn).toBe(1);

    // Attaching again leaves the document alone.
    expect(await attachDefaultDesignSystem(db, editor, storage, { projectId: p.id })).toBeNull();
    const rows = await db
      .select()
      .from(designSystemAttachments)
      .where(eq(designSystemAttachments.designSystemId, system.id));
    expect(rows).toHaveLength(1);
  });

  it('deleting a system removes its stored files', async () => {
    const { admin } = await setup();
    const { system } = await create(admin);
    await publishDesignSystem(db, admin, storage, { systemId: system.id });
    const prefix = path.join(dir, 'design-systems', admin.workspace.id, system.id);
    expect(fs.readdirSync(prefix)).toHaveLength(2);
    await deleteDesignSystem(db, admin, storage, { systemId: system.id });
    expect(fs.readdirSync(prefix)).toHaveLength(0);
    expect(await listDesignSystems(db, admin)).toEqual([]);
  });
});
