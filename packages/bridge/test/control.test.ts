import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorSrc } from '../src/bridge';
import { ControlClient, type FigcraftApi } from '../src/control';
import {
  CommandError,
  EditorHiddenError,
  EditorNotReadyError,
  EditorTimeoutError,
  NoDocumentError,
} from '../src/errors';
import { isSaveShortcut, platformFromUserAgent, saveChord } from '../src/platform';
import { TINY_PNG_BASE64 } from '../src/png';

function fakeApi(over: Partial<FigcraftApi> = {}): FigcraftApi {
  return {
    request: vi.fn(async () => ({})),
    execute: vi.fn(async () => ({ id: 2 })),
    executeAs: vi.fn(async () => ({ id: 2 })),
    commands: vi.fn(async () => []),
    docInspect: vi.fn(async () => ({ id: 1, pages: [{ id: 1 }] })),
    ...over,
  };
}

function client(api: FigcraftApi | string, extra: { hidden?: boolean; timeoutMs?: number } = {}) {
  const onMutation = vi.fn();
  const c = new ControlClient({
    api: () => api,
    isHidden: () => extra.hidden ?? false,
    platform: () => 'mac',
    timeoutMs: extra.timeoutMs,
    onMutation,
  });
  return { c, onMutation };
}

afterEach(() => vi.useRealTimers());

describe('ControlClient', () => {
  it('fails fast when the tab is hidden, without calling the editor', async () => {
    const api = fakeApi();
    const { c } = client(api, { hidden: true });
    await expect(c.execute('node.create', { type: 'frame' })).rejects.toBeInstanceOf(
      EditorHiddenError,
    );
    await expect(c.inspect()).rejects.toBeInstanceOf(EditorHiddenError);
    expect(api.execute).not.toHaveBeenCalled();
    expect(api.docInspect).not.toHaveBeenCalled();
  });

  it('reports not ready with the reason', async () => {
    const { c } = client('the editor has not posted figcraft:ready yet');
    const e = await c.render().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(EditorNotReadyError);
    expect(String(e)).toMatch(/ui\.render.*figcraft:ready/);
  });

  it('turns editor rejections into CommandError with the editor message', async () => {
    const api = fakeApi({
      execute: vi.fn(async () => {
        throw new Error('invalid parameters for `node.create`: unknown parameter `bogus`');
      }),
    });
    const { c } = client(api);
    const e = (await c
      .execute('node.create', { type: 'frame' })
      .catch((x: unknown) => x)) as CommandError;
    expect(e).toBeInstanceOf(CommandError);
    expect(e.code).toBe('command');
    expect(e.command).toBe('node.create');
    expect(e.method).toBe('engine.execute');
    expect(e.editorMessage).toBe('invalid parameters for `node.create`: unknown parameter `bogus`');
  });

  it('maps the editor’s own 30 s rejection to EditorTimeoutError', async () => {
    const api = fakeApi({
      docInspect: vi.fn(async () => {
        throw new Error('figcraft did not answer document.inspect within 30 s');
      }),
    });
    await expect(client(api).c.inspect()).rejects.toBeInstanceOf(EditorTimeoutError);
  });

  it('times out on its own deadline', async () => {
    vi.useFakeTimers();
    const api = fakeApi({ request: vi.fn(() => new Promise(() => {})) });
    const { c } = client(api, { timeoutMs: 1000 });
    const p = c.request('ui.inspect').catch((x: unknown) => x);
    await vi.advanceTimersByTimeAsync(999);
    const pending = Symbol('pending');
    expect(await Promise.race([p, Promise.resolve(pending)])).toBe(pending);
    await vi.advanceTimersByTimeAsync(1);
    const e = (await p) as EditorTimeoutError;
    expect(e).toBeInstanceOf(EditorTimeoutError);
    expect(e.timeoutMs).toBe(1000);
    // A per-call deadline wins.
    const q = c.request('ui.inspect', {}, { timeoutMs: 50 }).catch((x: unknown) => x);
    await vi.advanceTimersByTimeAsync(50);
    expect(await q).toBeInstanceOf(EditorTimeoutError);
  });

  it('batch sends command.batch with the label and counts as a mutation', async () => {
    const api = fakeApi({ execute: vi.fn(async () => [{ id: 3 }, { id: 4 }]) });
    const { c, onMutation } = client(api);
    const r = await c.batch(
      [
        { command: 'node.create', as: 'card', params: { type: 'frame' } },
        { command: 'node.create', params: { type: 'text', parent: { $ref: 'card' }, text: 'Hi' } },
      ],
      { label: 'Card' },
    );
    expect(r).toEqual([{ id: 3 }, { id: 4 }]);
    expect(api.execute).toHaveBeenCalledWith('command.batch', {
      label: 'Card',
      commands: [
        { command: 'node.create', as: 'card', params: { type: 'frame' } },
        { command: 'node.create', params: { type: 'text', parent: { $ref: 'card' }, text: 'Hi' } },
      ],
    });
    await c.batchContinue([{ command: 'edit.undo' }]);
    expect(api.execute).toHaveBeenLastCalledWith('command.batch', {
      onError: 'continue',
      commands: [{ command: 'edit.undo' }],
    });
    expect(onMutation).toHaveBeenCalledTimes(2);
    await c.inspect();
    expect(onMutation).toHaveBeenCalledTimes(2);
  });

  it('runs execute and batch as an agent through executeAs', async () => {
    const api = fakeApi({ executeAs: vi.fn(async () => ({ id: 5 })) });
    const { c, onMutation } = client(api);
    await c.execute('node.set', { ids: [4], name: 'Hero' }, { agent: 'Claude' });
    expect(api.executeAs).toHaveBeenLastCalledWith('Claude', 'node.set', {
      ids: [4],
      name: 'Hero',
    });
    await c.batch([{ command: 'node.set', params: { ids: [4], visible: false } }], {
      label: 'Tidy',
      agent: 'Claude',
    });
    expect(api.executeAs).toHaveBeenLastCalledWith('Claude', 'command.batch', {
      label: 'Tidy',
      commands: [{ command: 'node.set', params: { ids: [4], visible: false } }],
    });
    expect(api.execute).not.toHaveBeenCalled();
    expect(onMutation).toHaveBeenCalledTimes(2);
  });

  it('inspect drops undefined options and reports no document', async () => {
    const api = fakeApi();
    const { c } = client(api);
    await c.inspect({ depth: 0, fields: [], outline: undefined });
    expect(api.docInspect).toHaveBeenCalledWith({ depth: 0, fields: [] });
    const home = fakeApi({ docInspect: vi.fn(async () => ({ documents: 0 })) });
    await expect(client(home).c.inspect()).rejects.toBeInstanceOf(NoDocumentError);
  });

  it('getNode returns null for a missing layer', async () => {
    const api = fakeApi({ request: vi.fn(async () => null) });
    expect(await client(api).c.getNode(99, { fields: ['name'] })).toBeNull();
    expect(api.request).toHaveBeenCalledWith('node.get', { id: 99, fields: ['name'] });
  });

  it('render calls ui.render with ids and scale and decodes the PNG', async () => {
    const api = fakeApi({ request: vi.fn(async () => ({ format: 'png', data: TINY_PNG_BASE64 })) });
    const r = await client(api).c.render({ ids: [3], scale: 0.5 });
    expect(api.request).toHaveBeenCalledWith('ui.render', { ids: [3], scale: 0.5 });
    expect(r).toMatchObject({ width: 1, height: 1 });
    expect(r.png[1]).toBe(0x50);
    const broken = fakeApi({ request: vi.fn(async () => ({ format: 'png', data: 'AAAA' })) });
    await expect(client(broken).c.render()).rejects.toBeInstanceOf(CommandError);
  });

  it('save presses the platform shortcut', async () => {
    const api = fakeApi();
    await client(api).c.save();
    expect(api.request).toHaveBeenCalledWith('ui.key', { key: 'S', cmd: true });
  });
});

