import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@crunch/authz';
import {
  figcraftSpikeEnabled,
  loadDesignFile,
  localFsStorage,
  saveDesignFile,
} from '@/server/services/figcraft-spike';
import { createProject, setProjectArchived } from '@/server/services/projects';
import { NotFoundError, ValidationError } from '@/server/services/types';
import { makeActor, reset, testDb } from './helpers';

const { db, close } = testDb();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figcraft-spike-'));
const storage = localFsStorage(dir);
afterAll(async () => {
  await close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => reset(db));

const bytes = (...b: number[]) => new Uint8Array(b);

describe('figcraft spike (Story 0.1)', () => {
  it('is enabled only with the flag outside production', () => {
    vi.stubEnv('CRUNCH_FIGCRAFT_SPIKE', '');
    expect(figcraftSpikeEnabled()).toBe(false);
    vi.stubEnv('CRUNCH_FIGCRAFT_SPIKE', '1');
    expect(figcraftSpikeEnabled()).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(figcraftSpikeEnabled()).toBe(false);
    vi.unstubAllEnvs();
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
