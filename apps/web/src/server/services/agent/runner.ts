/**
 * Wires the Vercel Sandbox runner to the app. Nothing secret goes into a job spec; the job token
 * is the only credential the sandbox sees.
 */
import type { JobRunner } from '@greenfield/contracts';
import { VercelSandboxRunner, type PreparedJob, type SandboxApi } from '@greenfield/sandbox-runner';
import { AgentUnavailableError } from '../types';
import { readEnv } from '@/server/env';

/**
 * Build a job's sandbox spec. Not available until Story 4.5: the jobs drove the HTML model's
 * DesignDoc through MCP tools served by the app (removed in Story 1.2); the new ones run
 * headless figcraft-cli on a copy of the file. Throwing here fails the job with a clear error
 * (startJob records it) instead of starting a sandbox that has no tools.
 */
export async function prepareJob(): Promise<PreparedJob> {
  throw new AgentUnavailableError('Agent jobs are not available yet. They return in Epic 4.');
}

/**
 * Base URL sandboxes call back to (LLM proxy, job API). GREENFIELD_APP_URL wins. Otherwise a preview
 * deployment calls back to itself (VERCEL_URL), never to production; production uses its
 * production URL.
 */
export function appUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = readEnv('GREENFIELD_APP_URL', env);
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
      prepare: () => prepareJob(),
    });
  return (g.__greenfieldJobRunner ??= new VercelSandboxRunner({
    appUrl: appUrl(),
    protectionBypassSecret: bypass(),
    prepare: () => prepareJob(),
  }));
}