describe('platform', () => {
  const mac =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
  const win =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36';
  const linux = 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0';
  const ipad = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15';

  it('follows egui: Cmd on a Mac (and iOS), Ctrl elsewhere', () => {
    expect(platformFromUserAgent(mac)).toBe('mac');
    expect(platformFromUserAgent(ipad)).toBe('mac');
    expect(platformFromUserAgent(win)).toBe('other');
    expect(platformFromUserAgent(linux)).toBe('other');
    expect(saveChord('mac')).toBe('Meta+S');
    expect(saveChord('other')).toBe('Control+S');
  });

  it('recognises the save shortcut on a host keydown', () => {
    const k = (o: Partial<KeyboardEvent>) => ({
      key: 's',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...o,
    });
    expect(isSaveShortcut(k({ metaKey: true }), 'mac')).toBe(true);
    expect(isSaveShortcut(k({ ctrlKey: true }), 'mac')).toBe(false);
    expect(isSaveShortcut(k({ ctrlKey: true }), 'other')).toBe(true);
    expect(isSaveShortcut(k({ ctrlKey: true, key: 'S' }), 'other')).toBe(true);
    expect(isSaveShortcut(k({ ctrlKey: true, shiftKey: true }), 'other')).toBe(false);
  });
});

describe('editorSrc', () => {
  it('builds the host + control URL', () => {
    expect(editorSrc()).toBe('/editor/index.html?host=parent&control');
    expect(editorSrc('/editor/index.html', 'Ada L', { webgl: true, x: 'a b' })).toBe(
      '/editor/index.html?host=parent&control&author=Ada%20L&webgl&x=a%20b',
    );
  });
});
