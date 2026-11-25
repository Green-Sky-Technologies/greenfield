/**
 * Epic 10: design systems. A system is a `.figcraft` library file (variables, styles,
 * components) plus a markdown guide for Claude, kept as numbered versions.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps, workspaces } from './core';
import { files } from './files';

/** Who may publish design systems and set the default (`@greenfield/authz`). */
export const designSystemManagersEnum = pgEnum('design_system_managers', [
  'admins',
  'admins_and_editors',
]);

/** A colour, as `#rrggbb` or `#rrggbbaa`. */
type Hex = string;

/**
 * One thing a review keeps or drops (Story 10.3), read from the library file. `key` is stable
 * for the file: `colours:<collection id>` (the colour variables of one variable collection),
 * `colours:styles/<folder>` (paint styles in one folder), `spacing:<collection id>` (the number
 * variables of one collection: spacing, radius and other scales), `type:<style id>`,
 * `component:<node id>`.
 */
export type DesignSystemItem =
  | { key: string; kind: 'colours'; name: string; colours: { name: string; hex: Hex | null }[] }
  | { key: string; kind: 'spacing'; name: string; values: { name: string; value: number }[] }
  | {
      key: string;
      kind: 'type';
      name: string;
      fontFamily: string;
      fontStyle: string;
      fontSize: number;
    }
  | { key: string; kind: 'component'; name: string; variants: number };

/** A source a system was built from (Story 10.2), kept so a rebuild can read it again (10.6). */
export type DesignSystemSource =
  | { kind: 'github'; owner: string; repo: string; ref: string | null }
  | { kind: 'upload'; names: string[] };

export const designSystems = pgTable(
  'design_systems',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The version files get when they start from this system; null while it's a draft. */
    publishedVersionId: uuid('published_version_id').references(
      (): AnyPgColumn => designSystemVersions.id,
      { onDelete: 'set null' },
    ),
    /** At most one per workspace: attached to every new file (Story 10.4). */
    isDefault: boolean('is_default').notNull().default(false),
    /** Where it was built from (Story 10.2); empty for an uploaded library file. */
    sources: jsonb('sources').$type<DesignSystemSource[]>().notNull().default([]),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (t) => [
    index('design_systems_workspace_idx').on(t.workspaceId),
    uniqueIndex('design_systems_default_idx')
      .on(t.workspaceId)
      .where(sql`${t.isDefault}`),
  ],
);

/**
 * One version of a system. `source_key` is the uploaded (or built, 10.2) library file; publishing
 * removes the dropped items and stores the result at `library_key`, which never changes after.
 * Both live in private Blob (or the local fallback) like design files.
 */
export const designSystemVersions = pgTable(
  'design_system_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    designSystemId: uuid('design_system_id')
      .notNull()
      .references(() => designSystems.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    sourceKey: text('source_key').notNull(),
    /** Markdown the agent reads before every design (Story 10.5). */
    guide: text('guide').notNull().default(''),
    /** What the review offers, read from the source file. */
    items: jsonb('items').$type<DesignSystemItem[]>().notNull(),
    /** Keys of `items` the review drops. */
    dropped: jsonb('dropped').$type<string[]>().notNull().default([]),
    libraryKey: text('library_key'),
    /** `items` as published: what's in `library_key`, read back from it. */
    summary: jsonb('summary').$type<DesignSystemItem[]>(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: text('published_by'),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('design_system_versions_idx').on(t.designSystemId, t.version)],
);

/** A workspace's design system policy; no row means the defaults. */
export const designSystemSettings = pgTable('design_system_settings', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  managers: designSystemManagersEnum('managers').notNull().default('admins'),
  ...timestamps,
});

/**
 * The system version a file started from (Story 10.4). The file holds that version's variables,
 * styles and components (see services/design-systems); this row says which system they came
 * from, for the agent's prefix (10.5) and library updates (10.6).
 */
export const designSystemAttachments = pgTable(
  'design_system_attachments',
  {
    fileId: uuid('file_id')
      .primaryKey()
      .references(() => files.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    designSystemId: uuid('design_system_id')
      .notNull()
      .references(() => designSystems.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => designSystemVersions.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [index('design_system_attachments_system_idx').on(t.designSystemId)],
);

export type DesignSystem = typeof designSystems.$inferSelect;
export type DesignSystemVersion = typeof designSystemVersions.$inferSelect;
