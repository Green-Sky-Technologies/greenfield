import { pgEnum } from 'drizzle-orm/pg-core';

/** Who made a change. Agent changes are attributed to the requesting user via actorId. */
export const actorTypeEnum = pgEnum('actor_type', ['user', 'agent', 'system']);
