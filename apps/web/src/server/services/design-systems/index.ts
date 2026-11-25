/**
 * Design systems (Epic 10): a `.figcraft` library file plus a markdown guide, kept as versions.
 *
 * - 10.1: a workspace has several systems, at most one the default. Everything is scoped to the
 *   actor's workspace; another workspace's system is "not found".
 * - 10.3: a version's review keeps or drops each colour group, type style and component of its
 *   library file; publishing removes the dropped ones (`library-file.ts`).
 * - 10.4: a published system is available to the workspace; the default is attached to every new
 *   file. Publishing, unpublishing, deleting and setting the default take permissions an admin
 *   can extend to editors (`permissionsInWorkspace` in `@greenfield/authz`).
 *
 * **What "attached" means.** The browser editor can't load linked FigCraft libraries (it has no
 * file system), so a new file starts as a copy of the default system's published library file:
 * its variables, styles and components are the file's own, with the library's ids, behind a new
 * empty first page (`startingDocument`). A `design_system_attachments` row records which system
 * version the file started from. The agent (10.5) reads it with `getFileDesignSystem`: the guide
 * and `summary` (the published colour groups, type styles and components) go in its prefix, and
 * the ids in the file are the library's, so a later version (10.6) can find what to update.
 *
 * Library files live in the design-file storage (private Blob, or the local fallback) under
 * `design-systems/<workspace>/<system>/`. Bytes are never logged.
 */
import {
  assertCan,
  assertCanInWorkspace,
  type DesignSystemManagers,
  permissionsInWorkspace,
  type Permission,
} from '@greenfield/authz';
import {
  and,
  desc,
  designSystemAttachments,
  designSystems,
  designSystemSettings,
  designSystemVersions,
  eq,
  files,
  inArray,
  projects,
  sql,
  type Db,
  type DesignSystem,
  type DesignSystemItem,
  type DesignSystemVersion,
  type Project,
} from '@greenfield/db';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type DesignFileStorage,
  documentName,
  MAX_DESIGN_FILE_BYTES,
  newDesignFileKey,
} from '../design-files';
import { createProject, getProject, newProjectValues, type NewProjectInput } from '../projects';
import { NotFoundError, ValidationError, type Actor } from '../types';
import {
  dropItems,
  libraryItems,
  readLibraryFile,
  startingDocument,
  writeLibraryFile,
} from './library-file';

export const designSystemPrefix = (workspaceId: string, systemId: string) =>
  `design-systems/${workspaceId}/${systemId}/`;
const objectKey = (workspaceId: string, systemId: string) =>
  `${designSystemPrefix(workspaceId, systemId)}${randomUUID()}.figcraft`;

const nameSchema = z.string().trim().min(1, 'Name is required').max(120, 'Name is too long');
const guideSchema = z.string().max(50_000, 'The guide is too long');

function parse<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const msg = r.error.issues[0]?.message ?? 'Invalid value';
    throw new ValidationError(msg, { [field]: [msg] });
  }
  return r.data;
}

// ---- policy ----

export interface DesignSystemPolicy {
  designSystemManagers: DesignSystemManagers;
}

export async function getDesignSystemPolicy(db: Db, actor: Actor): Promise<DesignSystemPolicy> {
  assertCan(actor.role, 'design_system:read');
  const [row] = await db
    .select({ managers: designSystemSettings.managers })
    .from(designSystemSettings)
    .where(eq(designSystemSettings.workspaceId, actor.workspace.id));
  return { designSystemManagers: row?.managers ?? 'admins' };
}

export async function setDesignSystemPolicy(
  db: Db,
  actor: Actor,
  input: { managers: unknown },
): Promise<DesignSystemPolicy> {
  assertCan(actor.role, 'design_system:manage_policy');
  const managers = parse(z.enum(['admins', 'admins_and_editors']), input.managers, 'managers');
  await db
    .insert(designSystemSettings)
    .values({ workspaceId: actor.workspace.id, managers })
    .onConflictDoUpdate({ target: designSystemSettings.workspaceId, set: { managers } });
  return { designSystemManagers: managers };
}

/** What the actor may do with design systems in their workspace (for showing controls). */
export async function designSystemPermissions(db: Db, actor: Actor) {
  const policy = await getDesignSystemPolicy(db, actor);
  const all = permissionsInWorkspace(actor.role, policy);
  const has = (p: Permission) => all.includes(p);
  return {
    policy,
    edit: has('design_system:edit'),
    publish: has('design_system:publish'),
    setDefault: has('design_system:set_default'),
    managePolicy: has('design_system:manage_policy'),
  };
}

