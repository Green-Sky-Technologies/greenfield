/**
 * Stories 10.2, 10.5 and 10.6 in the real app, with the real editor:
 * - 10.2: an admin builds a system from a typical Tailwind repository (uploaded:
 *   `test/fixtures/tailwind-repo`, a shadcn-style site), watches the build, and reviews colour,
 *   type and spacing variables and Button, Input, Card and Nav. In Chromium it also builds one
 *   from a real public repository (this one, a Tailwind v4 app).
 * - 10.5: a new file starts from the system; a layer drawn with a raw colour and an off-scale gap
 *   (what an agent might do) is flagged by the server's check with the nearest variables, and
 *   passes once bound to them. The check reads the layer as the editor returns it.
 * - 10.6: a new version (a changed primary colour) is uploaded, its changes reviewed and
 *   published, and the file updated; reopened, the file's variable and Button show the new colour.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Frame, Page } from '@playwright/test';
import { buildLibraryDocument } from '../../src/server/services/design-systems/build';
import { CHECK_FIELDS } from '../../src/server/services/design-systems/check';
import { writeLibraryFile } from '../../src/server/services/design-systems/library-file';
import { extractTokens, type SourceFile } from '../../src/server/services/design-systems/tokens';
import { createProject, openProject, pageFetch, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

const REPO = path.join(import.meta.dirname, '../../test/fixtures/tailwind-repo');
const repoPaths = (fs.readdirSync(REPO, { recursive: true }) as string[])
  .map((p) => path.join(REPO, p))
  .filter((p) => fs.statSync(p).isFile());

declare global {
  interface Window {
    figcraft: {
      execute(command: string, params?: unknown): Promise<unknown>;
      request(method: string, params?: unknown): Promise<unknown>;
      docInspect(params?: unknown): Promise<unknown>;
    };
  }
}

async function editorFrame(page: Page): Promise<Frame> {
  await expect
    .poll(() => page.frames().some((f) => f.url().includes('/editor/index.html')))
    .toBe(true);
  const frame = page.frames().find((f) => f.url().includes('/editor/index.html'))!;
  await frame.waitForFunction(() => typeof window.figcraft?.execute === 'function');
  return frame;
}

const run = (frame: Frame, command: string, params: unknown) =>
  frame.evaluate(([c, p]) => window.figcraft.execute(c as string, p), [command, params] as const);
const request = (frame: Frame, method: string, params: unknown) =>
  frame.evaluate(([m, p]) => window.figcraft.request(m as string, p), [method, params] as const);

interface VariableList {
  variables: { id: string; name: string; values: Record<string, { value: unknown }> }[];
  collections: { name: string }[];
}
const hexOf = (c: { r: number; g: number; b: number }) =>
  `#${[c.r, c.g, c.b]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** A second version of the fixture repo's system: the primary colour changed to green. */
async function versionTwo(file: string) {
  const files: SourceFile[] = repoPaths.map((p) => ({
    path: path.relative(REPO, p).split(path.sep).join('/'),
    text: fs.readFileSync(p, 'utf8').replace('--primary: 8 73% 53%;', '--primary: 150 60% 35%;'),
  }));
  const { doc } = buildLibraryDocument('v2', extractTokens(files));
  fs.writeFileSync(file, await writeLibraryFile({ doc, entries: [] }));
}

