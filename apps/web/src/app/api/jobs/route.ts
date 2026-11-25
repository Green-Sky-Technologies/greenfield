/**
 * POST /api/jobs <- { kind: 'generate' | 'redesign' | 'alternatives', input, projectId,
 *                     conversationId?, messageId? }
 *               -> JobView (+ eventsUrl)
 *
 * Starts an agent job (Story 4.5) in a Vercel Sandbox after the response. Follow it on
 * eventsUrl (SSE, resumable with Last-Event-ID: close the tab and come back), stop it with
 * POST /api/jobs/:id/cancel. The result is an `agent` version (`result.versionId`). Other job
 * kinds answer 503 `agent_unavailable` until their stories.
 */
import { jobEventsUrl } from '@greenfield/contracts';
import { getDb } from '@greenfield/db';
import { after, NextResponse } from 'next/server';
import { apiActor, apiError, jsonBody } from '@/server/api';
import { startAgentJob } from '@/server/services/agent/agent-jobs';
import { jobRunner } from '@/server/services/agent/runner';
import { startJob, toJobView } from '@/server/services/jobs';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const actor = await apiActor();
    const job = await startAgentJob(getDb(), actor, await jsonBody(req, 64 * 1024));
    after(() => startJob(getDb(), job.id, { runner: jobRunner() }).then(() => undefined));
    return NextResponse.json({ ...toJobView(job), eventsUrl: jobEventsUrl(job.id) });
  } catch (e) {
    return apiError(e);
  }
}