async function assertManage(db: Db, actor: Actor, permission: Permission) {
  assertCanInWorkspace(actor.role, permission, await getDesignSystemPolicy(db, actor));
}

// ---- reading ----

export interface DesignSystemSummary {
  id: string;
  name: string;
  isDefault: boolean;
  /** The version files start from; null while the system is a draft (unpublished). */
  published: { id: string; version: number } | null;
  /** The newest version (the one a review works on). */
  latest: { id: string; version: number; publishedAt: Date | null };
  /** Files that started from this system. */
  usedIn: number;
  /** A few colours for the list's swatch. */
  swatches: string[];
}

async function findSystem(db: Db, actor: Actor, systemId: string): Promise<DesignSystem> {
  if (!z.uuid().safeParse(systemId).success) throw new NotFoundError('Design system not found');
  const [row] = await db
    .select()
    .from(designSystems)
    .where(and(eq(designSystems.id, systemId), eq(designSystems.workspaceId, actor.workspace.id)));
  if (!row) throw new NotFoundError('Design system not found');
  return row;
}

async function latestVersion(db: Db, system: DesignSystem): Promise<DesignSystemVersion> {
  const [v] = await db
    .select()
    .from(designSystemVersions)
    .where(eq(designSystemVersions.designSystemId, system.id))
    .orderBy(desc(designSystemVersions.version))
    .limit(1);
  if (!v) throw new NotFoundError('Design system not found');
  return v;
}

const swatches = (items: DesignSystemItem[]) =>
  items
    .flatMap((i) => (i.kind === 'colours' ? i.colours.map((c) => c.hex) : []))
    .filter((h): h is string => !!h)
    .slice(0, 3);

export async function listDesignSystems(db: Db, actor: Actor): Promise<DesignSystemSummary[]> {
  assertCan(actor.role, 'design_system:read');
  const systems = await db
    .select()
    .from(designSystems)
    .where(eq(designSystems.workspaceId, actor.workspace.id))
    .orderBy(desc(designSystems.isDefault), designSystems.name);
  if (!systems.length) return [];
  const ids = systems.map((s) => s.id);
  const [versions, usage] = await Promise.all([
    db
      .select()
      .from(designSystemVersions)
      .where(inArray(designSystemVersions.designSystemId, ids))
      .orderBy(desc(designSystemVersions.version)),
    db
      .select({ id: designSystemAttachments.designSystemId, n: sql<number>`count(*)::int` })
      .from(designSystemAttachments)
      .where(inArray(designSystemAttachments.designSystemId, ids))
      .groupBy(designSystemAttachments.designSystemId),
  ]);
  return systems.flatMap((s) => {
    const mine = versions.filter((v) => v.designSystemId === s.id);
    const latest = mine[0];
    if (!latest) return [];
    const published = mine.find((v) => v.id === s.publishedVersionId);
    return [
      {
        id: s.id,
        name: s.name,
        isDefault: s.isDefault,
        published: published?.publishedAt ? { id: published.id, version: published.version } : null,
        latest: {
          id: latest.id,
          version: latest.version,
          publishedAt: latest.publishedAt,
        },
        usedIn: usage.find((u) => u.id === s.id)?.n ?? 0,
        swatches: swatches(published?.summary ?? latest.items),
      },
    ];
  });
}

export interface DesignSystemDetail {
  system: DesignSystem;
  /** The newest version, which the review page shows. */
  version: DesignSystemVersion;
}

export async function getDesignSystem(
  db: Db,
  actor: Actor,
  systemId: string,
): Promise<DesignSystemDetail> {
  assertCan(actor.role, 'design_system:read');
  const system = await findSystem(db, actor, systemId);
  return { system, version: await latestVersion(db, system) };
}

// ---- creating and reviewing (design_system:edit) ----

/** A new draft system from an uploaded library file (the manual path; 10.2 builds one). */
export async function createDesignSystem(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: { name: unknown; bytes: Uint8Array; guide?: unknown },
): Promise<DesignSystemDetail> {
  assertCan(actor.role, 'design_system:edit');
  const name = parse(nameSchema, input.name, 'name');
  const guide = parse(guideSchema, input.guide ?? '', 'guide');
  if (input.bytes.byteLength === 0) throw new ValidationError('Empty file');
  if (input.bytes.byteLength > MAX_DESIGN_FILE_BYTES) throw new ValidationError('File too large');
  const items = libraryItems((await readLibraryFile(input.bytes)).doc);
  if (!items.length)
    throw new ValidationError(
      'That file has no colour variables, styles or components to build a system from.',
    );

  const systemId = randomUUID();
  const sourceKey = objectKey(actor.workspace.id, systemId);
  await storage.put(sourceKey, input.bytes);
  try {
    return await db.transaction(async (tx) => {
      const [system] = await tx
        .insert(designSystems)
        .values({ id: systemId, workspaceId: actor.workspace.id, name, createdBy: actor.userId })
        .returning();
      const [version] = await tx
        .insert(designSystemVersions)
        .values({
          workspaceId: actor.workspace.id,
          designSystemId: systemId,
          version: 1,
          sourceKey,
          guide,
          items,
          createdBy: actor.userId,
        })
        .returning();
      return { system: system!, version: version! };
    });
  } catch (e) {
    await storage.delete(sourceKey).catch(() => {});
    throw e;
  }
}