test('build a system from a Tailwind repo; Claude’s check holds files to it; updates reach files', async ({
  as,
  run: e2e,
  problems,
}, testInfo) => {
  // Known gap in the fork: in WebKit the editor's keyboard input trips its own style-src CSP.
  const noise = /\[\w+\] CSP: Refused to apply a stylesheet/;
  const push = problems.push.bind(problems);
  Object.defineProperty(problems, 'push', {
    value: (...items: string[]) => push(...items.filter((p) => !noise.test(p))),
  });
  const slug = e2e.org.slug;
  const base = `/w/${slug}/settings/design-systems`;
  const name = uniqueName('Voirdire');
  const admin = await as('admin');

  // ---- 10.2: build from the repository's files ----
  await admin.goto(`${base}/new`);
  const form = admin.getByRole('form', { name: 'Build from sources' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Uploads').setInputFiles(repoPaths);
  // Record each step as the panel shows it (the review opens by client-side navigation).
  await admin.evaluate(() => {
    const w = window as unknown as { __steps: string[] };
    w.__steps = [];
    new MutationObserver(() => {
      for (const li of document.querySelectorAll('[data-step][data-done="true"]')) {
        const line = `${li.getAttribute('data-step')}: ${li.lastElementChild?.textContent}`;
        if (!w.__steps.includes(line)) w.__steps.push(line);
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await form.getByRole('button', { name: 'Build design system' }).click();
  await expect(admin.getByRole('region', { name: 'Build progress' })).toBeVisible();
  await admin.screenshot({ path: testInfo.outputPath('10.2-build.png'), fullPage: true });
  await admin.waitForURL(new RegExp(`${base}/[0-9a-f-]{36}$`));
  const steps = await admin.evaluate(() => (window as unknown as { __steps: string[] }).__steps);
  expect(steps.map((l) => l.split(':')[0])).toEqual([
    'sources',
    'colours',
    'type',
    'scales',
    'components',
    'guide',
  ]);
  const lines = steps.map((l) => ({ text: l.slice(l.indexOf(': ') + 2) }));
  expect(lines[0]!.text).toMatch(/Tailwind config, CSS variables, 5 React components/);
  expect(lines[1]!.text).toMatch(/^Colours: 3 groups, \d+ values$/);
  expect(lines[4]!.text).toBe('Components: Button, Input, Card, Nav (5 in the code)');
  const systemUrl = new URL(admin.url()).pathname;
  await expect(admin.getByRole('heading', { name: `Review · ${name}` })).toBeVisible();
  const section = (title: string) =>
    admin.getByRole('region', { name: title }).getByTestId('review-item');
  await expect(section('Colours')).toHaveText([/^Theme/, /^Rubric/, /^Ink/]);
  await expect(section('Spacing and scales')).toHaveText([/^Spacing/, /^Radius/]);
  await expect(section('Type styles')).toHaveCount(9);
  await expect(section('Components')).toHaveText([/^Button/, /^Input/, /^Card/, /^Nav/]);
  await expect(admin.getByLabel('Guide for Claude')).toHaveValue(/Body: Inter Regular/);
  await admin.screenshot({ path: testInfo.outputPath('10.2-review.png'), fullPage: true });
  await admin.getByRole('button', { name: 'Publish' }).click();
  await expect(admin.getByText('Published.')).toBeVisible();
  await admin.getByRole('button', { name: 'Make default' }).click();
  await expect(admin.getByText('Now the default.')).toBeVisible();

  // ---- 10.5: a new file follows the system; the check flags raw values ----
  // The file is edited in its own tab.
  const work = await admin.context().newPage();
  const projectId = await createProject(work, slug, uniqueName('Pricing'));
  const ds = JSON.parse((await pageFetch(work, `/api/projects/${projectId}/design-system`)).body);
  expect(ds).toMatchObject({
    system: { name },
    version: 1,
    published: 1,
    counts: { type: 9, components: 4, spacing: 15 },
  });
  const frame = await editorFrame(work);
  // The Design tab names the system the file follows and what it has from it.
  const system = work.getByRole('region', { name: 'Design system' });
  await expect(system).toContainText(`${name} · v1`);
  await expect(system).toContainText(/Components\s*4/);
  await work.screenshot({ path: testInfo.outputPath('10.5-design-tab.png') });
  await expect
    .poll(() => run(frame, 'component.list', {}))
    .toEqual(
      expect.arrayContaining(
        ['Button', 'Input', 'Card', 'Nav'].map((n) => expect.objectContaining({ name: n })),
      ),
    );
  const vars = (await run(frame, 'variable.list', {})) as VariableList;
  expect(vars.collections.map((c) => c.name)).toEqual([
    'Theme',
    'Rubric',
    'Ink',
    'Spacing',
    'Radius',
  ]);
  const id = (vars: VariableList, n: string) => vars.variables.find((v) => v.name === n)!.id;

  // Drawn the way an agent might: a raw red and an 18 px gap.
  const { id: faq } = (await run(frame, 'node.create', {
    type: 'frame',
    name: 'FAQ',
    x: 0,
    y: 0,
    width: 400,
    height: 200,
    props: { layout: 'vertical', gap: 18, padding: 16, fill: '#E1472F' },
  })) as { id: number };
  const read = () => request(frame, 'node.get', { id: faq, depth: 8, fields: [...CHECK_FIELDS] });
  const check = async () =>
    JSON.parse(
      (
        await pageFetch(work, `/api/projects/${projectId}/design-system/check`, {
          method: 'POST',
          body: { layers: [await read()] },
        })
      ).body,
    ) as { system: string; violations: { value: unknown; suggestion: { name: string } }[] };
  const before = await check();
  expect(before.system).toBe(name);
  expect(before.violations.map((v) => [v.value, v.suggestion.name])).toEqual([
    ['#e1472f', 'primary'],
    [18, 'space/4'],
  ]);
  // Bound to the suggested variables, it passes.
  await run(frame, 'variable.bind', { ids: [faq], field: 'fill', variable: id(vars, 'primary') });
  await run(frame, 'variable.bind', { ids: [faq], field: 'gap', variable: id(vars, 'space/4') });
  expect((await check()).violations).toEqual([]);

  // ---- 10.6: a new version, reviewed, published, and the file updated ----
  // Leave the file (client-side, so the tab stays): its edit lock is released.
  await work.getByRole('link', { name: 'All projects' }).click();
  await expect
    .poll(
      async () => JSON.parse((await pageFetch(work, `/api/projects/${projectId}/lock`)).body).lock,
    )
    .toBeNull();
  await admin.goto(systemUrl);
  const v2 = testInfo.outputPath('voirdire-v2.figcraft');
  await versionTwo(v2);
  await admin.getByLabel('Upload a new version').setInputFiles(v2);
  await expect(admin.getByText('v2 against v1: 1 change')).toBeVisible();
  await expect(admin.getByTestId('library-change')).toHaveText([/Colour\s*primary.*→.*#248f59/]);
  await admin.screenshot({ path: testInfo.outputPath('10.6-review.png'), fullPage: true });
  await admin.getByRole('button', { name: 'Publish' }).click();
  await expect(admin.getByText('Published.')).toBeVisible();
  await expect(admin.getByText(/1 on an older version than v2/)).toBeVisible();
  await admin.getByRole('button', { name: 'Update 1 file' }).click();
  await expect(admin.getByRole('status', { name: 'Update status' })).toHaveText('Updated 1 file.');
  await expect(admin.getByText(/on an older version/)).toHaveCount(0);

  await openProject(admin, slug, projectId);
  await expect(admin.getByTestId('editor-status')).toHaveAttribute('data-status', 'opened');
  const updated = await editorFrame(admin);
  await expect
    .poll(async () => {
      const list = (await run(updated, 'variable.list', {})) as VariableList;
      const primary = list.variables.find((v) => v.name === 'primary')!;
      return hexOf(Object.values(primary.values)[0]!.value as { r: number; g: number; b: number });
    })
    .toBe('#248f59');
  const components = (await run(updated, 'component.list', {})) as { id: number; name: string }[];
  const button = (await request(updated, 'node.get', {
    id: components.find((c) => c.name === 'Button')!.id,
    fields: ['fills', 'boundVariables'],
  })) as { fills: { color: string }[] };
  expect(button.fills[0]!.color.toLowerCase()).toBe('#248f59');
  expect(
    JSON.parse((await pageFetch(admin, `/api/projects/${projectId}/design-system`)).body),
  ).toMatchObject({ version: 2, published: 2 });

  // Leave the run's workspace as it was: new files start blank again.
  await admin.goto(systemUrl);
  await admin.getByRole('button', { name: 'Stop using as default' }).click();
  await expect(admin.getByText('New files start blank again.')).toBeVisible();
});

test('build a system from a real public GitHub repository', async ({ as, run: e2e }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One real fetch from GitHub is enough');
  const admin = await as('admin');
  await admin.goto(`/w/${e2e.org.slug}/settings/design-systems/new`);
  const form = admin.getByRole('form', { name: 'Build from sources' });
  await form.getByLabel('Name').fill(uniqueName('Greenfield'));
  await form
    .getByLabel('GitHub repository')
    .fill('https://github.com/Green-Sky-Technologies/greenfield');
  await form.getByRole('button', { name: 'Build design system' }).click();
  await admin.waitForURL(/\/settings\/design-systems\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  const colours = admin.getByRole('region', { name: 'Colours' }).getByTestId('review-item');
  await expect(colours.first()).toContainText('Theme');
  await expect(
    admin.getByRole('region', { name: 'Components' }).getByTestId('review-item'),
  ).toHaveText([/^Button/, /^Input/, /^Card/, /^Nav/]);
  await expect(admin.getByLabel('Guide for Claude')).toHaveValue(/IBM Plex Sans/);
  await admin.screenshot({ path: testInfo.outputPath('10.2-github-review.png'), fullPage: true });
});
