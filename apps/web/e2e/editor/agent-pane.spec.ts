/**
 * The agent pane with the real editor and real agent turns (Stories 5.2, 5.5, 4.4, 4.5, 4.7).
 * The model is a scripted stub (`support/stub-model.ts`): run the dev server with
 * `ANTHROPIC_BASE_URL=http://127.0.0.1:$STUB_MODEL_PORT` (default 35416). The workspace gets an
 * Anthropic credential through the settings page, which the stub passes.
 *
 * - 4.7 / 5.5: a message goes with the selection; the reply runs its edit through the editor, lists
 *   what changed (matching the layer as the editor reports it), "Show on canvas" selects and
 *   zooms to it, "Undo all" puts it back. Claude's avatar is ringed while the turn runs.
 * - 4.4 / 5.2: follow-up questions answered from the card; Stop, Retry, a queued message, and a
 *   provider error retried.
 * - 4.5: a job offer started for real fails here with its reason (no sandbox in this deployment);
 *   a job playing the sandbox's side of the job API streams its progress into the card, survives
 *   a reload, and its result opens in the editor for review; another is cancelled.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openEditor, type RemoteEditor } from '@greenfield/bridge/playwright';
import {
  agentConversations,
  agentMessages,
  and,
  createDb,
  desc,
  eq,
  isNull,
  jobEvents,
  jobs,
  jobTokens,
  projects,
} from '@greenfield/db';
import type { Page } from '@playwright/test';
import { createProject, uniqueName } from '../app/support/app';
import { WEB_DIR } from '../app/support/env';
import { expect, test } from '../app/support/fixtures';
import { formatValue } from '../../src/features/agent/format';
import { startStubModel, STUB_FILL, type StubModel } from './support/stub-model';

const STUB_PORT = Number(process.env.STUB_MODEL_PORT ?? 35416);
let stub: StubModel;

test.beforeAll(async () => {
  stub = await startStubModel(STUB_PORT);
});
test.afterAll(async () => {
  await stub?.close();
});

/** The workspace's model credential: an Anthropic key, which the stub accepts. */
async function connectModel(page: Page, slug: string) {
  await page.goto(`/w/${slug}/settings/credentials`);
  const edit = page.getByRole('button', { name: /Replace|Change|Edit/ });
  if (await edit.isVisible().catch(() => false)) return;
  await page.getByLabel('API key', { exact: true }).fill(`sk-ant-api03-${'x'.repeat(60)}`);
  await page.getByRole('button', { name: 'Save and test' }).click();
  await expect(page.getByText('Connected')).toBeVisible();
}