/** The review's choices for an unpublished version ("Save draft"), and its guide. */
export async function saveDesignSystemReview(
  db: Db,
  actor: Actor,
  input: { systemId: string; dropped: unknown; guide?: unknown },
): Promise<DesignSystemVersion> {
  assertCan(actor.role, 'design_system:edit');
  const { version } = await getDesignSystem(db, actor, input.systemId);
  if (version.publishedAt)
    throw new ValidationError('This version is published. A new version is reviewed instead.');
  const keys = new Set(version.items.map((i) => i.key));
  const dropped = parse(z.array(z.string()).max(10_000), input.dropped, 'dropped');
  const unknown = dropped.find((k) => !keys.has(k));
  if (unknown !== undefined) throw new ValidationError('Unknown review item');
  const guide =
    input.guide === undefined ? version.guide : parse(guideSchema, input.guide, 'guide');
  const [row] = await db
    .update(designSystemVersions)
    .set({ dropped: [...new Set(dropped)], guide })
    .where(eq(designSystemVersions.id, version.id))
    .returning();
  return row!;
}

// ---- publishing and the default (design_system:publish, design_system:set_default) ----

/**
 * Publish the newest version: remove what its review dropped from the library file, store the
 * result, and make it the version new files start from. Publishing an already published version
 * again (after unpublishing) only makes the system available again.
 */
export async function publishDesignSystem(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: { systemId: string },
): Promise<DesignSystemVersion> {
  await assertManage(db, actor, 'design_system:publish');
  const { system, version } = await getDesignSystem(db, actor, input.systemId);
  if (version.publishedAt) {
    await db
      .update(designSystems)
      .set({ publishedVersionId: version.id })
      .where(eq(designSystems.id, system.id));
    return version;
  }

  const source = await readAll(storage, version.sourceKey);
  if (!source) throw new NotFoundError('The library file is missing');
  const file = await readLibraryFile(source);
  const published = { ...file, doc: dropItems(file.doc, new Set(version.dropped)) };
  const summary = libraryItems(published.doc);
  if (!summary.length) throw new ValidationError('Keep at least one item to publish.');
  const libraryKey = objectKey(actor.workspace.id, system.id);
  await storage.put(libraryKey, await writeLibraryFile(published));

  const row = await db.transaction(async (tx) => {
    const [v] = await tx
      .update(designSystemVersions)
      .set({ libraryKey, summary, publishedAt: new Date(), publishedBy: actor.userId })
      .where(
        and(
          eq(designSystemVersions.id, version.id),
          sql`${designSystemVersions.publishedAt} is null`,
        ),
      )
      .returning();
    if (v)
      await tx
        .update(designSystems)
        .set({ publishedVersionId: v.id })
        .where(eq(designSystems.id, system.id));
    return v;
  });
  if (!row) {
    // Someone else published it first; theirs stands.
    await storage.delete(libraryKey).catch(() => {});
    return (await getDesignSystem(db, actor, input.systemId)).version;
  }
  return row;
}

/** No new file starts from it any more; files that did keep what they have. */
export async function unpublishDesignSystem(
  db: Db,
  actor: Actor,
  input: { systemId: string },
): Promise<void> {
  await assertManage(db, actor, 'design_system:publish');
  const system = await findSystem(db, actor, input.systemId);
  if (system.isDefault)
    throw new ValidationError('This is the default system. Make another one the default first.');
  await db
    .update(designSystems)
    .set({ publishedVersionId: null })
    .where(eq(designSystems.id, system.id));
}

