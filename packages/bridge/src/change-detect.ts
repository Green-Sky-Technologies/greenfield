/**
 * Change detection without editor events (Story 0.4 (b); replaced by host events in Story 2.3).
 *
 * Two tiers over `document.inspect`:
 * 1. **Gate**, every `gateIntervalMs` (400 ms): `{depth: 0, fields: []}`, about 17 ms and under
 *    0.5 KiB at any document size. Its key is the document id, current page, undo history and each
 *    page's child count. Selection and dirty changes are reported from the gate alone.
 * 2. **Full diff** of the current page with `fields` (`DIFF_FIELDS`), flattened to
 *    `id → record` and compared with the last snapshot. Runs `debounceMs` after the gate changes
 *    (so a drag gives one diff), on demand (`detect()`, before each agent turn), and as a backstop
 *    every `backstopMs` for the gate's blind spots (an undo then an edit with the same label;
 *    more than 20 same-label steps).
 *
 * Polling stops while the tab is hidden (calls would hang anyway) and resumes when it is shown.
 * Only the current page is diffed; a page switch resets the snapshot.
 */
import { BridgeError } from './errors';
import type { NodeField } from './generated/commands';
import type {
  ChangeDetectorOptions,
  ChangeSet,
  DocumentInfo,
  EditorNode,
  InspectOptions,
  NodeId,
  Unsubscribe,
} from './types';

/** Layer fields diffed by default: geometry, style, text and structure. */
export const DIFF_FIELDS = [
  'name',
  'type',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'visible',
  'locked',
  'opacity',
  'fills',
  'strokes',
  'strokeWeight',
  'effects',
  'cornerRadius',
  'characters',
] as const satisfies readonly NodeField[];

/** A flattened layer: its fields plus `parent` and `children` (child ids). */
export type NodeRecord = Record<string, unknown> & { id: NodeId };

/** Flatten a page's tree into `id → record` (children replaced by ids, `parent` added). */
export function flatten(page: { children?: EditorNode[] } | undefined): Map<NodeId, NodeRecord> {
  const out = new Map<NodeId, NodeRecord>();
  const walk = (n: EditorNode, parent: NodeId | null) => {
    const { children, ...rest } = n;
    out.set(n.id, { ...rest, parent, children: children?.map((c) => c.id) ?? [] });
    for (const c of children ?? []) walk(c, n.id);
  };
  for (const c of page?.children ?? []) walk(c, null);
  return out;
}

const same = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

/** Added, removed and changed layers between two snapshots. */
export function diffSnapshots(
  prev: Map<NodeId, NodeRecord>,
  next: Map<NodeId, NodeRecord>,
): Pick<ChangeSet, 'added' | 'removed' | 'changed'> {
  const added: NodeId[] = [];
  const removed: NodeId[] = [];
  const changed: { id: NodeId; fields: string[] }[] = [];
  for (const [id, n] of next) {
    const p = prev.get(id);
    if (!p) {
      added.push(id);
      continue;
    }
    const fields = [...new Set([...Object.keys(p), ...Object.keys(n)])].filter(
      (k) => !same(p[k], n[k]),
    );
    if (fields.length) changed.push({ id, fields });
  }
  for (const id of prev.keys()) if (!next.has(id)) removed.push(id);
  return { added, removed, changed };
}

type Meta = Pick<DocumentInfo, 'id' | 'currentPage' | 'selection' | 'history' | 'dirty' | 'pages'>;

/** The same key from a gate reply (pages carry `childCount`) and a full one (`children`). */
const gateKey = (m: Meta) =>
  JSON.stringify([
    m.id,
    m.currentPage,
    m.history,
    m.pages?.map((p) => [p.id, p.childCount ?? p.children?.length ?? 0]),
  ]);

export interface DetectorDeps {
  inspect(opts: InspectOptions): Promise<DocumentInfo>;
  isHidden(): boolean;
  /** Subscribe to visibility changes (to pause and resume polling). */
  onVisibilityChange?(cb: () => void): Unsubscribe;
}

const emptyMeta = (): ChangeSet['meta'] => ({
  selection: false,
  page: false,
  history: false,
  dirty: false,
  document: false,
});

export class ChangeDetector {
  private readonly listeners = new Set<(c: ChangeSet) => void>();
  private readonly gateIntervalMs: number;
  private readonly debounceMs: number;
  private readonly backstopMs: number;
  private readonly fields: readonly NodeField[];
  private snapshot: Map<NodeId, NodeRecord> | null = null;
  private lastMeta: Meta | null = null;
  private lastGate = '';
  private historyAtFull = '';
  private lastFullAt = 0;
  private controlEdits = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private gateTimer: ReturnType<typeof setTimeout> | undefined;
  private fullTimer: ReturnType<typeof setTimeout> | undefined;
  private unwatch: Unsubscribe | undefined;
  private running = false;

