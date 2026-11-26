/**
 * Wires the Vercel Sandbox runner to the app. Nothing secret goes into a job spec; the job token
 * is the only credential the sandbox sees.
 */
import type { JobRunner, StartJob } from '@greenfield/contracts';
import { getDb, type Db } from '@greenfield/db';
import { VercelSandboxRunner, type PreparedJob, type SandboxApi } from '@greenfield/sandbox-runner';
import { defaultDesignFileStorage, type DesignFileStorage } from '../design-files';
import { prepareAgentJob } from './agent-jobs';
import { AgentUnavailableError } from '../types';

/**
 * Build a job's sandbox spec (Story 4.5): a copy of the file, the CLI pin, the job token. A
 * sandbox runs in Vercel's cloud and calls the app back, so a loopback app URL fails the job at
 * once (retrying can't help) instead of leaving it queued.
 */
export async function prepareJob(
  job: StartJob,
  env: Record<string, string | undefined> = process.env,
  db: Db = getDb(),
  storage: DesignFileStorage = defaultDesignFileStorage(),
): Promise<PreparedJob> {
  const prepared = await prepareAgentJob(db, storage, job, env);
  const url = appUrl(env);
  if (LOOPBACK.test(new URL(url).hostname))
    throw new AgentUnavailableError(
      `Agent jobs run in a Vercel Sandbox, which can't reach this app at ${url}. Set GREENFIELD_APP_URL to a public URL of this deployment.`,
    );
  return prepared;
}

const LOOPBACK = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1?\])$/;

/**
 * Base URL sandboxes call back to (LLM proxy, job API). GREENFIELD_APP_URL wins. Otherwise a preview
 * deployment calls back to itself (VERCEL_URL), never to production; production uses its
 * production URL.
 */
export function appUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = env.GREENFIELD_APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return `http://localhost:${env.PORT ?? 3000}`;
}

const bypass = () => process.env.VERCEL_AUTOMATION_BYPASS_SECRET || undefined;

const g = globalThis as unknown as { __greenfieldJobRunner?: JobRunner };

/** The app's JobRunner. Tests pass their own; `api` lets local dev inject a fake sandbox. */
export function jobRunner(opts: { api?: SandboxApi } = {}): JobRunner {
  if (opts.api)
    return new VercelSandboxRunner({
      appUrl: appUrl(),
      api: opts.api,
      protectionBypassSecret: bypass(),
      prepare: prepareJob,
    });
  return (g.__greenfieldJobRunner ??= new VercelSandboxRunner({
    appUrl: appUrl(),
    protectionBypassSecret: bypass(),
    prepare: prepareJob,
  }));
}
