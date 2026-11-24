/**
 * The bridge against the real editor, through the Playwright helper (`@greenfield/bridge/playwright`).
 */
import { hashCommands } from '../scripts/command-types';
import {
  CommandError,
  COMMAND_COUNT,
  COMMANDS_HASH,
  EditorHiddenError,
  EDITOR_VERSION,
  NoDocumentError,
  ref,
  step,
  type ChangeSet,
  type DocumentInfo,
  type EditorNode,
} from '../src/index';
import { expect, openEditor, test, type RemoteEditor } from '../src/playwright/index';

const names = (doc: DocumentInfo): string[] => {
  const out: string[] = [];
  const walk = (n: EditorNode) => {
    if (n.type !== 'PAGE' && typeof n.name === 'string') out.push(n.name);
    for (const c of n.children ?? []) walk(c);
  };
  for (const p of doc.pages) walk(p);
  return out.sort();
};

/** Layer names, or null while no document is open (an `open` applies on a later frame). */
const docNames = (editor: RemoteEditor) =>
  editor.inspect({ fields: ['name', 'type'] }).then(names, (e: unknown) => {
    if (e instanceof NoDocumentError) return null;
    throw e;
  });

async function newDoc(editor: RemoteEditor) {
  await editor.execute('file.new', {});
  await expect
    .poll(async () => (await editor.inspect({ depth: 0, fields: [] })).pages.length)
    .toBe(1);
}

test('ready, version and the pinned command list', async ({ editor }) => {
  expect(editor.isReady).toBe(true);
  const info = await editor.ready();
  expect(info.appVersion).toBe(EDITOR_VERSION);
  const commands = await editor.commands();
  expect(commands).toHaveLength(COMMAND_COUNT);
  expect(hashCommands(commands)).toBe(COMMANDS_HASH);
});

test('execute and getNode', async ({ editor }) => {
  await newDoc(editor);
  const r = (await editor.execute('node.create', {
    type: 'frame',
    name: 'Card',
    width: 200,
    height: 120,
  })) as { id: number };
  expect(typeof r.id).toBe('number');
  await editor.execute('node.set', { ids: [r.id], props: { fill: '#FF6B6B', cornerRadius: 8 } });
  const node = await editor.getNode(r.id, { fields: ['name', 'type', 'width', 'fills'] });
  expect(node).toMatchObject({ id: r.id, name: 'Card', type: 'FRAME', width: 200 });
  expect(JSON.stringify(node?.fills)).toContain('#FF6B6B');
  expect(await editor.getNode(99_999)).toBeNull();
});

test('batch: references, one undo step, rollback on failure', async ({ editor }) => {
  await newDoc(editor);
  const results = await editor.batch(
    [
      { command: 'node.create', as: 'card', params: { type: 'frame', name: 'Card', width: 240 } },
      { command: 'node.create', params: { type: 'text', parent: ref('card'), text: 'Ada' } },
      { command: 'node.set', params: { ids: [step(0)], props: { name: 'Profile' } } },
    ],
    { label: 'Build card' },
  );
  expect(results).toHaveLength(3);
  const doc = await editor.inspect({ fields: ['name', 'type', 'characters'] });
  expect(doc.history.undo[0]).toBe('Build card');
  const card = doc.pages[0]!.children!.find((n) => n.name === 'Profile')!;
  expect(card.children?.map((c) => c.characters)).toEqual(['Ada']);

  // One undo step removes all three.
  await editor.execute('edit.undo', {});
  expect(names(await editor.inspect({ fields: ['name', 'type'] }))).toEqual([]);

  // The first failure rolls everything back and rejects with the editor's message.
  const err = await editor
    .batch([
      { command: 'node.create', params: { type: 'rectangle', name: 'Kept?' } },
      { command: 'text.set', params: { id: 99_999, text: 'x' } },
    ])
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CommandError);
  expect((err as CommandError).editorMessage).toContain('no such node 99999');
  expect(names(await editor.inspect({ fields: ['name', 'type'] }))).toEqual([]);

  // onError: continue runs the rest and reports per step.
  const per = await editor.batchContinue([
    { command: 'text.set', params: { id: 99_999, text: 'x' } },
    { command: 'node.create', params: { type: 'ellipse', name: 'Dot' } },
  ]);
  expect(per.map((s) => s.ok)).toEqual([false, true]);
  expect(names(await editor.inspect({ fields: ['name', 'type'] }))).toEqual(['Dot']);
});

