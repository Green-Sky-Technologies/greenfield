/**
 * The test host page's script (bundled by `server.ts`): embeds the editor with `createBridge` and
 * exposes it to Playwright as `window.__greenfieldBridge`. Events go to Node through the
 * `__greenfieldBridgeEvent` binding when the helper installed one.
 *
 * Query: `author`, `webgl` (force WebGL2), `gate`, `debounce`, `backstop` (detector ms).
 */
import { createBridge } from '../bridge';
import { bytesToBase64 } from '../png';
import type { ChangeDetectorOptions, Editor } from '../types';

declare global {
  interface Window {
    __greenfieldBridge?: { editor: Editor; iframe: HTMLIFrameElement };
    __greenfieldBridgeEvent?: (type: string, payload: unknown) => void;
  }
}

const q = new URLSearchParams(location.search);
const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
const iframe = document.getElementById('editor') as HTMLIFrameElement;
const changes: ChangeDetectorOptions = {
  gateIntervalMs: num('gate'),
  debounceMs: num('debounce'),
  backstopMs: num('backstop'),
  onError: (e) => send('error', String(e)),
};
const editor = createBridge({
  iframe,
  author: q.get('author') ?? 'Playwright',
  query: q.has('webgl') ? { webgl: true } : {},
  changes,
});

function send(type: string, payload: unknown) {
  window.__greenfieldBridgeEvent?.(type, payload);
}

editor.onReady((info) => send('ready', info));
editor.onDirty((dirty) => send('dirty', dirty));
editor.onFailed((error) => send('failed', error));
editor.onEvent((e) => send('event', e));
editor.onSave((e) =>
  send('save', { name: e.name, saveAs: e.saveAs, bytes: bytesToBase64(e.bytes), id: e.id }),
);

window.__greenfieldBridge = { editor, iframe };
