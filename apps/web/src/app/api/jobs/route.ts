/**
 * POST /api/jobs <- { kind, input, projectId?, conversationId?, messageId?, timeoutSeconds? }
 *
 * Answers 503 `agent_unavailable` until Story 4.5: every job kind ran the HTML model's agent
 * tools, removed in Story 1.2. The rest of the job API (events, cancel, report, reap) stays.
 */
import { assertCan } from '@greenfield/authz';
import { apiActor, apiError } from '@/server/api';
import { AgentUnavailableError } from '@/server/services/types';

export async function POST() {
  try {
    const actor = await apiActor();
    assertCan(actor.role, 'agent:run');
    throw new AgentUnavailableError('Agent jobs are not available yet. They return in Epic 4.');
  } catch (e) {
    return apiError(e);
  }
}