test('typed errors carry the editor message', async ({ editor }) => {
  await newDoc(editor);
  const bad = await editor
    // @ts-expect-error: an unknown parameter is a type error too
    .execute('node.create', { type: 'frame', bogus: 1 })
    .catch((e: unknown) => e);
  expect(bad).toBeInstanceOf(CommandError);
  expect((bad as CommandError).command).toBe('node.create');
  expect((bad as CommandError).editorMessage).toMatch(
    /unknown parameter `bogus` \(it takes type, x/,
  );

  const field = await editor
    // @ts-expect-error: not a node field
    .inspect({ fields: ['nope'] })
    .catch((e: unknown) => e);
  expect(field).toBeInstanceOf(CommandError);
  expect((field as CommandError).editorMessage).toContain('unknown field `nope`');
});

test('inspect with fields and depth', async ({ editor }) => {
  await newDoc(editor);
  await editor.batch([
    { command: 'node.create', as: 'a', params: { type: 'frame', name: 'Outer' } },
    { command: 'node.create', as: 'b', params: { type: 'frame', name: 'Inner', parent: ref('a') } },
    { command: 'node.create', params: { type: 'rectangle', name: 'Leaf', parent: ref('b') } },
  ]);
  const shallow = await editor.inspect({ depth: 1, fields: ['name'] });
  const outer = shallow.pages[0]!.children![0]!;
  expect(outer).toMatchObject({ name: 'Outer' });
  expect(outer.children).toBeUndefined();
  expect(outer.childCount).toBe(1);
  expect(Object.keys(outer).sort()).toEqual(['childCount', 'id', 'name']);
  const deep = await editor.inspect({ depth: 8, outline: true });
  expect(names(deep)).toEqual(['Inner', 'Leaf', 'Outer']);
});

test('render returns a PNG of the given layers at the given scale', async ({ editor }) => {
  await newDoc(editor);
  const { id } = (await editor.execute('node.create', {
    type: 'frame',
    width: 200,
    height: 100,
    props: { fill: '#3366FF' },
  })) as { id: number };
  const one = await editor.render({ ids: [id], scale: 1 });
  expect([...one.png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
  expect(one).toMatchObject({ width: 200, height: 100 });
  const half = await editor.render({ ids: [id], scale: 0.5 });
  expect(half).toMatchObject({ width: 100, height: 50 });
});

test('open → edit → save → reopen', async ({ editor, page, editorOptions }) => {
  await newDoc(editor);
  await editor.execute('node.create', { type: 'frame', name: 'First' });
  await expect.poll(() => editor.dirtyLog.at(-1)).toBe(true);

  // First save of an untitled document: Save As.
  const first = await editor.nextSave(() => editor.save());
  expect(first).toMatchObject({ name: 'Untitled.figcraft', saveAs: true });
  expect(first.bytes.byteLength).toBeGreaterThan(100);
  await expect.poll(() => editor.dirtyLog.at(-1)).toBe(false);

  // Reopen in a fresh editor (a reload), edit, save with the platform's real key chord.
  const again = await openEditor(page, editorOptions);
  again.open('Poster.figcraft', first.bytes);
  await expect.poll(() => docNames(again)).toEqual(['First']);
  await again.execute('node.create', { type: 'frame', name: 'Second', x: 300 });
  const second = await again.nextSave(() => again.pressSave());
  expect(second).toMatchObject({ name: 'Poster.figcraft', saveAs: false });

  const third = await openEditor(page, editorOptions);
  third.open('Poster.figcraft', second.bytes);
  await expect.poll(() => docNames(third)).toEqual(['First', 'Second']);
  expect((await third.inspect({ depth: 0, fields: [] })).dirty).toBe(false);
});

test('change detection catches a control-channel edit', async ({ page }) => {
  const editor = await openEditor(page, { gateIntervalMs: 100, debounceMs: 100, backstopMs: 2000 });
  await newDoc(editor);
  const { id } = (await editor.execute('node.create', { type: 'frame', name: 'Box' })) as {
    id: number;
  };
  await editor.detectChanges(); // baseline (or the create, if a poll already set one)

  const seen: ChangeSet[] = [];
  const off = editor.onChange((c) => seen.push(c));
  await editor.execute('node.set', { ids: [id], props: { name: 'Renamed', x: 40 } });
  await expect
    .poll(() =>
      seen
        .flatMap((c) => c.changed)
        .find((c) => c.id === id)
        ?.fields.sort(),
    )
    .toEqual(['name', 'x']);
  const hit = seen.find((c) => c.changed.some((x) => x.id === id))!;
  expect(hit.controlEdits).toBeGreaterThan(0);
  expect(hit.meta.history).toBe(true);

  // On demand, before an agent turn.
  const created = (await editor.execute('node.create', { type: 'ellipse' })) as { id: number };
  const now = await editor.detectChanges();
  const all = [now, ...seen].filter(Boolean) as ChangeSet[];
  expect(all.some((c) => c.added.includes(created.id))).toBe(true);
  off();
  expect(editor.errors).toEqual([]);
});

test('a hidden tab fails fast with EditorHiddenError', async ({ editor }) => {
  await newDoc(editor);
  await editor.setHidden(true);
  const t0 = Date.now();
  const err = await editor.execute('node.create', { type: 'frame' }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(EditorHiddenError);
  expect(Date.now() - t0).toBeLessThan(2000);
  await expect(editor.inspect()).rejects.toBeInstanceOf(EditorHiddenError);
  await editor.setHidden(false);
  await expect(editor.inspect({ depth: 0, fields: [] })).resolves.toMatchObject({ dirty: false });
});

test('the editor runs under its CSP with no violations (Story 8.1)', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content.security.policy|\bCSP\b/i.test(m.text())) violations.push(m.text());
  });
  await page.exposeBinding('__cspViolation', (_s, v: string) => void violations.push(v));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __cspViolation(v: string): void }).__cspViolation(
        `${location.pathname}: ${e.effectiveDirective} ${e.blockedURI}`,
      ),
    ),
  );
  const editorPage = page.waitForResponse((r) => r.url().includes('/editor/index.html'));
  const editor = await openEditor(page);
  const csp = (await (await editorPage).allHeaders())['content-security-policy'] ?? '';
  expect(csp).toContain("'wasm-unsafe-eval'");
  expect(csp).not.toMatch(/'unsafe-eval'|'unsafe-inline'/);

  // Exercise the paths that create elements, styles and blobs: edit, render, save.
  await newDoc(editor);
  const { id } = (await editor.execute('node.create', { type: 'text', text: 'Hello' })) as {
    id: number;
  };
  await editor.render({ ids: [id], scale: 1 });
  await editor.nextSave(() => editor.save());
  expect(violations).toEqual([]);
});
