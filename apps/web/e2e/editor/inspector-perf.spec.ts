/**
 * Story 5.8 perf box, on the project page with the real editor. Off unless PERF=1:
 *
 *   PERF=1 pnpm --filter @greenfield/web e2e:editor --project=chromium inspector-perf
 *
 * One clock (the host page's `performance.now()`; the editor frame's times are moved onto it
 * through `timeOrigin`), as ADR 0005 measured:
 *
 * - **Canvas click to inspector painted**: a real click on the canvas until the Design tab shows
 *   the layer's name, at the next animation frame after React committed it. "Added over the
 *   canvas" is that paint minus the end of the first editor frame after the click (the editor's
 *   `requestAnimationFrame` is wrapped to log frame ends).
 * - **Scrub to canvas repaint**: each pointer move over the Width label until the editor's
 *   `document.changed` carrying that width arrives (the editor posts it as the frame that drew it
 *   ends). Moves whose preview was replaced before it ran never draw and are not counted.
 */
import { openEditor, type RemoteEditor } from '@greenfield/bridge/playwright';
import type { Page } from '@playwright/test';
import { createProject, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

test.skip(!process.env.PERF, 'perf run only: PERF=1');
test.setTimeout(10 * 60_000);

const TRIALS = 20;

declare global {
  interface Window {
    __perf?: {
      log: { kind: string; t: number; [k: string]: unknown }[];
      frames: { start: number; end: number }[];
    };
  }
}

async function layerPoint(page: Page, editor: RemoteEditor, id: number) {
  const node = (await editor.getNode(id, { fields: ['absoluteBounds'] })) as unknown as {
    absoluteBounds: { x: number; y: number; width: number; height: number };
  };
  const ui = (await editor.request('ui.inspect')) as {
    canvas: { rect: [number, number, number, number] };
  };
  const view = (await editor.execute('view.get', {})) as { zoom: number; cx: number; cy: number };
  const frame = (await page.getByTitle('Design canvas').boundingBox())!;
  const [rx, ry, rw, rh] = ui.canvas.rect;
  const b = node.absoluteBounds;
  return {
    x: frame.x + rx + rw / 2 + (b.x + b.width / 2 - view.cx) * view.zoom,
    y: frame.y + ry + rh / 2 + (b.y + b.height / 2 - view.cy) * view.zoom,
  };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! * 10) / 10;
};
const stats = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95) });

/** Log clicks, editor frames, editor events and the Design tab's name on the host's clock. */
function instrument(page: Page) {
  return page.evaluate(() => {
    const perf = {
      log: [] as { kind: string; t: number; [k: string]: unknown }[],
      frames: [] as { start: number; end: number }[],
    };
    window.__perf = perf;
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Design canvas"]')!;
    const inner = iframe.contentWindow as Window & typeof globalThis;
    const shift = inner.performance.timeOrigin - performance.timeOrigin;
    const raf = inner.requestAnimationFrame.bind(inner);
    inner.requestAnimationFrame = (cb) =>
      raf((ts) => {
        const start = inner.performance.now() + shift;
        cb(ts);
        perf.frames.push({ start, end: inner.performance.now() + shift });
      });
    inner.addEventListener(
      'pointerdown',
      () => perf.log.push({ kind: 'click', t: inner.performance.now() + shift }),
      true,
    );
    window.addEventListener('message', (e) => {
      const d = e.data as { type?: string; name?: string; data?: { nodes?: { width?: number }[] } };
      if (d?.type !== 'figcraft:event') return;
      const width = d.data?.nodes?.find((n) => typeof n.width === 'number')?.width;
      perf.log.push({ kind: d.name!, t: performance.now(), width });
    });
    const name = document.querySelector('[data-testid=design-tab-name]')!;
    new MutationObserver(() => {
      const text = name.textContent;
      requestAnimationFrame(() => perf.log.push({ kind: 'painted', t: performance.now(), text }));
    }).observe(name, { childList: true, characterData: true, subtree: true });
    const handle = document.querySelector('[data-testid=design-width-scrub]')!;
    handle.addEventListener('pointermove', (e) =>
      perf.log.push({ kind: 'move', t: performance.now(), x: (e as PointerEvent).clientX }),
    );
  });
}

