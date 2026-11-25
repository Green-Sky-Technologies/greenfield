/**
 * The host half of the bridge: FigCraft's `?host=parent` messages (craft-web-host contract v1).
 *
 *   figcraft:ready  editor → host  {version, appVersion}   once per load
 *   figcraft:open   host → editor  {name, bytes}
 *   figcraft:dirty  editor → host  {dirty}
 *   figcraft:save   editor → host  {name, saveAs, bytes, id?}   (`figcraft:saved {id}` back)
 *   figcraft:failed editor → host  {error}
 *   figcraft:event  editor → host  {name, data}             (Stories 2.3, 2.4, 2.11)
 *
 * A message is accepted only when `event.origin` is the host's own origin and `event.source` is
 * the editor iframe's window. Attach (`listen()`) before setting the iframe's `src`: ready is
 * posted once and never repeated. Bytes are never logged.
 */
import { EditorFailedError, EditorNotReadyError } from './errors';
import type { EditorEvent, ReadyInfo, SaveEvent, Unsubscribe } from './types';

/** The parts of the host `window` the channel uses. */
export interface HostWindowLike {
  addEventListener(type: 'message', cb: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', cb: (e: MessageEvent) => void): void;
  location: { origin: string };
}

/** The editor iframe's window, as a message target and `event.source`. */
export interface EditorWindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

export interface HostChannelOptions {
  hostWindow: HostWindowLike;
  /** The editor iframe's `contentWindow` (null before it exists). */
  editorWindow(): EditorWindowLike | null;
}

const report = (e: unknown) => {
  // A listener's error must not stop the others or the channel.
  if (typeof reportError === 'function') reportError(e);
  else console.error(e);
};

class Listeners<T extends unknown[]> {
  private readonly set = new Set<(...args: T) => unknown>();
  add(cb: (...args: T) => unknown): Unsubscribe {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  /** Call every listener; returns what they returned (promises included). */
  emit(...args: T): unknown[] {
    const out: unknown[] = [];
    for (const cb of [...this.set]) {
      try {
        out.push(cb(...args));
      } catch (e) {
        report(e);
      }
    }
    return out;
  }
  clear() {
    this.set.clear();
  }
}

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}

export class HostChannel {
  private readyInfo: ReadyInfo | null = null;
  private failure: string | null = null;
  private listening = false;
  private readonly readyListeners = new Listeners<[ReadyInfo]>();
  private readonly dirtyListeners = new Listeners<[boolean]>();
  private readonly saveListeners = new Listeners<[SaveEvent]>();
  private readonly failedListeners = new Listeners<[string]>();
  private readonly eventListeners = new Listeners<[EditorEvent]>();
  private readyWaiters: { resolve(i: ReadyInfo): void; reject(e: Error): void }[] = [];

  constructor(private readonly opts: HostChannelOptions) {}

  get origin(): string {
    return this.opts.hostWindow.location.origin;
  }
  get isReady(): boolean {
    return this.readyInfo !== null;
  }
  get info(): ReadyInfo | null {
    return this.readyInfo;
  }
  get failed(): string | null {
    return this.failure;
  }

  /** Start listening. Call before the iframe's `src` is set. */
  listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.opts.hostWindow.addEventListener('message', this.onMessage);
  }

  /** Stop listening and drop every listener. */
  close(): void {
    this.listening = false;
    this.opts.hostWindow.removeEventListener('message', this.onMessage);
    this.readyInfo = null;
    for (const l of [this.readyListeners, this.dirtyListeners, this.saveListeners]) l.clear();
    this.failedListeners.clear();
    this.eventListeners.clear();
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w.reject(new EditorNotReadyError('ready', 'the bridge was disposed'));
  }

  /** Forget the ready state before the iframe loads again (a new load posts ready again). */
  reset(): void {
    this.readyInfo = null;
    this.failure = null;
  }

  ready(): Promise<ReadyInfo> {
    if (this.readyInfo) return Promise.resolve(this.readyInfo);
    if (this.failure) return Promise.reject(new EditorFailedError(this.failure));
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
  }

  onReady(cb: (info: ReadyInfo) => void): Unsubscribe {
    const off = this.readyListeners.add(cb);
    const info = this.readyInfo;
    if (info) queueMicrotask(() => this.readyInfo === info && cb(info));
    return off;
  }
  onDirty(cb: (dirty: boolean) => void): Unsubscribe {
    return this.dirtyListeners.add(cb);
  }
  onSave(cb: (e: SaveEvent) => void | Promise<void>): Unsubscribe {
    return this.saveListeners.add(cb);
  }
  onFailed(cb: (error: string) => void): Unsubscribe {
    return this.failedListeners.add(cb);
  }
  onEvent(cb: (e: EditorEvent) => void): Unsubscribe {
    return this.eventListeners.add(cb);
  }

  /** Send a document. The bytes are copied (the copy is transferred), never detached. */
  open(name: string, bytes: Uint8Array | ArrayBuffer): void {
    const target = this.opts.editorWindow();
    if (!this.readyInfo || !target) throw new EditorNotReadyError('open');
    const copy =
      bytes instanceof ArrayBuffer
        ? bytes.slice(0)
        : (bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer);
    target.postMessage({ type: 'figcraft:open', name, bytes: copy }, this.origin, [copy]);
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (event.origin !== this.origin) return;
    const source = this.opts.editorWindow();
    if (!source || event.source !== (source as unknown)) return;
    const msg: unknown = event.data;
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Record<string, unknown>;
    switch (m.type) {
      case 'figcraft:ready': {
        if (this.readyInfo) return; // once per load
        const info: ReadyInfo = {
          version: typeof m.version === 'string' ? m.version : '',
          appVersion: typeof m.appVersion === 'string' ? m.appVersion : '',
        };
        this.readyInfo = info;
        this.failure = null;
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const w of waiters) w.resolve(info);
        this.readyListeners.emit(info);
        return;
      }
      case 'figcraft:event':
        if (typeof m.name === 'string') this.eventListeners.emit({ name: m.name, data: m.data });
        return;
      case 'figcraft:dirty':
        if (typeof m.dirty === 'boolean') this.dirtyListeners.emit(m.dirty);
        return;
      case 'figcraft:save': {
        const bytes = toBytes(m.bytes);
        if (typeof m.name !== 'string' || !bytes) return;
        const save: SaveEvent = { name: m.name, bytes, saveAs: m.saveAs === true };
        if (m.id !== undefined) save.id = m.id;
        const results = this.saveListeners.emit(save);
        if (m.id !== undefined) {
          // Acknowledge once every listener has stored it (the editor clears dirty then).
          Promise.all(results).then(
            () =>
              this.opts
                .editorWindow()
                ?.postMessage({ type: 'figcraft:saved', id: m.id }, this.origin),
            report,
          );
        } else {
          for (const r of results) if (r instanceof Promise) r.catch(report);
        }
        return;
      }
      case 'figcraft:failed': {
        const error = typeof m.error === 'string' ? m.error : 'unknown error';
        this.failure = error;
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const w of waiters) w.reject(new EditorFailedError(error));
        this.failedListeners.emit(error);
        return;
      }
    }
  };
}
