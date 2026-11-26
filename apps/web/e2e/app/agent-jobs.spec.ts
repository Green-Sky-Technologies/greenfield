/**
 * Agent jobs and turn endpoints through the real app (Stories 4.4, 4.5, 4.7), signed in through
 * real Clerk, with no model call: in a deployment without a Linux figcraft-cli (the suite's
 * server runs with GREENFIELD_FIGCRAFT_CLI_URL=off) a job is accepted, fails at once with a clear
 * error, and its events replay from the start; viewers can't start jobs; the answer, revert and
 * version endpoints are workspace-scoped (404 for what isn't there).
 */
import { createProject, pageFetch, uniqueName } from './support/app';
import { expect, test } from './support/fixtures';

const missing = '00000000-0000-4000-8000-000000000000';

test('a job runs through the job API and reports why it cannot start here', async ({ as, run }) => {
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Jobs'));

  const started = await pageFetch(page, '/api/jobs', {
    method: 'POST',
    body: { kind: 'generate', projectId, input: { prompt: 'A pricing page' } },
  });
  expect(started.status).toBe(200);
  const job = JSON.parse(started.body) as { id: string; status: string; eventsUrl: string };
  expect(job).toMatchObject({ status: 'queued', eventsUrl: `/api/jobs/${job.id}/events` });

  await expect
    .poll(async () => JSON.parse((await pageFetch(page, `/api/jobs/${job.id}`)).body).status, {
      timeout: 30_000,
    })
    .toBe('failed');
  const failed = JSON.parse((await pageFetch(page, `/api/jobs/${job.id}`)).body) as {
    error: string;
    attempts: number;
  };
  expect(failed.error).toContain('figcraft-cli');
  expect(failed.attempts).toBe(1);

  // Closing the tab loses nothing: the stream replays every event, then ends.
  const events = await pageFetch(page, job.eventsUrl);
  expect(events.body).toContain('"status":"queued"');
  expect(events.body).toContain('"status":"failed"');
  expect(events.body).toContain('event: done');

  for (const [url, body] of [
    [`/api/agent/messages/${missing}/answer`, { skip: true }],
    [`/api/agent/messages/${missing}/revert`, { how: 'undo' }],
  ] as const)
    expect((await pageFetch(page, url, { method: 'POST', body })).status).toBe(404);
  expect((await pageFetch(page, `/api/file-versions/${missing}`)).status).toBe(404);

  const viewer = await as('viewer');
  await viewer.goto(`/w/${run.org.slug}`);
  const denied = await pageFetch(viewer, '/api/jobs', {
    method: 'POST',
    body: { kind: 'generate', projectId, input: { prompt: 'x' } },
  });
  expect(denied.status).toBe(403);
});
