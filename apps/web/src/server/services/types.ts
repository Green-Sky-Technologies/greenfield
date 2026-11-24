import type { Role } from '@greenfield/authz';
import type { Workspace } from '@greenfield/db';

/** The authenticated caller, resolved once per request. */
export interface Actor {
  userId: string;
  role: Role;
  workspace: Workspace;
}

export class NotFoundError extends Error {
  override name = 'NotFoundError';
}

/**
 * A feature that isn't available in this build: the agent's tools and jobs were built on the
 * HTML model (removed in Story 1.2) and come back with Epic 4. Routes answer 503.
 */
export class AgentUnavailableError extends Error {
  override name = 'AgentUnavailableError';
  constructor(message = 'The agent is not available yet. It returns with the new editor tools.') {
    super(message);
  }
}

export class ValidationError extends Error {
  override name = 'ValidationError';
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}