const NOISE = /clerk\.accounts\.dev.*access control checks/;

test('inspector latency: canvas click to inspector, scrub to canvas', async ({
  as,
  run,
  problems,
}, testInfo) => {
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Inspector perf'));
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');
  const made = (await editor.batch(
    [
      {
        command: 'node.create',
        params: { type: 'rectangle', name: 'Alpha', x: 0, y: 0, width: 160, height: 120 },
      },
      {
        command: 'node.create',
        params: { type: 'rectangle', name: 'Beta', x: 240, y: 0, width: 160, height: 120 },
      },
    ],
    { label: 'perf: layers' },
  )) as { id: number }[];
  await editor.execute('view.zoomFit', {});
  const points = [
    await layerPoint(page, editor, made[0]!.id),
    await layerPoint(page, editor, made[1]!.id),
  ];
  const names = ['Alpha', 'Beta'];
  await page.mouse.click(points[1]!.x, points[1]!.y);
  await expect(page.getByTestId('design-tab-name')).toHaveText('Beta');
  await instrument(page);

  // Canvas click to inspector.
  const click: number[] = [];
  const added: number[] = [];
  const eventToPaint: number[] = [];
  for (let i = 0; i < TRIALS; i++) {
    const k = i % 2;
    await page.evaluate(() => {
      window.__perf!.log.length = 0;
      window.__perf!.frames.length = 0;
    });
    await page.mouse.click(points[k]!.x, points[k]!.y);
    await expect(page.getByTestId('design-tab-name')).toHaveText(names[k]!);
    await page.waitForTimeout(150);
    const { log, frames } = await page.evaluate(() => window.__perf!);
    const down = log.find((e) => e.kind === 'click')!;
    const painted = log.find((e) => e.kind === 'painted' && e.text === names[k])!;
    const event = log.find((e) => e.kind === 'selection.changed' && e.t >= down.t)!;
    const frameEnd = frames.find((f) => f.start >= down.t)?.end;
    click.push(painted.t - down.t);
    eventToPaint.push(painted.t - event.t);
    if (frameEnd !== undefined) added.push(painted.t - frameEnd);
  }

  // Scrub to canvas repaint: 60 moves of 2 px over Width, as one gesture.
  await page.mouse.click(points[0]!.x, points[0]!.y);
  await expect(page.getByTestId('design-tab-name')).toHaveText('Alpha');
  await page.evaluate(() => (window.__perf!.log.length = 0));
  const box = (await page.getByTestId('design-width-scrub').boundingBox())!;
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(x0 + i * 2, y0);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const { log } = await page.evaluate(() => window.__perf!);
  const moves = log.filter((e) => e.kind === 'move' && (e.x as number) > x0);
  const changes = log.filter((e) => e.kind === 'document.changed' && typeof e.width === 'number');
  const scrub: number[] = [];
  for (const m of moves) {
    const width = 160 + Math.round((m.x as number) - x0);
    // Within a pixel: engines round the pointer's fractional position differently.
    const drawn = changes.find((c) => c.t >= m.t && Math.abs((c.width as number) - width) <= 1);
    if (drawn) scrub.push(drawn.t - m.t);
  }
  expect(await editor.getNode(made[0]!.id, { fields: ['width'] })).toMatchObject({ width: 280 });

  const result = {
    browser: testInfo.project.name,
    clickToInspector: stats(click),
    addedOverCanvas: stats(added),
    eventToPaint: stats(eventToPaint),
    scrubToCanvas: { ...stats(scrub), moves: moves.length },
  };
  console.log(JSON.stringify(result));
  // Known WebKit noise from outside the inspector (as in canvas-mode.spec.ts): Clerk's FAPI
  // retries fail CORS now and then.
  problems.splice(0, problems.length, ...problems.filter((p) => !NOISE.test(p)));
  await testInfo.attach('inspector-perf.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});
