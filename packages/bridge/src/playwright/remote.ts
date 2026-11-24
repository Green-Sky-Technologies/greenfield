/**
 * `RemoteEditor`: the `Editor` interface in Node, driven through the real editor in a Playwright
 * page. Every call runs `createBridge`'s editor in the host page (`window.__greenfieldBridge`),
 * so tests exercise exactly the code the app ships. Errors come back as the same typed classes;
 * bytes cross as base64.
 */
import type { Frame, Page } from '@playwright/test';
import type { BatchStep, CommandId, CommandParams } from '../commands';
import {
  BridgeError,
  CommandError,
  EditorFailedError,
  EditorHiddenError,
  EditorNotReadyError,
  EditorTimeoutError,
  NoDocumentError,
} from '../errors';
import { platformFromUserAgent, saveChord, type KeyPlatform } from '../platform';
import type {
  BatchOptions,
  BatchStepResult,
  CallOptions,
  ChangeSet,
  CommandInfo,
  DocumentInfo,
  Editor,
  EditorNode,
  GetNodeOptions,
  InspectOptions,
  NodeId,
  ReadyInfo,
  RenderOptions,
  RenderResult,
  SaveEvent,
  Unsubscribe,
} from '../types';

interface WireError {
  __bridgeError: {
    name: string;
    code?: string;
    message: string;
    method?: string;
    command?: string;
    editorMessage?: string;
    timeoutMs?: number;
  };
}

function revive(w: WireError['__bridgeError']): Error {
  const method = w.method ?? 'call';
  let e: Error;
  switch (w.code) {
    case 'hidden':
      e = new EditorHiddenError(method);
      break;
    case 'not_ready':
      e = new EditorNotReadyError(method);
      break;
    case 'no_document':
      e = new NoDocumentError(method);
      break;
    case 'command':
      e = new CommandError(method, w.command, w.editorMessage ?? w.message);
      break;
    case 'timeout':
      e = new EditorTimeoutError(method, w.timeoutMs);
      break;
    case 'failed':
      e = new EditorFailedError(w.message);
      break;
    default:
      e = new Error(w.message);
  }
  e.message = w.message;
  return e;
}

class Emitter<T> {
  private readonly set = new Set<(v: T) => unknown>();
  get size() {
    return this.set.size;
  }
  add(cb: (v: T) => unknown): Unsubscribe {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  emit(v: T) {
    for (const cb of [...this.set]) cb(v);
  }
}

/** Events the host page sends through the `__greenfieldBridgeEvent` binding. */
export type HostEvent =
  | { type: 'ready'; payload: ReadyInfo }
  | { type: 'dirty'; payload: boolean }
  | { type: 'save'; payload: { name: string; saveAs: boolean; bytes: string; id?: unknown } }
  | { type: 'failed'; payload: string }
  | { type: 'change'; payload: ChangeSet }
  | { type: 'error'; payload: string };

export class RemoteEditor implements Editor {
  private info: ReadyInfo | null = null;
  private closed = false;
  private readonly readyCbs = new Emitter<ReadyInfo>();
  private readonly dirtyCbs = new Emitter<boolean>();
  private readonly saveCbs = new Emitter<SaveEvent>();
  private readonly failedCbs = new Emitter<string>();
  private readonly changeCbs = new Emitter<ChangeSet>();
  private queue: Promise<unknown> = Promise.resolve();
  private platformCache: KeyPlatform | undefined;
  /** Every `figcraft:save` so far (tests often just need the last one). */
  readonly saves: SaveEvent[] = [];
  /** Every dirty flag the editor reported. */
  readonly dirtyLog: boolean[] = [];
  /** Detector errors reported by the host page. */
  readonly errors: string[] = [];

  constructor(readonly page: Page) {}

