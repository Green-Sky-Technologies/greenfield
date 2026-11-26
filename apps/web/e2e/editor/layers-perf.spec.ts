/**
 * Story 5.7 perf box: the Layers tab open on a 30,000-layer page (60 frames of 500), on the
 * project page with the real editor. Off unless PERF=1 (generating the file takes minutes):
 *
 *   PERF=1 pnpm --filter @greenfield/web e2e:editor --project=chromium layers-perf
 *
 * - Canvas edit: a `document.changed` shaped like the editor's, from `store.dispatch` until React
 *   has committed the list (a MessageChannel task queued after the dispatch runs once React's
 *   sync render is done), 200 runs per kind. Also one rename end to end: the bridge call until
 *   the row's text has changed in the DOM.
 * - Scrolling: one step per frame, 120 px (a wheel) and 2,000 px (every row new); the time from
 *   each scroll event until React has committed the new rows, and the frame intervals.
 *
 * One frame is 16.7 ms at 60 Hz. Results go to stdout and the test's attachments.
 */
import { openEditor } from '@greenfield/bridge/playwright';
import { ref, type BatchStep } from '@greenfield/bridge';
import { createProject, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

const LAYERS = 30_000;
const PER_FRAME = 500;

test.skip(!process.env.PERF, 'perf run only: PERF=1');
test.setTimeout(30 * 60_000);

test('Layers tab on a 30,000-layer page: per update and while scrolling', async ({
  as,
  run,
  problems,
}, testInfo) => {
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Layers perf'));
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');
  const left = page.getByRole('complementary', { name: 'Left panel' });
  await left.getByRole('tab', { name: 'Layers' }).click();

  for (let f = 0; f * PER_FRAME < LAYERS; f++) {
    const steps: BatchStep[] = [
      {
        command: 'node.create',
        as: 'f',
        params: { type: 'frame', name: `Frame ${f}`, x: f * 1100, y: 0, width: 1000, height: 1000 },
      },
    ];
    for (let i = 1; i < PER_FRAME; i++)
      steps.push({
        command: 'node.create',
        params: {
          type: 'rectangle',
          parent: ref('f'),
          name: `Card ${f}.${i}`,
          x: (i % 25) * 40,
          y: Math.floor(i / 25) * 40,
          width: 30,
          height: 30,
        },
      });
    await editor.batch(steps, { label: 'perf: fill', timeoutMs: 120_000 });
  }
  await expect
    .poll(() => page.evaluate(() => window.__greenfieldStore?.getState().tree.rows.length), {
      timeout: 10 * 60_000,
    })
    .toBe(LAYERS);
  const tree = left.getByRole('tree', { name: 'Layers' });
  await expect(tree.getByRole('treeitem').first()).toBeVisible();

  const result = await page.evaluate(async () => {
    const store = window.__greenfieldStore!;
    const bridge = window.__greenfieldBridge!.editor;
    const list = document.querySelector<HTMLElement>('[role="tree"][aria-label="Layers"]')!;
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      const at = (q: number) => +s[Math.min(s.length - 1, Math.floor(q * s.length))]!.toFixed(2);
      return { n: s.length, p50: at(0.5), p95: at(0.95), max: +s.at(-1)!.toFixed(2) };
    };
    const afterRender = () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(null);
      });
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

    const doc = store.getState().document!;
    let rev = doc.revision;
    let next = 9_000_000;
    const frames = store.getState().tree.roots;
    const inView = () =>
      [...list.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((e) => Number(e.dataset.id));
    const pickAny = () => {
      const rows = store.getState().tree.rows;
      return rows[Math.floor(Math.random() * rows.length)]!.id;
    };
    const pickShown = () => {
      const ids = inView();
      return ids[Math.floor(Math.random() * ids.length)]!;
    };
    const timed = async (patch: object) => {
      const t = performance.now();
      store.dispatch({
        type: 'document.changed',
        document: doc.id,
        revision: ++rev,
        undoDepth: doc.undoDepth,
        ...patch,
      });
      await afterRender();
      return performance.now() - t;
    };
    const kinds: Record<string, () => object> = {
      'move (x), any layer': () => ({ nodes: [{ id: pickAny(), x: rev }] }),
      'rename, a row in view': () => ({ nodes: [{ id: pickShown(), name: `R${rev}` }] }),
      'lock, a row in view': () => ({ nodes: [{ id: pickShown(), locked: rev % 2 === 0 }] }),
      'add a layer': () => {
        const id = ++next;
        return {
          added: [{ id, parent: frames[0], index: 0 }],
          nodes: [{ id, name: 'New', type: 'RECTANGLE' }],
        };
      },
      'reorder in a frame': () => {
        const f = store.getState().tree.nodes.get(frames[1]!)!;
        return { moved: [{ id: f.children[0], parent: f.id, index: f.children.length - 1 }] };
      },
    };
    const out: Record<string, unknown> = {
      layers: store.getState().tree.rows.length,
      rowsRendered: inView().length,
    };
    for (const [k, make] of Object.entries(kinds)) {
      for (let i = 0; i < 20; i++) await timed(make());
      const xs: number[] = [];
      for (let i = 0; i < 200; i++) xs.push(await timed(make()));
      out[`edit: ${k}`] = stats(xs);
    }

    // A rename end to end: the bridge call until the row shows it.
    const id = inView()[3]!;
    const rowEl = list.querySelector(`[data-id="${id}"]`)!;
    const t0 = performance.now();
    const seen = new Promise<number>((resolve) => {
      const mo = new MutationObserver(() => {
        if (rowEl.getAttribute('aria-label') === 'Renamed end to end') {
          mo.disconnect();
          resolve(performance.now() - t0);
        }
      });
      mo.observe(rowEl, { attributes: true, subtree: true, characterData: true, childList: true });
    });
    await bridge.execute('node.set', { ids: [id], name: 'Renamed end to end' });
    out['rename: bridge call to row repainted'] = +(await seen).toFixed(1);

    // Scrolling, one step per frame: like a wheel (120 px, a few new rows), and in jumps
    // (2,000 px: every row new) from the top to the bottom and back.
    const max = list.scrollHeight - list.clientHeight;
    const scroll = async (positions: number[]) => {
      const renders: number[] = [];
      const intervals: number[] = [];
      const onScroll = () => {
        const t = performance.now();
        void afterRender().then(() => renders.push(performance.now() - t));
      };
      list.addEventListener('scroll', onScroll);
      let last = await frame();
      for (const y of positions) {
        list.scrollTop = y;
        const now = await frame();
        intervals.push(now - last);
        last = now;
      }
      list.removeEventListener('scroll', onScroll);
      return {
        'scroll event to rows committed': stats(renders),
        'frame interval': stats(intervals),
        'frames over 20 ms': intervals.filter((x) => x > 20).length,
      };
    };
    const wheel = Array.from({ length: 600 }, (_, i) => (i + 1) * 120);
    const down = Array.from({ length: Math.ceil(max / 2_000) + 1 }, (_, i) =>
      Math.min(max, i * 2_000),
    );
    out['scroll: 120 px per frame'] = await scroll(wheel);
    out['scroll: 2,000 px per frame'] = await scroll([...down, ...down.reverse()]);
    return out;
  });
  const report = { browser: testInfo.project.name, ...result };
  console.log(JSON.stringify(report, null, 1));
  await testInfo.attach('layers-perf.json', { body: JSON.stringify(report, null, 1) });
  const noise = /clerk\.accounts\.dev.*access control checks/;
  problems.splice(0, problems.length, ...problems.filter((p) => !noise.test(p)));
});
