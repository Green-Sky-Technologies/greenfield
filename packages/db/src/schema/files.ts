/** Epic 3: a project's `.figcraft` files (Story 3.1). Versions (`file_versions`) come with 3.3. */
import { integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
