/**
 * The editor's events (`figcraft:event`, fork Story 2.3) through `onEvent`, against the real
 * editor in Chromium, WebKit and Firefox, and the control round trip (replies resolve when the
 * frame that ran the call ends, not on a 16 ms poll).
 */
import type { EditorEvent, EditorEventMap, EditorEventName } from '../src/index';
import { expect, test, type RemoteEditor } from '../src/playwright/index';

type Data<N extends EditorEventName> = EditorEventMap[N];

/** The first (or latest) event `name` after `from` (an index into `editor.events`) that `ok` accepts. */
async function next<N extends EditorEventName>(
  editor: RemoteEditor,
  from: number,
  name: N,
  ok: (d: Data<N>) => boolean = () => true,
  which: 'first' | 'latest' = 'first',
): Promise<Data<N>> {
  let found: Data<N> | undefined;
  await expect
    .poll(() => {
      const all = editor.events
        .slice(from)
        .filter((e): e is Extract<EditorEvent, { name: N }> => e.name === name)
        .map((e) => e.data as Data<N>)
        .filter(ok);
      found = which === 'first' ? all[0] : all.at(-1);
      return found !== undefined;
    }, `${name} after event ${from}`)
    .toBe(true);
  return found!;
}

async function newDoc(editor: RemoteEditor) {
  const mark = editor.events.length;
  await editor.execute('file.new', {});
  await next(editor, mark, 'document.changed', (d) => d.resync);
}

const rect = async (editor: RemoteEditor, x: number, name: string) =>
  (
    (await editor.execute('node.create', {
      type: 'rectangle',
      name,
      x,
      y: 0,
      width: 80,
      height: 60,
    })) as {
      id: number;
    }
  ).id;

test('selection.changed carries the selected layers’ fields', async ({ editor }) => {
  await newDoc(editor);
  const id = await rect(editor, 0, 'Card');
  await editor.execute('select.none', {});
  let mark = editor.events.length;
  await editor.execute('select.set', { ids: [id] });
  const sel = await next(editor, mark, 'selection.changed', (d) => d.ids.includes(id));
  expect(sel.ids).toEqual([id]);
  expect(sel.nodes).toEqual([await editor.getNode(id, { depth: 0 })]);
  expect(sel.nodes[0]).toMatchObject({
    id,
    name: 'Card',
    type: 'RECTANGLE',
    width: 80,
    height: 60,
  });
  mark = editor.events.length;
  await editor.execute('select.none', {});
  expect((await next(editor, mark, 'selection.changed')).nodes).toEqual([]);
});

test('document.changed patches: changed fields, added, removed, moved, agent', async ({
  editor,
}) => {
  await newDoc(editor);
  const page = (await editor.inspect({ depth: 0, fields: [] })).currentPage;
  const a = await rect(editor, 0, 'A');
  const b = await rect(editor, 100, 'B');
  let mark = editor.events.length;
  await editor.execute('node.set', { ids: [a], props: { x: 40, opacity: 0.5 } });
  let d = await next(editor, mark, 'document.changed', (x) => x.nodes.some((n) => n.id === a));
  expect(d.resync).toBe(false);
  expect(d.agent).toBeNull();
  expect(d.nodes.find((n) => n.id === a)).toMatchObject({ id: a, x: 40, opacity: 0.5 });
  expect(d.nodes.find((n) => n.id === a)).not.toHaveProperty('name');

  mark = editor.events.length;
  const c = await rect(editor, 200, 'C');
  d = await next(editor, mark, 'document.changed', (x) => x.added.length > 0);
  expect(d.added).toEqual([{ id: c, parent: page, index: 2 }]);
  expect(d.nodes.find((n) => n.id === c)).toMatchObject({ name: 'C', type: 'RECTANGLE' });

  mark = editor.events.length;
  await editor.execute('arrange.front', { ids: [a] });
  d = await next(editor, mark, 'document.changed', (x) => x.moved.length > 0);
  expect(d.moved).toEqual([{ id: a, parent: page, index: 2 }]);

  mark = editor.events.length;
  await editor.execute('edit.delete', { ids: [b] });
  d = await next(editor, mark, 'document.changed', (x) => x.removed.length > 0);
  expect(d.removed).toEqual([{ id: b, parent: page, index: 0 }]);
  expect(d.moved).toEqual([]);

  mark = editor.events.length;
  await editor.request('engine.execute', {
    command: 'node.set',
    params: { ids: [c], props: { name: 'By Claude' } },
    agent: 'Claude',
  });
  d = await next(editor, mark, 'document.changed', (x) => x.nodes.some((n) => n.id === c));
  expect(d.agent).toBe('Claude (agent)');
});

