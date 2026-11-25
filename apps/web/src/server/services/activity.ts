import { activity, type Db } from '@greenfield/db';
import type { Actor } from './types';

export type ActivityVerb =
  | 'comment.created'
  | 'comment.replied'
  | 'comment.resolved'
  | 'comment.reopened'
  | 'comment.agent_requested'
  | 'share.created'
  | 'share.updated'
  | 'share.revoked';

export interface ActivityInput {
  projectId: string;
  verb: ActivityVerb;
  targetType?: string;
  targetId?: string;
  data?: Record<string, unknown>;
  actorType?: 'user' | 'agent' | 'system';
}

/** Append an activity row. Callers have already authorized the underlying action. */
export async function recordActivity(db: Db, actor: Actor, input: ActivityInput): Promise<void> {
  await db.insert(activity).values({
    workspaceId: actor.workspace.id,
    projectId: input.projectId,
    actorType: input.actorType ?? 'user',
    actorId: actor.userId,
    verb: input.verb,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    data: input.data ?? {},
  });
}
