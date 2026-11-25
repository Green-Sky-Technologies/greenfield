/** Epic 3: a project's `.figcraft` files (Story 3.1) and their versions (agent versions: 4.5). */
import { index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { jobs } from './agent';
import { projects, timestamps, workspaces } from './core';

/**
 * The stored document. `blob_key` points at the bytes in Blob (or the local fallback); a save
 * uploads to a new key and only becomes the document when this row is moved to it, so a refused
 * save never replaces what is stored. One file per project for now (unique on project_id).
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    blobKey: text('blob_key').notNull(),
    size: integer('size').notNull(),
    updatedBy: text('updated_by').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('files_project_idx').on(t.projectId)],
);

export type FileRow = typeof files.$inferSelect;

export const fileVersionKindEnum = pgEnum('file_version_kind', ['auto', 'agent', 'named']);

/**
 * A stored copy of a project's document. `agent` versions are what a job produced (Story 4.5):
 * the job works on a copy of the file, and its result lands here for review instead of
 * replacing the document. Story 3.3 adds `auto` and `named` versions.
 */
export const fileVersions = pgTable(
  'file_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: fileVersionKindEnum('kind').notNull(),
    name: text('name'),
    blobKey: text('blob_key').notNull(),
    size: integer('size').notNull(),
    /** The job that produced an `agent` version. */
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (t) => [index('file_versions_project_idx').on(t.projectId, t.createdAt)],
);

export type FileVersionRow = typeof fileVersions.$inferSelect;
