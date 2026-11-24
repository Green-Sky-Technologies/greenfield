/**
 * `createBridge`: the real editor in a same-origin iframe, as an `Editor`.
 *
 *   const editor = createBridge({ iframe, author: 'Ada' });
 *   editor.onSave(({ name, bytes, saveAs }) => upload(name, bytes, saveAs));
 *   await editor.ready();
 *   editor.open('Poster.figcraft', bytes);
 *   await editor.batch([{ command: 'node.create', as: 'card', params: { type: 'frame' } }, …]);
 */
import { ChangeDetector } from './change-detect';
import { ControlClient, type FigcraftApi } from './control';
import { HostChannel } from './host';
import { platformFromUserAgent } from './platform';
import type { ChangeDetectorOptions, Editor } from './types';

export interface BridgeOptions {
  /** The iframe to load the editor into. Its `src` is set by the bridge, after it listens. */
  iframe: HTMLIFrameElement;
  /** The user's name for comments and board notes (`?author=`). */
  author?: string;
  /** Same-origin URL of the editor's page. Default `/editor/index.html`. */
  editorUrl?: string;
  /** Extra query flags, e.g. `{ webgl: true }` to force WebGL2. */
  query?: Record<string, string | true>;
  /** Default deadline per control call (ms). Default 35 000. */
  timeoutMs?: number;
  /** Change detector tuning. */
  changes?: ChangeDetectorOptions;
}

/** The editor URL in host and control mode: `?host=parent&control&author=…`. */
export function editorSrc(
  editorUrl = '/editor/index.html',
  author?: string,
  query: Record<string, string | true> = {},
): string {
  const parts = ['host=parent', 'control'];
  if (author) parts.push(`author=${encodeURIComponent(author)}`);
  for (const [k, v] of Object.entries(query)) {
    parts.push(
      v === true ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
    );
  }
  return `${editorUrl}${editorUrl.includes('?') ? '&' : '?'}${parts.join('&')}`;
}

export function createBridge(opts: BridgeOptions): Editor {
  const { iframe } = opts;
  const hostWindow = iframe.ownerDocument.defaultView;
  if (!hostWindow) throw new Error('createBridge: the iframe is not in a window');
  const src = editorSrc(opts.editorUrl, opts.author, opts.query);
  if (new URL(src, hostWindow.location.href).origin !== hostWindow.location.origin) {
    // Host mode only talks to a same-origin parent, and window.figcraft needs same origin too.
    throw new Error('createBridge: the editor must be served from the host page’s origin');
  }
  let disposed = false;
  const host = new HostChannel({ hostWindow, editorWindow: () => iframe.contentWindow });
  const isHidden = () => hostWindow.document.visibilityState === 'hidden';
  const control = new ControlClient({
    api: () => {
      if (disposed) return 'the bridge was disposed';
      if (host.failed) return `the editor failed to start (${host.failed})`;
      if (!host.isReady) return 'the editor has not posted figcraft:ready yet';
      const f = (iframe.contentWindow as (Window & { figcraft?: FigcraftApi }) | null)?.figcraft;
      return f ?? 'window.figcraft is missing (the editor URL needs `control`)';
    },
    isHidden,
    platform: () => platformFromUserAgent(hostWindow.navigator.userAgent),
    timeoutMs: opts.timeoutMs,
    onMutation: () => detector.noteControlEdit(),
  });
  const detector = new ChangeDetector(
    {
      inspect: (o) => control.inspect(o),
      isHidden,
      onVisibilityChange: (cb) => {
        hostWindow.document.addEventListener('visibilitychange', cb);
        return () => hostWindow.document.removeEventListener('visibilitychange', cb);
      },
    },
    opts.changes,
  );

  // Listen first: figcraft:ready is posted once.
  host.listen();
  iframe.src = src;

  return {
    get isReady() {
      return !disposed && host.isReady;
    },
    ready: () => host.ready(),
    onReady: (cb) => host.onReady(cb),
    onDirty: (cb) => host.onDirty(cb),
    onSave: (cb) => host.onSave(cb),
    onFailed: (cb) => host.onFailed(cb),
    open: (name, bytes) => host.open(name, bytes),
    save: (o) => control.save(o),
    execute: (command, params, o) => control.execute(command, params, o),
    batch: (steps, o) => control.batch(steps, o),
    batchContinue: (steps, o) => control.batchContinue(steps, o),
    inspect: (o, c) => control.inspect(o, c),
    getNode: (id, o, c) => control.getNode(id, o, c),
    render: (o, c) => control.render(o, c),
    commands: (c) => control.commands(c),
    request: (method, params, o) => control.request(method, params, o),
    onChange: (cb) => detector.subscribe(cb),
    detectChanges: () => detector.detect(),
    dispose: () => {
      disposed = true;
      detector.stop();
      host.close();
    },
  };
}