async function openProject(page: Page, slug: string, prefix: string) {
  const projectId = await createProject(page, slug, uniqueName(prefix));
  const editor = await openEditor(page, { hostPath: `/w/${slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');
  const pane = page.getByRole('region', { name: 'Agent' });
  await expect(pane).toBeVisible();
  return { projectId, editor, pane };
}

async function addCard(editor: RemoteEditor): Promise<number> {
  const [card] = (await editor.batch(
    [
      {
        command: 'node.create',
        params: {
          type: 'frame',
          name: 'Card',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
        },
      },
    ],
    { label: 'Add card' },
  )) as [{ id: number }];
  await editor.execute('select.set', { ids: [card.id] });
  return card.id;
}

const send = async (page: Page, text: string) => {
  const box = page.getByRole('textbox', { name: 'Message Claude' });
  // Firefox: just after the file opens, the editor takes focus back once (base behaviour).
  await expect(async () => {
    await box.fill(text);
    await expect(box).toHaveValue(text, { timeout: 500 });
    await expect(box).toBeFocused({ timeout: 500 });
  }).toPass();
  await box.press('Enter');
};

const replies = (page: Page) =>
  page.getByTestId('agent-message').and(page.locator('[data-role="assistant"]'));

// Known noise from outside the pane (see canvas-mode.spec.ts).
const NOISE =
  /clerk\.accounts\.dev.*access control checks|\[editor\] CSP: Refused to apply a stylesheet/;

test('a turn on the selection: its changes listed, shown on the canvas and undone', async ({
  as,
  run,
  problems,
}, testInfo) => {
  await connectModel(await as('admin'), run.org.slug);
  const page = await as('editor');
  const { editor, pane } = await openProject(page, run.org.slug, 'Agent');
  const card = await addCard(editor);
  await expect(pane.getByTestId('selection-chip')).toHaveText('Card');

  // Watch Claude's avatar for the ember ring: it is held only while the turn runs.
  const avatar = page.getByTestId('claude-avatar');
  await expect(avatar).toHaveAttribute('data-active', 'false');
  await avatar.evaluate((el) => {
    const w = window as unknown as { claudeRinged?: boolean };
    new MutationObserver(() => {
      if (el.getAttribute('data-active') === 'true') w.claudeRinged = true;
    }).observe(el, { attributes: true });
  });

  const calls = stub.calls;
  await send(page, 'Make the card ember');
  const user = pane.getByTestId('agent-message').and(page.locator('[data-role="user"]'));
  await expect(user.last()).toContainText('Make the card ember');
  await expect(user.last().getByTestId('selection-chip')).toHaveText(/^Card/); // the layer's name now
  const reply = replies(page).last();
  await expect(reply).toHaveAttribute('data-status', 'complete', { timeout: 60_000 });
  await expect(reply).toContainText('Done: the card is ember.');
  expect(stub.calls - calls).toBe(3); // the edit, its answer, the self-check render

  // 4.7: the list matches the layer as the editor has it now.
  const node = (await editor.getNode(card, { fields: ['name', 'fills'] })) as unknown as {
    name: string;
    fills: { color: string }[];
  };
  expect(node.name).toBe('Card (ember)');
  expect(node.fills.map((f) => f.color.toLowerCase())).toEqual([STUB_FILL]);
  await expect(reply.getByTestId('change-row')).toHaveText([
    `Card (ember) · fills #FFFFFF → ${formatValue(node.fills)}`,
    'Card (ember) · name Card → Card (ember)',
  ]);
  await expect(reply.getByTestId('change-summary')).toHaveText('2 changes · one undo step');
  await page.screenshot({
    path: `${testInfo.project.outputDir}/agent-changes-${testInfo.project.name}.png`,
  });
  expect(await page.evaluate(() => (window as { claudeRinged?: boolean }).claudeRinged)).toBe(true);
  await expect(avatar).toHaveAttribute('data-active', 'false', { timeout: 15_000 });

  // 5.5: "Show on canvas" selects the layers and zooms to them.
  await editor.execute('select.none', {});
  await editor.execute('view.zoom50', {});
  await expect(pane.getByText(/^Nothing selected/)).toBeVisible();
  await reply.getByRole('button', { name: 'Show on canvas' }).click();
  await expect
    .poll(async () => (await editor.inspect({ depth: 0, fields: [] })).selection)
    .toEqual([card]);
  await expect
    .poll(async () => ((await editor.execute('view.get', {})) as { zoom: number }).zoom)
    .not.toBe(0.5);

  // 4.7: "Undo all" puts the layer back, and the reply stays marked as undone.
  await reply.getByRole('button', { name: 'Undo all' }).click();
  await expect(reply.getByTestId('change-summary')).toHaveText('Undone.');
  await expect
    .poll(async () => (await editor.getNode(card, { fields: ['name'] }))?.name)
    .toBe('Card');
  await page.reload();
  await expect(replies(page).last().getByTestId('change-summary')).toHaveText('Undone.');

  problems.splice(0, problems.length, ...problems.filter((p) => !NOISE.test(p)));
});

