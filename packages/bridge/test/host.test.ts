import { describe, expect, it, vi } from 'vitest';
import { EditorFailedError, EditorNotReadyError } from '../src/errors';
import { HostChannel, type EditorWindowLike, type HostWindowLike } from '../src/host';

const ORIGIN = 'https://app.example';

function setup() {
  let listener: ((e: MessageEvent) => void) | undefined;
  const hostWindow: HostWindowLike = {
    location: { origin: ORIGIN },
    addEventListener: (_t, cb) => (listener = cb),
    removeEventListener: (_t, cb) => {
      if (listener === cb) listener = undefined;
    },
  };
  const posted: { message: unknown; origin: string; transfer?: Transferable[] }[] = [];
  const editor: EditorWindowLike = {
    postMessage: (message, origin, transfer) => posted.push({ message, origin, transfer }),
  };
  const channel = new HostChannel({ hostWindow, editorWindow: () => editor });
  channel.listen();
  const deliver = (data: unknown, opts: { origin?: string; source?: unknown } = {}) =>
    listener?.({
      data,
      origin: opts.origin ?? ORIGIN,
      source: opts.source ?? editor,
    } as MessageEvent);
  return { channel, deliver, posted, editor, hasListener: () => listener !== undefined };
}

const ready = { type: 'figcraft:ready', version: '1', appVersion: '0.18.1' };

describe('HostChannel', () => {
  it('accepts messages only from its own origin and the editor window', () => {
    const { channel, deliver } = setup();
    deliver(ready, { origin: 'https://evil.example' });
    deliver(ready, { source: {} });
    expect(channel.isReady).toBe(false);
    deliver(ready);
    expect(channel.isReady).toBe(true);
    expect(channel.info).toEqual({ version: '1', appVersion: '0.18.1' });
  });

  it('ignores malformed and unrelated messages', () => {
    const { channel, deliver } = setup();
    const dirty = vi.fn();
    channel.onDirty(dirty);
    for (const data of [
      null,
      'figcraft:ready',
      42,
      { type: 'other' },
      { type: 'figcraft:dirty' },
    ]) {
      deliver(data);
    }
    deliver({ type: 'figcraft:save', name: 'x', bytes: 'not bytes' });
    expect(channel.isReady).toBe(false);
    expect(dirty).not.toHaveBeenCalled();
  });

  it('handles ready once per load; late subscribers still hear it', async () => {
    const { channel, deliver } = setup();
    const early = vi.fn();
    channel.onReady(early);
    const waiting = channel.ready();
    deliver(ready);
    deliver({ ...ready, appVersion: '9.9.9' }); // a repeat is ignored
    await expect(waiting).resolves.toEqual({ version: '1', appVersion: '0.18.1' });
    expect(early).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    channel.onReady(late);
    await Promise.resolve();
    expect(late).toHaveBeenCalledWith({ version: '1', appVersion: '0.18.1' });
    // After reset (the iframe reloads), a new ready is accepted.
    channel.reset();
    deliver({ ...ready, appVersion: '0.19.0' });
    expect(channel.info?.appVersion).toBe('0.19.0');
  });

  it('reports dirty changes', () => {
    const { channel, deliver } = setup();
    const seen: boolean[] = [];
    channel.onDirty((d) => seen.push(d));
    deliver({ type: 'figcraft:dirty', dirty: true });
    deliver({ type: 'figcraft:dirty', dirty: false });
    expect(seen).toEqual([true, false]);
  });

  it('reports editor events with their data, and ignores ones without a name', () => {
    const { channel, deliver } = setup();
    const seen: unknown[] = [];
    channel.onEvent((e) => seen.push(e));
    deliver({ type: 'figcraft:event', name: 'selection.changed', data: { ids: [2] } });
    deliver({ type: 'figcraft:event', data: { ids: [3] } });
    expect(seen).toEqual([{ name: 'selection.changed', data: { ids: [2] } }]);
  });

  it('delivers saves as bytes and acknowledges ones with an id after the listeners finish', async () => {
    const { channel, deliver, posted } = setup();
    deliver(ready);
    let release!: () => void;
    const stored = new Promise<void>((r) => (release = r));
    const saves: unknown[] = [];
    channel.onSave((s) => {
      saves.push(s);
      return stored;
    });
    const buf = new Uint8Array([1, 2, 3]).buffer;
    deliver({ type: 'figcraft:save', name: 'A.figcraft', saveAs: true, bytes: buf });
    expect(saves).toEqual([{ name: 'A.figcraft', saveAs: true, bytes: new Uint8Array([1, 2, 3]) }]);
    deliver({ type: 'figcraft:save', name: 'A.figcraft', saveAs: false, bytes: buf, id: 7 });
    await Promise.resolve();
    expect(posted).toEqual([]); // not stored yet
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).toEqual([
      { message: { type: 'figcraft:saved', id: 7 }, origin: ORIGIN, transfer: undefined },
    ]);
  });

  it('a throwing listener does not stop the others', () => {
    const { channel, deliver } = setup();
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    const second = vi.fn();
    channel.onDirty(() => {
      throw new Error('boom');
    });
    channel.onDirty(second);
    deliver({ type: 'figcraft:dirty', dirty: true });
    expect(second).toHaveBeenCalledWith(true);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    vi.unstubAllGlobals();
  });

  it('failed rejects ready() with EditorFailedError', async () => {
    const { channel, deliver } = setup();
    const waiting = channel.ready();
    const failed = vi.fn();
    channel.onFailed(failed);
    deliver({ type: 'figcraft:failed', error: 'no WebGPU or WebGL2' });
    await expect(waiting).rejects.toBeInstanceOf(EditorFailedError);
    await expect(channel.ready()).rejects.toThrow(/no WebGPU or WebGL2/);
    expect(failed).toHaveBeenCalledWith('no WebGPU or WebGL2');
  });

  it('open needs ready, posts to its own origin and never detaches the caller’s bytes', () => {
    const { channel, deliver, posted } = setup();
    const bytes = new Uint8Array([9, 8, 7, 6]);
    expect(() => channel.open('A.figcraft', bytes)).toThrow(EditorNotReadyError);
    deliver(ready);
    channel.open('A.figcraft', bytes.subarray(1, 3));
    expect(bytes.byteLength).toBe(4); // still usable
    const p = posted[0]!;
    expect(p.origin).toBe(ORIGIN);
    const msg = p.message as { type: string; name: string; bytes: ArrayBuffer };
    expect(msg.type).toBe('figcraft:open');
    expect(msg.name).toBe('A.figcraft');
    expect([...new Uint8Array(msg.bytes)]).toEqual([8, 7]);
    expect(p.transfer).toEqual([msg.bytes]);
  });

  it('close stops listening and rejects pending ready()', async () => {
    const { channel, hasListener } = setup();
    const waiting = channel.ready();
    channel.close();
    expect(hasListener()).toBe(false);
    await expect(waiting).rejects.toBeInstanceOf(EditorNotReadyError);
  });
});