/** Make a published system the workspace default, or clear the default (`systemId: null`). */
export async function setDefaultDesignSystem(
  db: Db,
  actor: Actor,
  input: { systemId: string | null },
): Promise<void> {
  await assertManage(db, actor, 'design_system:set_default');
  const system = input.systemId ? await findSystem(db, actor, input.systemId) : null;
  if (system && !system.publishedVersionId)
    throw new ValidationError('Publish the system before making it the default.');
  await db.transaction(async (tx) => {
    await tx
      .update(designSystems)
      .set({ isDefault: false })
      .where(
        and(eq(designSystems.workspaceId, actor.workspace.id), eq(designSystems.isDefault, true)),
      );
    if (system)
      await tx
        .update(designSystems)
        .set({ isDefault: true })
        .where(eq(designSystems.id, system.id));
  });
}

export async function deleteDesignSystem(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: { systemId: string },
): Promise<void> {
  await assertManage(db, actor, 'design_system:publish');
  const system = await findSystem(db, actor, input.systemId);
  if (system.isDefault)
    throw new ValidationError('This is the default system. Make another one the default first.');
  const versions = await db
    .select({
      sourceKey: designSystemVersions.sourceKey,
      libraryKey: designSystemVersions.libraryKey,
    })
    .from(designSystemVersions)
    .where(eq(designSystemVersions.designSystemId, system.id));
  await db.delete(designSystems).where(eq(designSystems.id, system.id));
  for (const v of versions)
    for (const key of [v.sourceKey, v.libraryKey])
      if (key) await storage.delete(key).catch(() => {});
}

// ---- files that use a system ----

/**
 * Create a project whose document starts from the workspace's default system, when one is
 * published (see "What attached means" above); otherwise a project with no document yet.
 * All or nothing: the document is stored under a fresh key first, then the project, its file row
 * and the attachment are inserted in one transaction. If that fails, no row is left and the
 * stored document is deleted (best effort).
 */
export async function createProjectWithDefaultSystem(
  db: Db,
  actor: Actor,
  storage: DesignFileStorage,
  input: NewProjectInput,
): Promise<Project> {
  const values = newProjectValues(actor, input); // project:create
  const [found] = await db
    .select({ system: designSystems, version: designSystemVersions })
    .from(designSystems)
    .innerJoin(designSystemVersions, eq(designSystemVersions.id, designSystems.publishedVersionId))
    .where(
      and(eq(designSystems.workspaceId, actor.workspace.id), eq(designSystems.isDefault, true)),
    );
  const library = found?.version.libraryKey
    ? await readAll(storage, found.version.libraryKey)
    : null;
  if (!found || !library) return createProject(db, actor, input);

  const file = await readLibraryFile(library);
  const bytes = await writeLibraryFile({
    ...file,
    doc: startingDocument(file.doc, found.system.name),
  });
  const projectId = randomUUID();
  const key = newDesignFileKey(actor.workspace.id, projectId);
  await storage.put(key, bytes);
  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({ ...values, id: projectId })
        .returning();
      const [row] = await tx
        .insert(files)
        .values({
          workspaceId: actor.workspace.id,
          projectId,
          name: documentName(values.name),
          blobKey: key,
          size: bytes.byteLength,
          updatedBy: actor.userId,
        })
        .returning({ id: files.id });
      await tx.insert(designSystemAttachments).values({
        fileId: row!.id,
        workspaceId: actor.workspace.id,
        designSystemId: found.system.id,
        versionId: found.version.id,
      });
      return project!;
    });
  } catch (e) {
    await storage.delete(key).catch(() => {});
    throw e;
  }
}

export interface FileDesignSystem {
  system: { id: string; name: string };
  version: { id: string; version: number; guide: string; summary: DesignSystemItem[] };
}

/** The system a project's file started from, for the agent's prefix (10.5); null if none. */
export async function getFileDesignSystem(
  db: Db,
  actor: Actor,
  input: { projectId: string },
): Promise<FileDesignSystem | null> {
  const project = await getProject(db, actor, input.projectId); // project:read, workspace-scoped
  const [row] = await db
    .select({ system: designSystems, version: designSystemVersions })
    .from(files)
    .innerJoin(designSystemAttachments, eq(designSystemAttachments.fileId, files.id))
    .innerJoin(designSystems, eq(designSystems.id, designSystemAttachments.designSystemId))
    .innerJoin(designSystemVersions, eq(designSystemVersions.id, designSystemAttachments.versionId))
    .where(and(eq(files.projectId, project.id), eq(files.workspaceId, actor.workspace.id)));
  if (!row) return null;
  return {
    system: { id: row.system.id, name: row.system.name },
    version: {
      id: row.version.id,
      version: row.version.version,
      guide: row.version.guide,
      summary: row.version.summary ?? [],
    },
  };
}

async function readAll(storage: DesignFileStorage, key: string): Promise<Uint8Array | null> {
  const r = await storage.read(key);
  return r ? new Uint8Array(await new Response(r.body).arrayBuffer()) : null;
}