test('questions, stop, retry and a queued message', async ({ as, run, problems }, testInfo) => {
  await connectModel(await as('admin'), run.org.slug);
  const page = await as('editor');
  const { pane } = await openProject(page, run.org.slug, 'Agent questions');

  // 4.4: the card, answered.
  await send(page, '[ask] Design a pricing page');
  const card = pane.getByTestId('question-card');
  await expect(card).toContainText('Before I design it, two quick questions:');
  const send4 = card.getByRole('button', { name: 'Send answers' });
  await expect(send4).toBeDisabled();
  await card.getByRole('button', { name: 'Three' }).click();
  await card.getByRole('button', { name: 'FAQ' }).click();
  await card.getByRole('textbox', { name: /Anything to include/ }).fill('A quote');
  await expect(card.getByRole('button', { name: 'Three' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({
    path: `${testInfo.project.outputDir}/agent-questions-${testInfo.project.name}.png`,
  });
  await send4.click();
  await expect(card.getByTestId('question-outcome')).toHaveText('Answered.');
  await expect(replies(page).last()).toContainText('Thanks, designing with that.');
  await expect(card.getByRole('button', { name: 'Two' })).toBeDisabled();

  // 5.2: Stop a streaming reply; a message sent meanwhile waits, then goes.
  const before = await replies(page).count();
  await send(page, '[slow] Explain the layout');
  const slow = replies(page).nth(before);
  await expect(slow).toHaveAttribute('data-status', 'streaming');
  await expect(slow).toContainText('Thinking about this slowly');
  await send(page, '[say] Hello');
  await expect(pane.getByTestId('queued')).toHaveText('Next: [say] Hello');
  await slow.getByRole('button', { name: 'Stop' }).click();
  await expect(slow).toHaveAttribute('data-status', 'cancelled');
  await expect(slow).toContainText('Stopped.');
  await expect(replies(page).last()).toContainText('Hello from the stub.');
  await expect(pane.getByTestId('queued')).toHaveCount(0);

  // Retry sends the stopped request again.
  await slow.getByRole('button', { name: 'Retry' }).click();
  await expect(replies(page).last()).toHaveAttribute('data-status', 'complete');
  await expect(replies(page).last()).toContainText('Thinking about this slowly');

  // A provider error shows on the reply; Retry gets through.
  const tried = await replies(page).count();
  await send(page, '[fail] Try this');
  const failed = replies(page).nth(tried);
  await expect(failed).toHaveAttribute('data-status', 'error');
  await expect(failed.getByRole('alert')).toContainText('Model provider returned HTTP 400');
  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(replies(page).last()).toHaveAttribute('data-status', 'complete');
  await expect(replies(page).last()).toContainText('Select a layer first.');

  // "Ask Claude" from elsewhere in the shell (Comment or ask) lands in the pane as a message.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('greenfield:ask-claude', {
        detail: { prompt: '[say] From a comment', scope: null },
      }),
    ),
  );
  await expect(
    pane.getByTestId('agent-message').filter({ hasText: '[say] From a comment' }),
  ).toBeVisible();
  await expect(replies(page).last()).toContainText('Hello from the stub.');

  problems.splice(0, problems.length, ...problems.filter((p) => !NOISE.test(p)));
});

