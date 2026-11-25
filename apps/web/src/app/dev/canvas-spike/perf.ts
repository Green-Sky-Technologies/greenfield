/**
 * Story 5.0 spike: timestamps for the three latencies. Everything is read from one clock, the
 * host page's `performance.now()` (the iframe has its own time origin, so its listeners are
 * registered from here and only ever call this module's clock).
 *
 * The log is a plain array on `window.__spikePerf` that the measure script (spikes/5.0-canvas-spike)
 * reads and clears between trials.
 */
export interface PerfEvent {
  t: number;
  kind: string;
  [k: string]: unknown;
}

declare global {
  interface Window {
    __spikePerf?: { log: PerfEvent[]; clear(): void };
  }
}

const MAX = 20_000;

class PerfLog {
  log: PerfEvent[] = [];
  clear() {
    this.log.length = 0;
  }
  push(kind: string, data: Record<string, unknown> = {}) {
    if (this.log.length > MAX) this.log.splice(0, MAX / 2);
    this.log.push({ t: performance.now(), kind, ...data });
  }
}

const store = new PerfLog();
if (typeof window !== 'undefined') {
  window.__spikePerf = { log: store.log, clear: () => store.clear() };
}

export const perf = {
  log: (kind: string, data?: Record<string, unknown>) => store.push(kind, data),
};

/** Run `cb` after the next paint: a `requestAnimationFrame`, then a task after that frame. */
export function afterPaint(cb: () => void) {
  requestAnimationFrame(() => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      cb();
    };
    ch.port2.postMessage(null);
  });
}

/**
 * Wrap the editor's `requestAnimationFrame` so every editor frame logs its start and end. The
 * end of the first frame after an input is when the canvas has drawn the response (the wasm
 * draws inside its callback; the browser presents right after).
 */
export function watchEditorFrames(win: Window) {
  const orig = win.requestAnimationFrame.bind(win);
  const patched = (cb: FrameRequestCallback) =>
    orig((ts) => {
      const start = performance.now();
      try {
        cb(ts);
      } finally {
        store.push('frame', { start, end: performance.now() });
      }
    });
  win.requestAnimationFrame = patched;
}

/** Log the editor's inputs (capture phase, before the editor sees them). */
export function watchEditorInput(doc: Document) {
  for (const type of ['pointerdown', 'pointerup', 'keydown']) {
    doc.addEventListener(type, () => store.push('input', { type }), true);
  }
}
