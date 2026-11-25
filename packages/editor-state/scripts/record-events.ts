/**
 * Record the real editor's events for the reducer tests:
 *
 *   node apps/web/scripts/fetch-editor.mjs                   # the pinned editor, once
 *   pnpm --filter @greenfield/editor-state record [--port 3402]
 *   pnpm exec prettier --write packages/editor-state/test/fixtures
 *
 * Drives the pinned editor (the bridge's static host, Chromium) through a script of edits, each
 * by the input a person would use where there is one (clicks, keys) and by command otherwise.
 * Writes `test/fixtures/session.json`: per step, the `figcraft:event`s it caused and the truth
 * after it (a full `document.inspect`, the selected layers' `node.get`, tool and zoom), so a test
 * can replay the events and compare the store with the editor. Re-record after a pin bump.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import type { Editor, EditorEvent } from '@greenfield/bridge';
import { startHostServer } from '@greenfield/bridge/playwright/server';

declare global {
  interface Window {
    __greenfieldBridge?: { editor: Editor };
  }
}

const i = process.argv.indexOf('--port');
const port = i >= 0 ? Number(process.argv[i + 1]) : 3402;
const out = new URL('../test/fixtures/session.json', import.meta.url);

const server = await startHostServer({ port });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let events: EditorEvent[] = [];
await page.exposeFunction('__record', (e: EditorEvent) => events.push(e));
await page.addInitScript(() =>
  window.addEventListener('message', (m) => {
    const d = m.data as { type?: unknown; name?: unknown; data?: unknown } | null;
    if (d?.type === 'figcraft:event')
      (window as unknown as { __record(e: unknown): void }).__record({
        name: d.name,
        data: d.data,
      });
  }),
);
await page.goto(`${server.url}/__bridge/host.html?webgl`);
await page.waitForFunction(() => window.__greenfieldBridge?.editor.isReady, null, {
  timeout: 60_000,
});

const call = (method: string, params: unknown = {}) =>
  page.evaluate(([m, p]) => window.__greenfieldBridge!.editor.request(m, p), [
    method,
    params,
  ] as const);
const exec = (command: string, params: unknown = {}) => call('engine.execute', { command, params });
const frameBox = async () => (await page.locator('#editor').boundingBox())!;

/** Everything the store should end up knowing. */
async function truth() {
  const doc = (await call('document.inspect', {
    depth: 64,
    fields: ['name', 'type', 'visible', 'locked'],
  })) as { selection: number[] };
  const nodes = [];
  for (const id of doc.selection) nodes.push(await call('node.get', { id, depth: 0 }));
  const ui = (await call('ui.inspect')) as { status: { tool: string }; canvasMode: boolean };
  const view = (await exec('view.get')) as Record<'zoom' | 'cx' | 'cy' | 'vw' | 'vh', number>;
  return {
    doc,
    nodes,
    tool: ui.status.tool,
    canvasMode: ui.canvasMode,
    view: { zoom: view.zoom, cx: view.cx, cy: view.cy, vw: view.vw, vh: view.vh },
  };
}

const steps: { step: string; events: EditorEvent[]; truth: unknown }[] = [];
async function step(name: string, act: () => Promise<unknown>) {
  events = [];
  await act();
  await page.waitForTimeout(400); // events post at most once a frame; let them all arrive
  steps.push({ step: name, events, truth: await truth() });
  console.log(`${name}: ${events.map((e) => e.name).join(', ') || '(no events)'}`);
}

await step('file.new', () => exec('file.new', { name: 'Recorded' }));
await step('canvas mode on', () => exec('view.canvasMode', { on: true }));
await step('create a frame', () =>
  exec('node.create', { type: 'frame', name: 'Card', x: 0, y: 0, width: 400, height: 300 }),
);
await step('add children in one undo step', () =>
  exec('command.batch', {
    label: 'Fill card',
    commands: [
      { command: 'node.create', params: { type: 'text', parent: 2, text: 'Title', x: 20, y: 20 } },
      {
        command: 'node.create',
        params: {
          type: 'rectangle',
          parent: 2,
          name: 'Button',
          x: 20,
          y: 200,
          width: 120,
          height: 40,
        },
      },
    ],
  }),
);
await step('zoom to fit', () => exec('view.zoomFit'));
await step('select on the canvas', async () => {
  const b = await frameBox();
  await page.mouse.click(b.x + 8, b.y + 8); // empty canvas: clears the selection
  // The button's page point to the frame's pixels: the canvas rect, centred on (cx, cy).
  const node = (await call('node.get', { id: 4, fields: ['absoluteBounds'] })) as {
    absoluteBounds: { x: number; y: number };
  };
  const ui = (await call('ui.inspect')) as { canvas: { rect: [number, number, number, number] } };
  const view = (await exec('view.get')) as { zoom: number; cx: number; cy: number };
  const [rx, ry, rw, rh] = ui.canvas.rect;
  const toScreen = (px: number, py: number) => ({
    x: b.x + rx + rw / 2 + (px - view.cx) * view.zoom,
    y: b.y + ry + rh / 2 + (py - view.cy) * view.zoom,
  });
  const pt = toScreen(node.absoluteBounds.x + 10, node.absoluteBounds.y + 10);
  await page.mouse.click(pt.x, pt.y);
});
await step('rename', () => exec('node.set', { ids: [4], name: 'Primary button' }));
await step('move by key', async () => {
  await page.locator('#editor').contentFrame().locator('canvas').first().focus();
  await page.keyboard.press('ArrowRight');
});
await step('hide and lock', () => exec('node.set', { ids: [3], visible: false, locked: true }));
await step('duplicate', () => exec('edit.duplicate', { ids: [4] }));
await step('bring to front', () => exec('arrange.front', { ids: [3] }));
await step('group', () => exec('object.group', { ids: [3, 4] }));
await step('delete', () => exec('edit.delete', { ids: [4] }));
await step('undo', () => exec('edit.undo'));
await step('redo', () => exec('edit.redo'));
await step('tool by key', async () => {
  await page.locator('#editor').contentFrame().locator('canvas').first().focus();
  await page.keyboard.press('r');
});
await step('agent presence', async () => {
  await exec('agent.presence', { name: 'Claude', active: true });
  await call('engine.execute', {
    command: 'node.set',
    params: { ids: [2], name: 'Card (Claude)' },
    agent: 'Claude',
  });
});
await step('agent presence released', () =>
  exec('agent.presence', { name: 'Claude', active: false }),
);
await step('right-click', async () => {
  const b = await frameBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
});
await step('add a page and switch to it', () => exec('page.add', { name: 'Second' }));
await step('back to the first page', () => exec('page.select', { id: 1 }));
await step('canvas mode off', () => exec('view.canvasMode', { on: false }));
await step('open another file', () => exec('file.new', { name: 'Other' }));

const ready = await page.evaluate(() => window.__greenfieldBridge!.editor.ready());
writeFileSync(out, `${JSON.stringify({ editor: ready, steps }, null, 1)}\n`);
console.log(`wrote ${out.pathname} (${steps.length} steps)`);
await browser.close();
await server.close();