  constructor(
    private readonly deps: DetectorDeps,
    private readonly opts: ChangeDetectorOptions = {},
  ) {
    this.gateIntervalMs = opts.gateIntervalMs ?? 400;
    this.debounceMs = opts.debounceMs ?? 300;
    this.backstopMs = opts.backstopMs ?? 7500;
    this.fields = opts.fields ?? DIFF_FIELDS;
  }

  /** The bridge ran a mutating call (`execute`/`batch`); reported with the next diff. */
  noteControlEdit(): void {
    this.controlEdits++;
  }

  subscribe(cb: (c: ChangeSet) => void): Unsubscribe {
    this.listeners.add(cb);
    if (!this.running) this.start();
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** Run the full diff now (waits for a poll in flight). Errors propagate (hidden, not ready). */
  detect(): Promise<ChangeSet | null> {
    return this.serial(() => this.full());
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.gateTimer);
    clearTimeout(this.fullTimer);
    this.unwatch?.();
    this.unwatch = undefined;
  }

  private start(): void {
    this.running = true;
    this.unwatch = this.deps.onVisibilityChange?.(() => {
      if (!this.running) return;
      clearTimeout(this.gateTimer);
      clearTimeout(this.fullTimer);
      if (!this.deps.isHidden()) this.schedule(0); // resume at once
    });
    this.schedule(0);
  }

  private schedule(ms: number): void {
    clearTimeout(this.gateTimer);
    if (!this.running || this.deps.isHidden()) return; // paused until visible again
    this.gateTimer = setTimeout(() => {
      void this.serial(() => this.gate())
        .catch((e) => this.report(e))
        .finally(() => this.schedule(this.gateIntervalMs));
    }, ms);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private report(e: unknown): void {
    // Hidden, not ready and no document just skip a tick; anything else goes to onError.
    const skip = ['hidden', 'not_ready', 'no_document'];
    if (e instanceof BridgeError && skip.includes(e.code)) return;
    this.opts.onError?.(e);
  }

  private emit(c: ChangeSet): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(c);
      } catch (e) {
        this.opts.onError?.(e);
      }
    }
  }

  /** Tier 1. */
  private async gate(): Promise<void> {
    const meta = await this.deps.inspect({ depth: 0, fields: [] });
    const prev = this.lastMeta;
    const key = gateKey(meta);
    if (!prev || !this.snapshot || prev.id !== meta.id || prev.currentPage !== meta.currentPage) {
      await this.full();
      return;
    }
    if (key !== this.lastGate) {
      // Debounced: a drag changes the gate on every tick but yields one diff. The full diff
      // compares selection and dirty against `lastMeta`, so leave that alone until then.
      this.lastGate = key;
      clearTimeout(this.fullTimer);
      this.fullTimer = setTimeout(() => {
        void this.serial(() => this.full()).catch((e) => this.report(e));
      }, this.debounceMs);
      return;
    }
    if (performance.now() - this.lastFullAt >= this.backstopMs) {
      await this.full();
      return;
    }
    const selection = !same(prev.selection, meta.selection);
    const dirty = prev.dirty !== meta.dirty;
    this.lastMeta = meta;
    if (selection || dirty) {
      this.emit({
        added: [],
        removed: [],
        changed: [],
        meta: { ...emptyMeta(), selection, dirty },
        controlEdits: this.controlEdits,
      });
    }
  }

  /** Tier 2. Returns the change since the last snapshot (null: nothing, or a new baseline). */
  private async full(): Promise<ChangeSet | null> {
    clearTimeout(this.fullTimer);
    const doc = await this.deps.inspect({ depth: 64, fields: this.fields });
    const page = doc.pages.find((p) => p.id === doc.currentPage) ?? doc.pages[0];
    const next = flatten(page);
    const prev = this.lastMeta;
    const history = JSON.stringify(doc.history);
    this.lastMeta = doc;
    this.lastGate = gateKey(doc);
    this.lastFullAt = performance.now();
    const base = this.snapshot;
    this.snapshot = next;
    const lastHistory = this.historyAtFull;
    this.historyAtFull = history;
    if (!base || !prev) {
      this.controlEdits = 0;
      return null; // first snapshot: the baseline
    }
    const meta = emptyMeta();
    if (prev.id !== doc.id || prev.currentPage !== doc.currentPage) {
      meta.document = prev.id !== doc.id;
      meta.page = prev.currentPage !== doc.currentPage;
      const c: ChangeSet = { added: [], removed: [], changed: [], meta, controlEdits: 0 };
      this.controlEdits = 0;
      this.emit(c);
      return c;
    }
    const d = diffSnapshots(base, next);
    meta.history = history !== lastHistory;
    meta.selection = !same(prev.selection, doc.selection);
    meta.dirty = prev.dirty !== doc.dirty;
    const any = d.added.length + d.removed.length + d.changed.length > 0;
    if (!any && !meta.history && !meta.selection && !meta.dirty) return null;
    const c: ChangeSet = { ...d, meta, controlEdits: this.controlEdits };
    this.controlEdits = 0;
    this.emit(c);
    return c;
  }
}
