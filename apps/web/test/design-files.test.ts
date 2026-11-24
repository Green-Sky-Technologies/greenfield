import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@greenfield/authz';
import {
  copyDesignFile,
  loadDesignFile,
  localFsStorage,
  saveDesignFile,
} from '@/server/services/design-files';
import { createProject, duplicateProject, setProjectArchived } from '@/server/services/projects';
import { NotFoundError, ValidationError } from '@/server/services/types';
import { makeActor, reset, testDb } from './helpers';

const { db, close } = testDb();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-files-'));
const storage = localFsStorage(dir);
afterAll(async () => {
  await close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => reset(db));

const bytes = (...b: number[]) => new Uint8Array(b);

describe('design files', () => {
  it('copies the document when a project is duplicated, within the workspace only', async () => {
    const editor = await makeActor(db, 'editor');
    const viewer = await makeActor(db, 'viewer', editor.workspace);
    const outsider = await makeActor(db, 'admin');
    const p = await createProject(db, editor, { name: 'Original' });
    const empty = await createProject(db, editor, { name: 'Empty' });
    await saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(4, 5) });

    const copy = await duplicateProject(db, editor, p.id);
    await copyDesignFile(db, editor, storage, { fromProjectId: p.id, toProjectId: copy.id });
    const file = await loadDesignFile(db, editor, storage, { projectId: copy.id });
    expect([...file!.bytes]).toEqual([4, 5]);

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

  it('saves and loads the project document, scoped to the workspace', async () => {
    const editor = await makeActor(db, 'editor');
    const viewer = await makeActor(db, 'viewer', editor.workspace);
    const outsider = await makeActor(db, 'admin');
    const p = await createProject(db, editor, { name: 'Poster: v1' });

    expect(await loadDesignFile(db, editor, storage, { projectId: p.id })).toBeNull();
    await saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(1, 2, 3) });
    const file = await loadDesignFile(db, viewer, storage, { projectId: p.id });
    expect(file?.name).toBe('Poster  v1.figcraft');
    expect([...file!.bytes]).toEqual([1, 2, 3]);

    await expect(
      saveDesignFile(db, viewer, storage, { projectId: p.id, bytes: bytes(9) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(loadDesignFile(db, outsider, storage, { projectId: p.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      saveDesignFile(db, outsider, storage, { projectId: p.id, bytes: bytes(9) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes() }),
    ).rejects.toBeInstanceOf(ValidationError);

    await setProjectArchived(db, editor, p.id, true);
    await expect(
      saveDesignFile(db, editor, storage, { projectId: p.id, bytes: bytes(9) }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect([...(await loadDesignFile(db, editor, storage, { projectId: p.id }))!.bytes]).toEqual([
      1, 2, 3,
    ]);
  });

  it('local storage refuses keys outside its directory', async () => {
    await expect(storage.put('../escape', bytes(1))).rejects.toThrow('Invalid storage key');
  });
});
