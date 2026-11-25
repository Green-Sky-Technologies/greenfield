/**
 * Story 5.6 perf box, on the project page with the real editor: a 30,000-layer page, and what one
 * update costs the store and its row model. Off unless PERF=1 (generating the file takes minutes):
 *
 *   PERF=1 pnpm --filter @greenfield/web e2e:editor --project=chromium canvas-perf
 *
 * Measured in the page with `performance.now()` around `EditorStore.dispatch` (the reducer, the
 * tree patch and the row model's rebuild), for the `document.changed` payloads the editor will
 * send (lane W1-A), 200 runs each. Also: the full read on open (what every edit cost before
 * patches: ADR 0005's 64 ms at 5,002 layers), and today's ids-only path end to end (a rename
 * through the bridge until the store has it). Results go to stdout and the test's attachments.
 */
import { openEditor } from '@greenfield/bridge/playwright';
import { ref, type BatchStep } from '@greenfield/bridge';
import { createProject, uniqueName } from '../app/support/app';
import { expect, test } from '../app/support/fixtures';

const LAYERS = 30_000;
const PER_FRAME = 500;

test.skip(!process.env.PERF, 'perf run only: PERF=1');
test.setTimeout(30 * 60_000);

test('a 30,000-layer page: store and row model per update', async ({ as, run }, testInfo) => {
  const page = await as('editor');
  const projectId = await createProject(page, run.org.slug, uniqueName('Perf'));
  const editor = await openEditor(page, { hostPath: `/w/${run.org.slug}/p/${projectId}` });
  await expect(page.getByTestId('editor-status')).toHaveAttribute('data-status', 'empty');

  const t0 = Date.now();
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
  const generateMs = Date.now() - t0;
  await expect
    .poll(() => page.evaluate(() => window.__greenfieldStore?.getState().tree.rows.length), {
      timeout: 10 * 60_000,
    })
    .toBe(LAYERS);

  const result = await page.evaluate(async () => {
    const store = window.__greenfieldStore!;
    const bridge = window.__greenfieldBridge!.editor;
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      const at = (q: number) => +s[Math.min(s.length - 1, Math.floor(q * s.length))]!.toFixed(3);
      return { p50: at(0.5), p95: at(0.95), max: +s.at(-1)!.toFixed(3) };
    };
    const doc = store.getState().document!;
    const ids = store.getState().tree.rows.map((r) => r.id);
    const frames = store.getState().tree.roots;
    let rev = doc.revision;
    let next = 9_000_000;
    const pick = () => ids[Math.floor(Math.random() * ids.length)]!;
    const timed = (patch: object) => {
      const t = performance.now();
      store.dispatch({
        type: 'document.changed',
        document: doc.id,
        revision: ++rev,
        undoDepth: doc.undoDepth,
        ...patch,
      });
      return performance.now() - t;
    };
    const kinds: Record<string, () => object> = {
      'move (x)': () => ({ nodes: [{ id: pick(), x: rev }] }),
      rename: () => ({ nodes: [{ id: pick(), name: `R${rev}` }] }),
      add: () => {
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
    const out: Record<string, unknown> = { layers: ids.length };
    for (const [k, make] of Object.entries(kinds)) {
      for (let i = 0; i < 20; i++) timed(make());
      out[k] = stats(Array.from({ length: 200 }, () => timed(make())));
    }
    // The full read on open: the editor's reply, then the store's build of tree and rows.
    const tRead = performance.now();
    const info = await bridge.inspect({ depth: 64, fields: ['name', 'type', 'visible', 'locked'] });
    const readMs = performance.now() - tRead;
    const tBuild = performance.now();
    const page = info.pages.find((p) => p.id === info.currentPage)!;
    store.dispatch({
      type: 'document.loaded',
      document: store.getState().document!,
      pages: store.getState().pages as never,
      layers: (page.children ?? []) as never,
      selection: [],
    });
    out['full read on open (editor reply)'] = +readMs.toFixed(1);
    out['full build on open (store)'] = +(performance.now() - tBuild).toFixed(1);
    // Today's ids-only path: a rename through the bridge until the store has it.
    const id = store.getState().tree.rows[5]!.id;
    const tRename = performance.now();
    const seen = new Promise<number>((resolve) => {
      const off = store.subscribe(() => {
        if (store.getState().tree.nodes.get(id)?.name === 'Renamed') {
          off();
          resolve(performance.now() - tRename);
        }
      });
    });
    await bridge.execute('node.set', { ids: [id], name: 'Renamed' });
    out['ids-only rename to store (today, with the re-read)'] = +(await seen).toFixed(1);
    return out;
  });
  const report = { browser: testInfo.project.name, generateMs, ...result };
  console.log(JSON.stringify(report, null, 1));
  await testInfo.attach('perf.json', { body: JSON.stringify(report, null, 1) });
});
