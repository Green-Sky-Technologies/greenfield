/**
 * Epic 6: comments. Threads live in the `.figcraft` file (D23); `comment_index` mirrors them on
 * every save (Story 6.1) so notifications and @mentions (6.3) can query them without the file.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects, workspaces } from './core';

/** A reply as mirrored: the file's message plus the member it was matched to, if any. */
export interface IndexedCommentReply {
  author: string;
  authorId: string | null;
  text: string;
  createdAt: string;
  editedAt: string | null;
}

/**
 * One thread of a project's file. `threadId` is the editor's id, unique within the file but
 * reused after a delete, so a row is replaced when the thread under that id changes
 * (`createdAt` differs). Authors are the editor's display names; `authorId` is the workspace
 * member with that name when exactly one has it.
 */
export const commentIndex = pgTable(
  'comment_index',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    threadId: integer('thread_id').notNull(),
    pageId: integer('page_id').notNull(),
    /** The layer the pin follows; null when pinned to the page. */
    nodeId: integer('node_id'),
    author: text('author').notNull(),
    authorId: text('author_id'),
    body: text('body').notNull(),
    replies: jsonb('replies').$type<IndexedCommentReply[]>().notNull().default([]),
    resolved: boolean('resolved').notNull().default(false),
    /** When the thread was written (from the file). */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    /** The latest message written or edited (from the file). */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    /** The save that last changed this row. */
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('comment_index_project_thread_idx').on(t.projectId, t.threadId),
    index('comment_index_workspace_author_idx').on(t.workspaceId, t.authorId),
  ],
);

export type CommentIndexRow = typeof commentIndex.$inferSelect;