test('job cards: start, progress, reload, open the result, cancel', async ({
  as,
  run,
  problems,
}, testInfo) => {
  await connectModel(await as('admin'), run.org.slug);
  const page = await as('editor');
  const { projectId, editor } = await openProject(page, run.org.slug, 'Agent jobs');
  await addCard(editor);
  const { db, close } = createDb(process.env.DATABASE_URL!);
  try {
    // A real start: this deployment has no headless editor, so the job fails and says why.
    await send(page, '[job] Show me 3 alternatives');
    const offer = replies(page).last();
    await expect(offer).toContainText('Three alternatives take a while');
    await offer.getByRole('button', { name: 'Start the job' }).click();
    const failed = offer.getByTestId('job-card');
    await expect(failed).toHaveAttribute('data-status', 'failed', { timeout: 30_000 });
    await expect(failed.getByRole('alert')).toContainText('figcraft-cli');
    await expect(failed.getByRole('heading')).toHaveText('3 alternatives');

    /** A running job on the newest offer, with a token to play its sandbox. */
    const fakeJob = async () => {
      await send(page, '[job] More alternatives');
      await expect(
        replies(page).last().getByRole('button', { name: 'Start the job' }),
      ).toBeVisible();
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      const [message] = await db
        .select({ id: agentMessages.id, conversationId: agentMessages.conversationId })
        .from(agentMessages)
        .innerJoin(agentConversations, eq(agentConversations.id, agentMessages.conversationId))
        .where(
          and(
            eq(agentConversations.projectId, projectId),
            eq(agentMessages.role, 'assistant'),
            isNull(agentMessages.jobId),
          ),
        )
        .orderBy(desc(agentMessages.seq))
        .limit(1);
      const now = new Date();
      const [job] = await db
        .insert(jobs)
        .values({
          workspaceId: project!.workspaceId,
          projectId,
          conversationId: message!.conversationId,
          kind: 'alternatives',
          input: { prompt: 'Three pricing layouts', frameId: '1', count: 3 },
          status: 'running',
          sandboxId: 'sbx_e2e_fake',
          attempts: 1,
          lastEventSeq: 2,
          createdBy: run.users.editor.id,
          startedAt: now,
          heartbeatAt: now,
        })
        .returning();
      await db.insert(jobEvents).values([
        { jobId: job!.id, seq: 1, type: 'status', data: { status: 'queued' } },
        { jobId: job!.id, seq: 2, type: 'status', data: { status: 'running' } },
      ]);
      await db
        .update(agentMessages)
        .set({ jobId: job!.id })
        .where(eq(agentMessages.id, message!.id));
      const token = `cjt_${randomBytes(32).toString('base64url')}`;
      await db.insert(jobTokens).values({
        jobId: job!.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(now.getTime() + 600_000),
      });
      const call = (method: string, url: string, body: Buffer | object) =>
        page.request.fetch(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json',
          },
          data: body,
        });
      return { id: job!.id, call };
    };

    // The sandbox's side of a job: progress, the saved file, the result.
    const job = await fakeJob();
    await page.reload();
    const card = replies(page).last().getByTestId('job-card');
    await expect(card).toHaveAttribute('data-status', 'running');
    const report = (type: string, data: object) =>
      job.call('POST', `/api/jobs/${job.id}/report`, { type, data });
    expect((await report('progress', { phase: 'editing', batches: 2 })).ok()).toBe(true);
    await expect(card.getByTestId('job-status')).toContainText('Designing · 2 edits so far');
    // Close the tab and come back: the card picks the job up where it is.
    await page.reload();
    await expect(card.getByTestId('job-status')).toContainText('Designing · 2 edits so far');

    const file = fs.readFileSync(path.join(WEB_DIR, 'test/fixtures/voirdire-library.figcraft'));
    const saved = await job.call('PUT', `/api/jobs/${job.id}/file`, file);
    expect(saved.ok()).toBe(true);
    const { versionId } = (await saved.json()) as { versionId: string };
    const frames = [
      'Pricing A · Cards in a row',
      'Pricing B · Comparison table',
      'Pricing C · One featured',
    ];
    expect(
      (
        await report('result', {
          summary: 'Three directions, side by side.',
          frames: frames.map((name, i) => ({ id: i + 10, name })),
          versionId,
        })
      ).ok(),
    ).toBe(true);
    await expect(card).toHaveAttribute('data-status', 'succeeded');
    await expect(card.getByTestId('job-status')).toHaveText(/^Done · \d+s$/);
    await expect(card.getByRole('list', { name: 'Frames' }).getByRole('listitem')).toHaveText(
      frames,
    );
    await page.screenshot({
      path: `${testInfo.project.outputDir}/agent-job-${testInfo.project.name}.png`,
    });

    // The result opens in the editor as a second document, and closes again.
    const docs = async () =>
      (await editor.execute('doc.list', {})) as { name: string; active: boolean }[];
    await card.getByRole('button', { name: 'Open result' }).click();
    await expect.poll(async () => (await docs()).length).toBe(2);
    expect((await docs()).find((d) => d.active)?.name).toMatch(/^3 alternatives · review/);
    await card.getByRole('button', { name: 'Back to the design' }).click();
    await expect.poll(async () => (await docs()).length).toBe(1);

    // Cancel stops a running job.
    const doomed = await fakeJob();
    await page.reload();
    const running = replies(page).last().getByTestId('job-card');
    await expect(running).toHaveAttribute('data-status', 'running');
    await running.getByRole('button', { name: 'Cancel' }).click();
    await expect(running).toHaveAttribute('data-status', 'cancelled');
    const [row] = await db.select().from(jobs).where(eq(jobs.id, doomed.id));
    expect(row!.status).toBe('cancelled');
  } finally {
    await close();
  }

  problems.splice(0, problems.length, ...problems.filter((p) => !NOISE.test(p)));
});
