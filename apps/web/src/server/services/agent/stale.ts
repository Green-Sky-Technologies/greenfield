/**
 * Settle interactive replies that can no longer finish, so the chat doesn't show them as
 * streaming forever. Job messages are settled by the job lifecycle. Runs on read (chat load,
 * message stream) and from the job reaper cron.
 *
 * - A model step whose function died (time limit or crash): `error`, after STALE_TURN_MS.
 * - A turn waiting on its editor tab (Story 4.2) whose tab is gone (no stream, claim or result
 *   for TOOL_LEASE_MS): `cancelled`. A hidden tab keeps its stream open, so it only pauses.
 */
import { agentMessages, and, eq, inArray, isNull, sql, type Db } from '@greenfield/db';
import { TOOL_LEASE_MS } from './turn';

/** Older than the longest possible model step (route maxDuration 300s) plus slack. */
export const STALE_TURN_MS = 6 * 60_000;
const INTERRUPTED_ERROR = 'The reply was interrupted. Try again.';
export const TAB_CLOSED_ERROR = 'Stopped: the editor tab was closed.';

export async function settleStaleMessages(
  db: Db,
  opts: { conversationId?: string; messageId?: string; now?: Date } = {},
): Promise<number> {
  const now = (opts.now ?? new Date()).getTime();
  const stale = new Date(now - STALE_TURN_MS).toISOString();
  const lease = new Date(now - TOOL_LEASE_MS).toISOString();
  const c = agentMessages.content;
  const scope = and(
    inArray(agentMessages.status, ['pending', 'streaming']),
    isNull(agentMessages.jobId),
    opts.conversationId ? eq(agentMessages.conversationId, opts.conversationId) : undefined,
    opts.messageId ? eq(agentMessages.id, opts.messageId) : undefined,
  );
  const closed = await db
    .update(agentMessages)
    .set({ status: 'cancelled', error: TAB_CLOSED_ERROR })
    .where(
      and(
        scope,
        sql`${c}->'run'->>'phase' = 'tools'`,
        sql`(${c}->'run'->>'seenAt')::timestamptz < ${lease}::timestamptz`,
      ),
    )
    .returning({ id: agentMessages.id });
  const dead = await db
    .update(agentMessages)
    .set({ status: 'error', error: INTERRUPTED_ERROR })
    .where(
      and(
        scope,
        sql`case
          when jsonb_typeof(${c}->'run') = 'object' then
            ${c}->'run'->>'phase' <> 'tools' and (${c}->'run'->>'at')::timestamptz < ${stale}::timestamptz
          else ${agentMessages.createdAt} < ${stale}::timestamptz
        end`,
      ),
    )
    .returning({ id: agentMessages.id });
  return closed.length + dead.length;
}