test('tool.changed, text.editing and viewport.changed', async ({ editor }) => {
  await newDoc(editor);
  let mark = editor.events.length;
  await editor.execute('tool.set', { tool: 'frame' });
  expect(await next(editor, mark, 'tool.changed')).toEqual({ tool: 'frame' });
  await editor.execute('tool.set', { tool: 'move' });

  const t = (
    (await editor.execute('node.create', { type: 'text', text: 'Hi', x: 0, y: 100 })) as {
      id: number;
    }
  ).id;
  mark = editor.events.length;
  await editor.execute('text.edit.begin', { id: t });
  expect((await next(editor, mark, 'text.editing', (d) => d.id !== null)).id).toBe(t);
  mark = editor.events.length;
  await editor.execute('text.edit.end', {});
  expect((await next(editor, mark, 'text.editing')).id).toBeNull();

  mark = editor.events.length;
  await editor.execute('view.set', { zoom: 2 });
  const v = await next(editor, mark, 'viewport.changed', (d) => d.zoom === 2);
  const view = (await editor.execute('view.get', {})) as Record<string, number>;
  expect(v.x).toBeCloseTo(view.cx! - view.vw! / 4);
  expect(v.y).toBeCloseTo(view.cy! - view.vh! / 4);
});

test('interaction.changed: the host’s gesture and the canvas’s own drag', async ({
  editor,
  page,
}) => {
  await newDoc(editor);
  await editor.execute('view.canvasMode', { on: true });
  const id = await rect(editor, 0, 'Drag me');
  let mark = editor.events.length;
  await editor.execute('edit.begin', { label: 'Scrub' });
  expect(await next(editor, mark, 'interaction.changed', (d) => d.active)).toMatchObject({
    active: true,
    label: 'Scrub',
    host: true,
  });
  mark = editor.events.length;
  await editor.execute('edit.commit', {});
  expect((await next(editor, mark, 'interaction.changed')).active).toBe(false);

  // Drag the layer on the canvas: the latest viewport event says where it is on screen.
  await editor.execute('select.none', {});
  const v = await next(editor, 0, 'viewport.changed', () => true, 'latest');
  const box = (await page.locator('#editor').boundingBox())!;
  const at = { x: box.x + (40 - v.x) * v.zoom, y: box.y + (30 - v.y) * v.zoom };
  mark = editor.events.length;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 20, at.y + 10, { steps: 5 });
  expect(await next(editor, mark, 'interaction.changed', (d) => d.active)).toMatchObject({
    active: true,
    host: false,
  });
  await expect(editor.execute('edit.begin', {})).rejects.toThrow();
  await page.mouse.up();
  await next(editor, mark, 'interaction.changed', (d) => !d.active);
  expect(await editor.getNode(id, { fields: ['x'] })).toMatchObject({ x: 20 });
});

test('a control call resolves within a frame of being made', async ({ editor, page }) => {
  await newDoc(editor);
  // In the host page: the editor's frame period, and calls made at random points in a frame,
  // timed from the call to its reply.
  const { frame, calls } = await page.evaluate(async () => {
    const f = (document.getElementById('editor') as HTMLIFrameElement).contentWindow as Window & {
      figcraft: { execute(c: string, p: unknown): Promise<unknown> };
    };
    const stamps: number[] = [];
    await new Promise<void>((done) => {
      const tick = (t: number) => {
        stamps.push(t);
        if (stamps.length < 31) f.requestAnimationFrame(tick);
        else done();
      };
      f.requestAnimationFrame(tick);
    });
    const periods = stamps.slice(1).map((t, i) => t - stamps[i]!);
    const calls: number[] = [];
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, Math.random() * 20));
      const t0 = performance.now();
      await f.figcraft.execute('view.get', {});
      calls.push(performance.now() - t0);
    }
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[xs.length >> 1]!;
    return { frame: median(periods), calls: median(calls) };
  });
  console.log(`control round trip p50 ${calls.toFixed(1)} ms, frame ${frame.toFixed(1)} ms`);
  expect(calls).toBeLessThan(frame);
});
