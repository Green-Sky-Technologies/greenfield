/**
 * Components, variables and styles in the Design tab (Story 5.9) and the pickers and export
 * panel (Story 5.11), on the project page in canvas mode with the real editor:
 *
 * - 5.9: apply and detach a fill style; bind and unbind a variable; a frame's variable mode
 *   changes what its layers show; an instance's boolean, text and variant properties. Each
 *   change is one undo step.
 * - 5.11: the canvas's `ui.request colorPicker` opens our colour picker on the layer's fill: a
 *   drag is one undo step, Esc mid-drag puts the colour back, a variable binds, a style applies,
 *   Detach goes back to a plain colour. The font picker searches and picks. The export panel adds
 *   settings and downloads the files the editor renders.
 */
import fs from 'node:fs';
import path from 'node:path';
import { platformFromUserAgent } from '@greenfield/bridge';
import { openEditor, type RemoteEditor } from '@greenfield/bridge/playwright';
import type { Locator, Page } from '@playwright/test';
import { editPanelChord } from '../../src/features/shell/keys';
import { createProject, pageFetch, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

const LIBRARY = path.join(import.meta.dirname, '../../test/fixtures/voirdire-library.figcraft');

interface Fields {
  fills?: { color: string }[];
  styles?: Record<string, string | null>;
  boundVariables?: Record<string, string>;
  componentProperties?: Record<string, unknown>;
  exports?: { format: string }[];
}

const get = async (editor: RemoteEditor, id: number) =>
  (await editor.execute('node.get', { id })) as Fields;
const undoDepth = async (editor: RemoteEditor) =>
  (await editor.inspect({ depth: 0, fields: [] })).history.undoDepth;
const id = (r: unknown) => (r as { id: number }).id;

/** A change made from the panel: `act` runs, then exactly one undo step more than before. */
async function oneStep(editor: RemoteEditor, act: () => Promise<unknown>) {
  const before = await undoDepth(editor);
  await act();
  await expect.poll(() => undoDepth(editor)).toBe(before! + 1);
}

async function select(page: Page, editor: RemoteEditor, ids: number[], name: string) {
  await editor.execute('select.set', { ids });
  await expect(page.getByTestId('design-tab-name')).toHaveText(name);
}

/** The canvas asking for its colour picker on a layer's first fill (Story 2.11's event). */
const askForColourPicker = (page: Page, layer: number) =>
  page.evaluate((layer) => {
    window.__greenfieldStore!.dispatch({
      type: 'ui.request',
      kind: 'colorPicker',
      screen: { x: 600, y: 160 },
      data: { target: 'paint', slot: 'fill', index: 0, ids: [layer] },
    });
  }, layer);

async function drag(page: Page, area: Locator, from: [number, number], to: [number, number]) {
  const box = (await area.boundingBox())!;
  const at = ([fx, fy]: [number, number]) => [box.x + box.width * fx, box.y + box.height * fy];
  const [x0, y0] = at(from) as [number, number];
  const [x1, y1] = at(to) as [number, number];
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
}

test('5.9 and 5.11: styles, variables, instances, pickers and export', async ({
  as,
  run,
  problems,
}, testInfo) => {
  // Known noise from outside this lane, ignored whenever it arrives (it can land after the last
  // step): Clerk's FAPI retries fail CORS in Playwright WebKit now and then, and in WebKit the
  // editor's keyboard input trips its own style-src CSP (on main as well; the fork's to fix).
  const noise =
    /clerk\.accounts\.dev.*access control checks|\[editor\] CSP: Refused to apply a stylesheet/;
  const push = problems.push.bind(problems);
  // Not enumerable, so the fixture's `toEqual([])` still compares a plain list.
  Object.defineProperty(problems, 'push', {
    value: (...items: string[]) => push(...items.filter((p) => !noise.test(p))),
  });
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Styles'));
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');

  // A file with a colour collection in two modes, a radius variable, a paint style, and a card
  // frame holding a swatch and a label, made into a component with properties and a variant.
  await editor.execute('variable.createCollection', { name: 'Brand', modes: ['Light', 'Dark'] });
  const ink = id(
    await editor.execute('variable.create', {
      collection: 'Brand',
      name: 'ink/900',
      type: 'color',
      values: { Light: '#16170f', Dark: '#f6f3ec' },
    }),
  );
  const radius = id(
    await editor.execute('variable.create', {
      collection: 'Brand',
      name: 'radius/md',
      type: 'number',
      value: 8,
    }),
  );
  const frame = id(
    await editor.execute('node.create', { type: 'frame', name: 'Card', width: 320, height: 200 }),
  );
  const swatch = id(
    await editor.execute('node.create', {
      type: 'rectangle',
      name: 'Swatch',
      parent: frame,
      x: 20,
      y: 20,
      width: 120,
      height: 120,
      props: { fill: '#3fd67f' },
    }),
  );
  const field = id(
    await editor.execute('style.create', { type: 'paint', name: 'Brand/Field', from: swatch }),
  );
  // Creating a style from a layer applies it there; a fill of its own takes it off again.
  await editor.execute('node.set', { ids: [swatch], fill: '#e0452f' });
  await editor.execute('view.zoomFit', {});

  const right = page.getByRole('complementary', { name: 'Edit panel' });
  const styles = right.getByRole('region', { name: 'Styles' });
  const variables = right.getByRole('region', { name: 'Variables' });

  // 5.9: apply a fill style, then detach it.
  await select(page, editor, [swatch], 'Swatch');
  await oneStep(editor, () =>
    styles.getByLabel('Fill style', { exact: true }).selectOption({ label: 'Brand / Field' }),
  );
  expect((await get(editor, swatch)).styles?.fill).toBe(String(field));
  await oneStep(editor, () => styles.getByRole('button', { name: 'Detach fill style' }).click());
  expect((await get(editor, swatch)).styles?.fill ?? null).toBeNull();
  await expect(styles.getByLabel('Fill style', { exact: true })).toHaveValue('');

  // 5.9: bind a variable to a field, then unbind it.
  await variables.getByLabel('Field to bind').selectOption({ label: 'Radius' });
  await oneStep(editor, () =>
    variables.getByLabel('Variable').selectOption({ label: 'radius / md' }),
  );
  expect((await get(editor, swatch)).boundVariables?.cornerRadius).toBe(String(radius));
  await expect(variables.getByTestId('bound-variable')).toHaveText('radius / md');
  await oneStep(editor, () => variables.getByRole('button', { name: 'Unbind radius' }).click());
  await expect(variables.getByTestId('bound-variable')).toHaveCount(0);

  // 5.11: the canvas asks for the colour picker on the swatch's fill.
  const picker = page.getByRole('dialog', { name: 'Colour' });
  await askForColourPicker(page, swatch);
  await expect(picker).toBeVisible();
  await expect(picker.getByLabel('Hex')).toHaveValue('#3fd67f'); // detaching kept the style's colour
  const area = picker.getByTestId('colour-area');
  await oneStep(editor, async () => {
    await drag(page, area, [0.9, 0.1], [0.3, 0.6]);
    await page.mouse.up();
  });
  const dragged = (await get(editor, swatch)).fills![0]!.color;
  expect(dragged).not.toBe('#3FD67F');
  await expect(picker.getByLabel('Hex')).toHaveValue(dragged.toLowerCase());
  // Esc mid-drag: the canvas showed the drag, then goes back; no undo step.
  const depth = await undoDepth(editor);
  await drag(page, area, [0.3, 0.6], [0.95, 0.05]);
  await expect.poll(async () => (await get(editor, swatch)).fills![0]!.color).not.toBe(dragged);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(picker).toBeHidden();
  await expect.poll(async () => (await get(editor, swatch)).fills![0]!.color).toBe(dragged);
  expect(await undoDepth(editor)).toBe(depth);

  // A variable binds; a style applies; Detach goes back to a plain colour.
  await askForColourPicker(page, swatch);
  await picker.getByRole('tab', { name: 'Variables' }).click();
  await expect(picker.getByRole('region', { name: 'Brand' })).toBeVisible();
  await oneStep(editor, () => picker.getByRole('button', { name: /ink \/ 900/ }).click());
  expect((await get(editor, swatch)).boundVariables).toEqual({ 'fills/0/color': ink });
  await expect(picker.getByTestId('colour-bound')).toHaveText('Bound to ink / 900');
  await page.screenshot({
    path: testInfo.outputPath(`colour-picker-${testInfo.project.name}.png`),
  });
  await picker.getByRole('tab', { name: 'Styles' }).click();
  await oneStep(editor, () => picker.getByRole('button', { name: /Brand \/ Field/ }).click());
  expect((await get(editor, swatch)).styles?.fill).toBe(String(field));
  await oneStep(editor, () => picker.getByRole('button', { name: 'Detach' }).click());
  const plain = await get(editor, swatch);
  expect(plain.styles?.fill ?? null).toBeNull();
  expect(plain.fills![0]!.color).toBe('#3FD67F');
  await picker.getByRole('tab', { name: 'Variables' }).click();
  await oneStep(editor, () => picker.getByRole('button', { name: /ink \/ 900/ }).click());
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  expect(await page.evaluate(() => window.__greenfieldStore!.getState().request)).toBeNull();

  // 5.9: a frame's variable mode changes what its layers show.
  await select(page, editor, [frame], 'Card');
  const modes = right.getByRole('region', { name: 'Variable modes' });
  await oneStep(editor, () => modes.getByLabel('Brand mode').selectOption({ label: 'Dark' }));
  expect((await get(editor, swatch)).fills![0]!.color).toBe('#F6F3EC');
  await oneStep(editor, () =>
    modes.getByLabel('Brand mode').selectOption({ label: 'Auto (inherit)' }),
  );
  expect((await get(editor, swatch)).fills![0]!.color).toBe('#16170F');

  // 5.11: the export panel on the frame: SVG, then PNG at 2x, rendered by the editor.
  const exportPanel = right.getByRole('region', { name: 'Export' });
  await oneStep(editor, () =>
    exportPanel.getByRole('button', { name: 'Add export setting' }).click(),
  );
  await expect(exportPanel.getByTestId('export-setting')).toHaveCount(1);
  await oneStep(editor, () => exportPanel.getByLabel('Format 1').selectOption('svg'));
  let download = page.waitForEvent('download');
  await exportPanel.getByRole('button', { name: 'Export Card' }).click();
  let file = await download;
  expect(file.suggestedFilename()).toBe('Card.svg');
  expect(fs.readFileSync((await file.path())!, 'utf8')).toMatch(/^(<\?xml[^>]*>\s*)?<svg[\s>]/);
  await exportPanel.getByLabel('Format 1').selectOption('png');
  await expect.poll(async () => (await get(editor, frame)).exports?.[0]?.format).toBe('png');
  await exportPanel.getByLabel('Size 1').selectOption('2x');
  download = page.waitForEvent('download');
  await exportPanel.getByRole('button', { name: 'Export Card' }).click();
  file = await download;
  expect(file.suggestedFilename()).toBe('Card@2x.png');
  expect(
    fs
      .readFileSync((await file.path())!)
      .subarray(1, 4)
      .toString(),
  ).toBe('PNG');

  // 5.9: an instance's properties: a boolean, a text and a variant.
  const label = id(
    await editor.execute('node.create', {
      type: 'text',
      name: 'Label',
      characters: 'Hi',
      parent: frame,
      x: 160,
      y: 20,
    }),
  );
  await editor.execute('component.create', { ids: [frame] });
  await editor.execute('component.addProperty', {
    id: frame,
    name: 'Show',
    type: 'boolean',
    default: true,
  });
  await editor.execute('component.addProperty', {
    id: frame,
    name: 'Text',
    type: 'text',
    default: 'Hi',
    layer: label,
  });
  await editor.execute('component.addVariant', { id: frame });
  const instance = id(await editor.execute('instance.create', { component: frame, x: 600, y: 0 }));
  await select(page, editor, [instance], 'Card');
  const section = right.getByRole('region', { name: 'Instance' });
  await expect(section.getByTestId('instance-main')).toContainText('Default');
  await oneStep(editor, () => section.getByLabel('Show').uncheck());
  await oneStep(editor, async () => {
    await section.getByLabel('Text').fill('Yo');
    await section.getByLabel('Text').press('Enter');
  });
  await oneStep(editor, () => section.getByLabel('Property 1').selectOption('Variant2'));
  // A variant is the main component the instance shows; the other properties are its own.
  await expect(section.getByTestId('instance-main')).toContainText('Variant2');
  const switched = (await get(editor, instance)) as Fields & { mainComponentName?: string };
  expect(switched.mainComponentName).toBe('Property 1=Variant2');
  expect(switched.componentProperties).toMatchObject({ Show: false, Text: 'Yo' });
  await page.screenshot({ path: testInfo.outputPath(`instance-${testInfo.project.name}.png`) });

  // 5.11: the font picker, opened as the Design tab's family field opens it.
  await page.evaluate(() => {
    window.__greenfieldPickers!.openFontPicker(
      { x: 1100, y: 300 },
      {
        family: 'Inter',
        onCommit: (f) => ((window as { picked?: string }).picked = f),
        onCancel: () => ((window as { picked?: string }).picked = '(cancelled)'),
      },
    );
  });
  const fonts = page.getByRole('dialog', { name: 'Font' });
  await expect(fonts.getByRole('option', { name: /Inter/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await fonts.getByLabel('Search fonts').fill('noto');
  await expect(fonts.getByRole('option').first()).toContainText('Noto');
  const first = (await fonts.getByRole('option').first().locator('span').first().textContent())!;
  await page.keyboard.press('Enter');
  await expect(fonts).toBeHidden();
  expect(await page.evaluate(() => (window as { picked?: string }).picked)).toBe(first);
});

test('5.8 and 5.10 open the real colour picker: a drag is one undo step, Esc reverts', async ({
  as,
  run,
  problems,
}) => {
  const noise =
    /clerk\.accounts\.dev.*access control checks|\[editor\] CSP: Refused to apply a stylesheet/;
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Pickers'));
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');
  const swatch = id(
    await editor.execute('node.create', {
      type: 'rectangle',
      name: 'Swatch',
      width: 160,
      height: 120,
      props: { fill: '#3fd67f' },
    }),
  );
  await editor.execute('view.zoomFit', {});
  await select(page, editor, [swatch], 'Swatch');
  const picker = page.getByRole('dialog', { name: 'Colour' });
  const fill = async () => (await get(editor, swatch)).fills![0]!.color;

  /** Open the picker with `open`, drag to `to` (one step), then Esc mid-drag (reverted, no step). */
  async function dragThenCancel(open: () => Promise<void>, to: [number, number]) {
    await open();
    await expect(picker).toBeVisible();
    const area = picker.getByTestId('colour-area');
    const start = await fill();
    await oneStep(editor, async () => {
      await drag(page, area, [0.9, 0.1], to);
      await page.mouse.up();
    });
    const dragged = await fill();
    expect(dragged).not.toBe(start);
    const depth = await undoDepth(editor);
    await drag(page, area, to, [0.95, 0.05]);
    await expect.poll(fill).not.toBe(dragged);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(picker).toBeHidden();
    await expect.poll(fill).toBe(dragged);
    expect(await undoDepth(editor)).toBe(depth);
  }

  // The inspector's fill swatch (W2-B).
  const right = page.getByRole('complementary', { name: 'Edit panel' });
  await dragThenCancel(
    () => right.getByRole('button', { name: 'Fill 1 colour' }).click(),
    [0.3, 0.6],
  );

  // The floating toolbar's fill (W2-D), with the edit panel hidden.

  await page.getByTitle('Design canvas').focus();
  const platform = platformFromUserAgent(await page.evaluate(() => navigator.userAgent));
  await page.keyboard.press(editPanelChord(platform));
  const toolbar = page.getByRole('toolbar', { name: 'Selection' });
  await expect(toolbar).toBeVisible();
  await dragThenCancel(() => toolbar.getByRole('button', { name: /^Fill #/ }).click(), [0.6, 0.3]);

  problems.splice(0, problems.length, ...problems.filter((p) => !noise.test(p)));
});

test("5.11: the font picker lists the file's design system first", async ({
  as,
  run,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Chromium only (design system setup)');
  const admin = await as('admin');
  await admin.goto(`/w/${run.org.slug}/settings/design-systems`);
  const created = await pageFetch(
    admin,
    `/api/design-systems?name=${encodeURIComponent(uniqueName('Fonts'))}`,
    { method: 'POST', bytes: [...fs.readFileSync(LIBRARY)] },
  );
  expect(created.status).toBe(201);
  const system = `/w/${run.org.slug}/settings/design-systems/${JSON.parse(created.body).id}`;
  await admin.goto(system);
  await admin.getByRole('button', { name: 'Publish' }).click();
  await expect(admin.getByRole('status')).toHaveText('Published.');
  await admin.goto(`/w/${run.org.slug}/settings/design-systems`);
  await admin.getByRole('button', { name: 'Make default' }).first().click();

  try {
    await createProject(admin, run.org.slug, uniqueName('Typeset'));
    await expect
      .poll(() => admin.evaluate(() => window.__greenfieldStore?.getState().pages.length ?? 0))
      .toBe(2); // the system's library page came with the file
    await admin.evaluate(() =>
      window.__greenfieldPickers!.openFontPicker(
        { x: 1100, y: 300 },
        { family: 'Inter', onCommit: () => {}, onCancel: () => {} },
      ),
    );
    const options = admin.getByRole('dialog', { name: 'Font' }).getByRole('option');
    await expect(options.first()).toContainText('Design system');
    const sources = await options.evaluateAll((os) => os.map((o) => o.lastChild?.textContent));
    const systemCount = sources.filter((s) => s === 'Design system').length;
    expect(systemCount).toBeGreaterThan(0);
    expect(sources.slice(0, systemCount).every((s) => s === 'Design system')).toBe(true);
    await admin.screenshot({ path: testInfo.outputPath('font-picker-design-system.png') });
  } finally {
    await admin.goto(system);
    await admin.getByRole('button', { name: 'Stop using as default' }).click();
    await expect(admin.getByRole('status')).toHaveText('New files start blank again.');
  }
});
