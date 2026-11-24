/**
 * Comments (Story 6.1). Threads live in the project's `.figcraft` file (D23): people write,
 * reply, resolve and delete them in the editor's own comment UI, anchored to layer ids so they
 * follow their layer. Every save mirrors the file's threads into `comment_index`, which
 * notifications and @mentions (6.3) read without opening the file.
 *
 * The server reads the threads out of the saved bytes rather than trusting a list the client
 * sends with the save: the file is the record, and the mirror can't drift from it.
 *
 * Comments reach the server only inside a saved file, so writing them takes what saving takes
 * (`design:edit`, not archived). Viewers can't: their role is view-only (`design:comment` is
 * editors' and admins'), and their editor never saves.
 */
import { assertCan } from '@greenfield/authz';
import {
  and,
  asc,
  commentIndex,
  eq,
  inArray,
  members,
  sql,
  users,
  type CommentIndexRow,
  type Db,
  type IndexedCommentReply,
} from '@greenfield/db';
import { readFileComments, type FileCommentThread } from '@greenfield/bridge/file';
import { getProject } from './projects';
import { ValidationError, type Actor } from './types';

export interface CommentThreadView {
  threadId: number;
  pageId: number;
  nodeId: number | null;
  author: string;
  authorId: string | null;
  body: string;
  replies: IndexedCommentReply[];
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const toView = (r: CommentIndexRow): CommentThreadView => ({
  threadId: r.threadId,
  pageId: r.pageId,
  nodeId: r.nodeId,
  author: r.author,
  authorId: r.authorId,
  body: r.body,
  replies: r.replies,
  resolved: r.resolved,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** The project's mirrored threads, oldest first. */
export async function listComments(
  db: Db,
  actor: Actor,
  projectId: string,
  opts: { resolved?: boolean } = {},
): Promise<CommentThreadView[]> {
  const project = await getProject(db, actor, projectId); // project:read, workspace-scoped
  const rows = await db
    .select()
    .from(commentIndex)
    .where(
      and(
        eq(commentIndex.projectId, project.id),
        eq(commentIndex.workspaceId, actor.workspace.id),
        opts.resolved === undefined ? undefined : eq(commentIndex.resolved, opts.resolved),
      ),
    )
    .orderBy(asc(commentIndex.createdAt), asc(commentIndex.threadId));
  return rows.map(toView);
}

/**
 * Mirror the threads in a saved file into `comment_index`: new threads are added, changed ones
 * updated, and ones gone from the file removed. Idempotent: a later save repairs a missed one.
 * Bytes that aren't a readable `.figcraft` document leave the index as it was (returns null).
 */
export async function mirrorFileComments(
  db: Db,
  actor: Actor,
  input: { projectId: string; bytes: Uint8Array },
): Promise<{ threads: number } | null> {
  assertCan(actor.role, 'design:edit');
  const project = await getProject(db, actor, input.projectId);
  if (project.archivedAt)
    throw new ValidationError('This project is archived. Restore it to edit.');
  const threads = await readFileComments(input.bytes);
  if (!threads) return null;

  const memberIds = await membersByName(db, actor, threads);
  const id = (name: string) => memberIds.get(name) ?? null;
  // Thread ids are unique in a file the editor wrote; keep the last if one isn't. Ids that
  // don't fit the int columns can't come from the editor either.
  const fits = (n: number | null) => n === null || (n >= 0 && n <= INT4_MAX);
  const byId = new Map(
    threads.filter((t) => fits(t.id) && fits(t.page) && fits(t.anchor)).map((t) => [t.id, t]),
  );
  const rows = [...byId.values()].map((t) => ({
    workspaceId: actor.workspace.id,
    projectId: project.id,
    threadId: t.id,
    pageId: t.page,
    nodeId: t.anchor,
    author: t.author,
    authorId: id(t.author),
    body: t.text,
    replies: t.replies.map((r) => ({
      author: r.author,
      authorId: id(r.author),
      text: r.text,
      createdAt: date(r.created).toISOString(),
      editedAt: r.edited ? date(r.edited).toISOString() : null,
    })),
    resolved: t.resolved,
    createdAt: date(t.created),
    updatedAt: date(latest(t)),
  }));

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: commentIndex.id,
        threadId: commentIndex.threadId,
        createdAt: commentIndex.createdAt,
      })
      .from(commentIndex)
      .where(eq(commentIndex.projectId, project.id));
    // Gone from the file, or the editor reused the id for a new thread: drop the old row.
    const created = new Map(rows.map((r) => [r.threadId, r.createdAt.getTime()]));
    const stale = existing
      .filter((e) => created.get(e.threadId) !== e.createdAt.getTime())
      .map((e) => e.id);
    for (let i = 0; i < stale.length; i += CHUNK)
      await tx.delete(commentIndex).where(inArray(commentIndex.id, stale.slice(i, i + CHUNK)));

    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx
        .insert(commentIndex)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: [commentIndex.projectId, commentIndex.threadId],
          set: {
            pageId: sql`excluded.page_id`,
            nodeId: sql`excluded.node_id`,
            author: sql`excluded.author`,
            authorId: sql`excluded.author_id`,
            body: sql`excluded.body`,
            replies: sql`excluded.replies`,
            resolved: sql`excluded.resolved`,
            updatedAt: sql`excluded.updated_at`,
            indexedAt: sql`now()`,
          },
        });
    }
  });
  return { threads: rows.length };
}

const CHUNK = 500;
const INT4_MAX = 2_147_483_647;

const date = (unixSeconds: number) => new Date(unixSeconds * 1000);

function latest(t: FileCommentThread): number {
  return Math.max(...[t, ...t.replies].map((m) => Math.max(m.created, m.edited ?? 0)));
}

/**
 * The editor knows authors by display name. Map each name to the workspace member who has it,
 * when exactly one does; other names (guests, the agent, duplicates) stay unmatched.
 */
async function membersByName(
  db: Db,
  actor: Actor,
  threads: FileCommentThread[],
): Promise<Map<string, string>> {
  const names = [...new Set(threads.flatMap((t) => [t.author, ...t.replies.map((r) => r.author)]))];
  if (!names.length) return new Map();
  const rows = await db
    .select({ userId: members.userId, name: users.name })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.workspaceId, actor.workspace.id), inArray(users.name, names)));
  const byName = new Map<string, string[]>();
  for (const r of rows) if (r.name) byName.set(r.name, [...(byName.get(r.name) ?? []), r.userId]);
  return new Map(
    [...byName].flatMap(([name, ids]) => (ids.length === 1 ? [[name, ids[0]!] as const] : [])),
  );
}

/** Workspace members a comment may mention, and the people shown in the top bar. */
export async function listMentionableMembers(
  db: Db,
  actor: Actor,
): Promise<
  { userId: string; name: string | null; email: string | null; imageUrl: string | null }[]
> {
  assertCan(actor.role, 'project:read');
  return db
    .select({
      userId: members.userId,
      name: users.name,
      email: users.email,
      imageUrl: users.imageUrl,
    })
    .from(members)
    .leftJoin(users, eq(users.id, members.userId))
    .where(eq(members.workspaceId, actor.workspace.id))
    .orderBy(asc(users.name), asc(members.userId))
    .limit(500);
}
