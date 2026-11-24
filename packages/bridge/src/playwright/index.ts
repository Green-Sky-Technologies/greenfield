/**
 * `@greenfield/bridge/playwright`: Playwright fixtures that drive the real editor through the
 * bridge.
 *
 *   import { test, expect } from '@greenfield/bridge/playwright';
 *   test('draws', async ({ editor }) => {
 *     await editor.execute('file.new', {});
 *     await editor.execute('node.create', { type: 'frame', name: 'Card' });
 *   });
 *
 * The `editor` fixture opens a host page (default `/__bridge/host.html` from `server.ts`, so set
 * `baseURL` to that server) which embeds `/editor/index.html?host=parent&control&author=…` with
 * `createBridge`, waits for `figcraft:ready`, and returns a `RemoteEditor`: the `Editor`
 * interface in Node, plus helpers (`pressSave`, `setHidden`, `nextSave`, `frame`). A host page of
 * your own works too if it sets `window.__greenfieldBridge = { editor, iframe }` (see
 * `host-entry.ts`).
 */
import { test as base, expect, type Page } from '@playwright/test';
import { RemoteEditor, type HostEvent } from './remote';

export { RemoteEditor, type HostEvent } from './remote';
export { expect };

export interface EditorFixtureOptions {
  /** Host page path (relative to `baseURL`). */
  hostPath: string;
  /** `?author=` for the editor. */
  author: string;
  /** Force WebGL2 (`?webgl`). Default true. */
  webgl: boolean;
  /** Change detector tuning, passed to the host page. */
  gateIntervalMs?: number;
  debounceMs?: number;
  backstopMs?: number;
  /** How long to wait for `figcraft:ready`. */
  readyTimeoutMs: number;
}

export const defaultEditorOptions: EditorFixtureOptions = {
  hostPath: '/__bridge/host.html',
  author: 'Playwright',
  // Headless browsers may expose WebGPU without a usable adapter (the editor then never starts);
  // FigCraft's own docs force WebGL2 for headless runs.
  webgl: true,
  readyTimeoutMs: 60_000,
};

const routes = new WeakMap<Page, { editor: RemoteEditor }>();

/** Open the host page in `page` (again: a reload) and wait until the editor is ready. */
export async function openEditor(
  page: Page,
  options: Partial<EditorFixtureOptions> = {},
): Promise<RemoteEditor> {
  const o = { ...defaultEditorOptions, ...options };
  const editor = new RemoteEditor(page);
  const route = routes.get(page);
  if (route) {
    route.editor.close();
    route.editor = editor;
  } else {
    // Once per page (a binding can't be registered twice); events go to the latest editor.
    const r = { editor };
    routes.set(page, r);
    // Functions compiled by tsx/esbuild (keepNames) reference `__name` in the page.
    await page.addInitScript('window.__name = window.__name || ((f) => f)');
    await page.exposeBinding('__greenfieldBridgeEvent', (_source, type: string, payload: unknown) =>
      r.editor.handle({ type, payload } as HostEvent),
    );
  }
  const q = new URLSearchParams({ author: o.author });
  if (o.webgl) q.set('webgl', '');
  if (o.gateIntervalMs !== undefined) q.set('gate', String(o.gateIntervalMs));
  if (o.debounceMs !== undefined) q.set('debounce', String(o.debounceMs));
  if (o.backstopMs !== undefined) q.set('backstop', String(o.backstopMs));
  await page.goto(`${o.hostPath}?${q}`);
  await page.waitForFunction(() => window.__greenfieldBridge !== undefined);
  await Promise.race([
    editor.ready(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('The editor did not post figcraft:ready')),
        o.readyTimeoutMs,
      ),
    ),
  ]);
  // The ready event and the call may race; make sure isReady is set.
  if (!editor.isReady) editor.handle({ type: 'ready', payload: await editor.ready() });
  return editor;
}

export const test = base.extend<{
  editor: RemoteEditor;
  editorOptions: Partial<EditorFixtureOptions>;
}>({
  editorOptions: [{}, { option: true }],
  editor: async ({ page, editorOptions }, use) => {
    const editor = await openEditor(page, editorOptions);
    await use(editor);
    editor.close();
  },
});