  /** Feed an event from the host page (the fixture wires the binding to this). */
  handle(e: HostEvent): void {
    switch (e.type) {
      case 'ready':
        this.info = e.payload;
        this.readyCbs.emit(e.payload);
        break;
      case 'dirty':
        this.dirtyLog.push(e.payload);
        this.dirtyCbs.emit(e.payload);
        break;
      case 'save': {
        const s: SaveEvent = {
          name: e.payload.name,
          saveAs: e.payload.saveAs,
          bytes: new Uint8Array(Buffer.from(e.payload.bytes, 'base64')),
        };
        if (e.payload.id !== undefined) s.id = e.payload.id;
        this.saves.push(s);
        this.saveCbs.emit(s);
        break;
      }
      case 'failed':
        this.failedCbs.emit(e.payload);
        break;
      case 'change':
        this.changeCbs.emit(e.payload);
        break;
      case 'error':
        this.errors.push(e.payload);
        break;
    }
  }

  /** Run `method` on the in-page editor; calls are kept in order. */
  private call<T>(method: string, args: unknown[]): Promise<T> {
    const site = new Error(); // the caller's stack, for errors revived from the page
    const run = async () => {
      const r = await this.page.evaluate(
        async ([method, args]) => {
          const bridge = window.__greenfieldBridge;
          if (!bridge) throw new Error('No bridge host on this page');
          const editor = bridge.editor as unknown as Record<string, (...a: unknown[]) => unknown>;
          const toB64 = (b: Uint8Array) => {
            let s = '';
            for (let i = 0; i < b.length; i += 0x8000)
              s += String.fromCharCode(...b.subarray(i, i + 0x8000));
            return btoa(s);
          };
          if (method === 'open') {
            const [name, b64] = args as [string, string];
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            args = [name, bytes];
          }
          try {
            const value = await editor[method]!(...args);
            if (method === 'render') {
              const r = value as { png: Uint8Array; width: number; height: number };
              return { value: { ...r, png: toB64(r.png) } };
            }
            return { value };
          } catch (e) {
            const x = e as Record<string, unknown>;
            return {
              __bridgeError: {
                name: String(x?.name ?? 'Error'),
                code: x?.code as string | undefined,
                message: String(x?.message ?? e),
                method: x?.method as string | undefined,
                command: x?.command as string | undefined,
                editorMessage: x?.editorMessage as string | undefined,
                timeoutMs: x?.timeoutMs as number | undefined,
              },
            };
          }
        },
        [method, args] as const,
      );
      if ('__bridgeError' in r) {
        const e = revive((r as WireError).__bridgeError);
        e.stack = `${e.name}: ${e.message}\n${site.stack?.split('\n').slice(1).join('\n') ?? ''}`;
        throw e;
      }
      return (r as { value: T }).value;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  // ---- Editor

  get isReady(): boolean {
    return !this.closed && this.info !== null;
  }
  ready(): Promise<ReadyInfo> {
    return this.call('ready', []);
  }
  onReady(cb: (info: ReadyInfo) => void): Unsubscribe {
    const off = this.readyCbs.add(cb);
    const info = this.info;
    if (info) queueMicrotask(() => cb(info));
    return off;
  }
  onDirty(cb: (dirty: boolean) => void): Unsubscribe {
    return this.dirtyCbs.add(cb);
  }
  onSave(cb: (e: SaveEvent) => void | Promise<void>): Unsubscribe {
    return this.saveCbs.add(cb);
  }
  onFailed(cb: (error: string) => void): Unsubscribe {
    return this.failedCbs.add(cb);
  }
  open(name: string, bytes: Uint8Array | ArrayBuffer): void {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    // Queued: later calls see the open. Errors surface on the next call's `await`.
    void this.call('open', [name, Buffer.from(b).toString('base64')]).catch(() => undefined);
  }
  /** `open`, awaited (a Node-side convenience; the browser `open` is synchronous). */
  openAndWait(name: string, bytes: Uint8Array | ArrayBuffer): Promise<void> {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return this.call('open', [name, Buffer.from(b).toString('base64')]);
  }
  save(opts?: CallOptions): Promise<void> {
    return this.call('save', [opts]);
  }
  execute<C extends CommandId>(
    command: C,
    params?: CommandParams<C>,
    opts?: CallOptions,
  ): Promise<unknown> {
    return this.call('execute', [command, params, opts]);
  }
  batch(steps: readonly BatchStep[], opts?: BatchOptions): Promise<unknown[]> {
    return this.call('batch', [steps, opts]);
  }
  batchContinue(steps: readonly BatchStep[], opts?: BatchOptions): Promise<BatchStepResult[]> {
    return this.call('batchContinue', [steps, opts]);
  }
  inspect(opts?: InspectOptions, call?: CallOptions): Promise<DocumentInfo> {
    return this.call('inspect', [opts, call]);
  }
  getNode(id: NodeId, opts?: GetNodeOptions, call?: CallOptions): Promise<EditorNode | null> {
    return this.call('getNode', [id, opts, call]);
  }
  async render(opts?: RenderOptions, call?: CallOptions): Promise<RenderResult> {
    const r = await this.call<{ png: string; width: number; height: number }>('render', [
      opts,
      call,
    ]);
    return { ...r, png: new Uint8Array(Buffer.from(r.png, 'base64')) };
  }
  commands(call?: CallOptions): Promise<CommandInfo[]> {
    return this.call('commands', [call]);
  }
  request(method: string, params?: unknown, opts?: CallOptions): Promise<unknown> {
    return this.call('request', [method, params, opts]);
  }
  onChange(cb: (c: ChangeSet) => void): Unsubscribe {
    const first = this.changeCbs.size === 0;
    const off = this.changeCbs.add(cb);
    if (first) {
      void this.page
        .evaluate(() => {
          const w = window as Window & {
            __bridgeChangeOff?: () => void;
            __greenfieldBridgeEvent?: (type: string, payload: unknown) => void;
          };
          w.__bridgeChangeOff?.();
          w.__bridgeChangeOff = w.__greenfieldBridge!.editor.onChange((c) =>
            w.__greenfieldBridgeEvent?.('change', c),
          );
        })
        .catch(() => undefined);
    }
    return () => {
      off();
      if (this.changeCbs.size === 0) {
        void this.page
          .evaluate(() =>
            (window as Window & { __bridgeChangeOff?: () => void }).__bridgeChangeOff?.(),
          )
          .catch(() => undefined);
      }
    };
  }
  detectChanges(): Promise<ChangeSet | null> {
    return this.call('detectChanges', []);
  }
  dispose(): void {
    this.closed = true;
    void this.call('dispose', []).catch(() => undefined);
  }

  // ---- test helpers (not part of Editor)

  /** The editor iframe's Playwright frame. */
  frame(): Frame {
    const f = this.page.frames().find((x) => x.url().includes('/editor/index.html'));
    if (!f) throw new Error('No editor frame');
    return f;
  }

  /** Mac or not, as the editor decides it (from the user agent). */
  async platform(): Promise<KeyPlatform> {
    this.platformCache ??= platformFromUserAgent(
      await this.page.evaluate(() => navigator.userAgent),
    );
    return this.platformCache;
  }

  /** Press Save on the real keyboard (Meta+S on a Mac, Control+S elsewhere) in the canvas. */
  async pressSave(): Promise<void> {
    const canvas = this.frame().locator('canvas').first();
    await canvas.focus().catch(() => canvas.click({ position: { x: 5, y: 5 } }));
    await this.page.keyboard.press(saveChord(await this.platform()));
  }

  /**
   * Pretend the tab is hidden (or visible again): overrides `document.visibilityState` in the
   * host page and fires `visibilitychange`. Playwright keeps real pages visible.
   */
  async setHidden(hidden: boolean): Promise<void> {
    await this.page.evaluate((hidden) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (hidden ? 'hidden' : 'visible'),
      });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  }

  /** Wait for the next `figcraft:save` (after `fn`, if given). */
  async nextSave(fn?: () => Promise<unknown>, timeoutMs = 15_000): Promise<SaveEvent> {
    const got = new Promise<SaveEvent>((resolve, reject) => {
      const t = setTimeout(() => {
        off();
        reject(new Error(`No figcraft:save within ${timeoutMs} ms`));
      }, timeoutMs);
      const off = this.saveCbs.add((s) => {
        clearTimeout(t);
        off();
        resolve(s);
      });
    });
    await fn?.();
    return got;
  }

  /** Mark closed (the page is going away). */
  close(): void {
    this.closed = true;
  }
}

/** Re-exported so tests can `instanceof` without importing from the package root. */
export { BridgeError };
