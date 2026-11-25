import { assertCan } from '@greenfield/authz';
import { and, desc, eq, isNotNull, isNull, projects, type Db, type Project } from '@greenfield/db';
import { z } from 'zod';
import { NotFoundError, ValidationError, type Actor } from './types';

const nameSchema = z.string().trim().min(1, 'Name is required').max(120, 'Name is too long');
const descriptionSchema = z.string().trim().max(1000).optional();

function parse<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const msg = r.error.issues[0]?.message ?? 'Invalid value';
    throw new ValidationError(msg, { [field]: [msg] });
  }
  return r.data;
}

export async function listProjects(
  db: Db,
  actor: Actor,
  opts: { archived?: boolean } = {},
): Promise<Project[]> {
  assertCan(actor.role, 'project:read');
  return db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, actor.workspace.id),
        opts.archived ? isNotNull(projects.archivedAt) : isNull(projects.archivedAt),
      ),
    )
    .orderBy(desc(projects.updatedAt));
}

/** Scoped to the actor's workspace, so a project id from another workspace is "not found" (no IDOR). */
export async function getProject(db: Db, actor: Actor, projectId: string): Promise<Project> {
  assertCan(actor.role, 'project:read');
  if (!z.uuid().safeParse(projectId).success) throw new NotFoundError('Project not found');
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, actor.workspace.id)))
    .limit(1);
  if (!p) throw new NotFoundError('Project not found');
  return p;
}

export interface NewProjectInput {
  name: unknown;
  description?: unknown;
}

/** A new project's row in the actor's workspace, checked (`project:create`) and validated. */
export function newProjectValues(actor: Actor, input: NewProjectInput) {
  assertCan(actor.role, 'project:create');
  const name = parse(nameSchema, input.name, 'name');
  const description = parse(descriptionSchema, input.description || undefined, 'description');
  return {
    workspaceId: actor.workspace.id,
    name,
    description: description ?? null,
    createdBy: actor.userId,
  } satisfies typeof projects.$inferInsert;
}

export async function createProject(
  db: Db,
  actor: Actor,
  input: NewProjectInput,
): Promise<Project> {
  const [p] = await db.insert(projects).values(newProjectValues(actor, input)).returning();
  return p!;
}

export async function renameProject(
  db: Db,
  actor: Actor,
  projectId: string,
  name: unknown,
): Promise<Project> {
  assertCan(actor.role, 'project:update');
  const next = parse(nameSchema, name, 'name');
  await getProject(db, actor, projectId);
  const [p] = await db
    .update(projects)
    .set({ name: next })
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, actor.workspace.id)))
    .returning();
  return p!;
}

/** Duplicates project metadata. The caller copies the design file (services/design-files). */
export async function duplicateProject(db: Db, actor: Actor, projectId: string): Promise<Project> {
  assertCan(actor.role, 'project:create');
  const src = await getProject(db, actor, projectId);
  const [p] = await db
    .insert(projects)
    .values({
      workspaceId: src.workspaceId,
      name: `${src.name} (copy)`.slice(0, 120),
      description: src.description,
      thumbnailUrl: src.thumbnailUrl,
      createdBy: actor.userId,
    })
    .returning();
  return p!;
}

export async function setProjectArchived(
  db: Db,
  actor: Actor,
  projectId: string,
  archived: boolean,
): Promise<Project> {
  assertCan(actor.role, 'project:archive');
  await getProject(db, actor, projectId);
  const [p] = await db
    .update(projects)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, actor.workspace.id)))
    .returning();
  return p!;
}
