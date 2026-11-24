/** Files in Vercel Blob (uploads, screenshots, thumbnails, web captures, exports). */
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projects, workspaces } from './core';

export const assetKindEnum = pgEnum('asset_kind', [
  'upload',
  'screenshot',
  'thumbnail',
  'capture',
  'export',
  'figma',
]);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    kind: assetKindEnum('kind').notNull(),
    blobUrl: text('blob_url').notNull(),
    pathname: text('pathname').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    sha256: text('sha256'),
    meta: jsonb('meta'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assets_project_idx').on(t.projectId, t.kind)],
);

export type AssetRow = typeof assets.$inferSelect;
