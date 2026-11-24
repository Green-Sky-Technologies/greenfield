/**
 * In-app notifications (mentions, control requests, job completions). Always scoped to the
 * caller's own user id and workspace. Story 6.3 creates them from the comment mirror.
 */
import { assertCan } from '@greenfield/authz';
import { and, desc, eq, inArray, isNull, notifications, type Db } from '@greenfield/db';
import { z } from 'zod';
import { ValidationError, type Actor } from './types';

export interface NotificationView {
  id: string;
  kind: string;
  projectId: string | null;
  data: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export async function listNotifications(
  db: Db,
  actor: Actor,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationView[]> {
  assertCan(actor.role, 'workspace:read');
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, actor.workspace.id),
        eq(notifications.userId, actor.userId),
        opts.unreadOnly ? isNull(notifications.readAt) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    projectId: r.projectId,
    data: (r.data ?? {}) as Record<string, unknown>,
    readAt: r.readAt,
    createdAt: r.createdAt,
  }));
}

/** Mark the caller's notifications read: the given ids, or all of them. */
export async function markNotificationsRead(
  db: Db,
  actor: Actor,
  ids: unknown,
): Promise<{ updated: number }> {
  assertCan(actor.role, 'workspace:read');
  let list: string[] | null = null;
  if (ids !== 'all') {
    const r = z.array(z.uuid()).max(200).safeParse(ids);
    if (!r.success) throw new ValidationError(r.error.issues[0]?.message ?? 'Invalid input');
    list = r.data;
  }
  if (list && !list.length) return { updated: 0 };
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.workspaceId, actor.workspace.id),
        eq(notifications.userId, actor.userId),
        isNull(notifications.readAt),
        list ? inArray(notifications.id, list) : undefined,
      ),
    )
    .returning({ id: notifications.id });
  return { updated: rows.length };
}
