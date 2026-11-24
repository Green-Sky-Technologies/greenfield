// Story 0.4 (b): change detection without host events — a prototype for packages/bridge.
//
// Runs in the host page (or anywhere `window.figcraft` of the editor frame is reachable). Two tiers:
//
//  1. Gate: `document.inspect {depth: 0, fields: []}` — metadata only (dirty, selection, history
//     labels + redo count, page ids and childCount). Cost is ~constant in document size. Its
//     fingerprint changes on (nearly) every edit; see `gateKey` for the known blind spots.
//  2. Full: `document.inspect {depth: 64, fields: FIELDS}` on the current page, flattened into a
//     Map<id, Record> and diffed against the previous snapshot -> {added, removed, changed}.
//
// The full tier runs when the gate changes, and also every `fullEveryMs` as a backstop for the
// gate's blind spots (an undo followed by an edit with the same label, or more than 20 same-label
// steps, leave the 20 visible labels and the redo count unchanged).
//
// The file is plain TS with no imports so it can be pasted into packages/bridge later. The spike's
// measuring harness (measure-change.mjs) inlines an equivalent JS copy into the page.

export interface FigcraftApi {
  request(method: string, params?: unknown): Promise<unknown>;
  docInspect(params?: unknown): Promise<unknown>;
}

export type NodeRecord = Record<string, unknown> & { id: number };

export interface ChangeSet {
  added: number[];
  removed: number[];
  changed: { id: number; fields: string[] }[];
  /** Selection, page or history changed (no node changed necessarily). */
  meta: { selection: boolean; page: boolean; history: boolean; dirty: boolean };
}

export interface PollStats {
  gateMs: number;
  gateBytes: number;
  fullMs?: number;
  fullBytes?: number;
  diffMs?: number;
  nodes?: number;
}

/** Layer fields worth diffing for "what did the person change". Geometry, style, text, structure. */
export const FIELDS = [
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
] as const;

interface Meta {
  id?: number;
  dirty?: boolean;
  currentPage?: number;
  selection?: number[];
  history?: { undo: string[]; redo: number };
  pages?: { id: number; childCount?: number; children?: unknown[] }[];
}

function gateKey(m: Meta): string {
  // Everything here is cheap to produce in the engine (no tree walk below depth 0).
  return JSON.stringify([m.id, m.currentPage, m.history, m.pages?.map((p) => [p.id, p.childCount])]);
}

/** Flatten the current page's tree into id -> record (children replaced by child ids, parent added). */
export function flatten(page: { children?: unknown[] }): Map<number, NodeRecord> {
  const out = new Map<number, NodeRecord>();
  const walk = (n: NodeRecord & { children?: NodeRecord[] }, parent: number | null) => {
    const { children, ...rest } = n;
    const rec: NodeRecord = { ...rest, parent, kids: children?.map((c) => c.id) ?? [] };
    out.set(n.id, rec);
    for (const c of children ?? []) walk(c, n.id);
  };
  for (const c of (page.children ?? []) as (NodeRecord & { children?: NodeRecord[] })[]) walk(c, null);
  return out;
}

export function diff(prev: Map<number, NodeRecord>, next: Map<number, NodeRecord>): Pick<ChangeSet, 'added' | 'removed' | 'changed'> {
  const added: number[] = [];
  const removed: number[] = [];
  const changed: { id: number; fields: string[] }[] = [];
  for (const [id, n] of next) {
    const p = prev.get(id);
    if (!p) {
      added.push(id);
      continue;
    }
    const fields: string[] = [];
    const keys = new Set([...Object.keys(p), ...Object.keys(n)]);
    for (const k of keys) {
      const a = p[k];
      const b = n[k];
      if (a === b) continue;
      if (typeof a === 'object' || typeof b === 'object') {
        if (JSON.stringify(a) === JSON.stringify(b)) continue;
      }
      fields.push(k);
    }
    if (fields.length) changed.push({ id, fields });
  }
  for (const id of prev.keys()) if (!next.has(id)) removed.push(id);
  return { added, removed, changed };
}

export class ChangeDetector {
  private lastGate = '';
  private lastMeta: Meta = {};
  private snapshot = new Map<number, NodeRecord>();
  private lastFull = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;

  constructor(
    private api: FigcraftApi,
    private onChange: (c: ChangeSet, s: PollStats) => void,
    private opts: { intervalMs?: number; fullEveryMs?: number; fields?: readonly string[] } = {},
  ) {}

  private running = false;

  start() {
    this.running = true;
    const tick = async () => {
      await this.poll().catch(() => undefined);
      // stop() may have run while the poll was in flight.
      if (this.running) this.timer = setTimeout(tick, this.opts.intervalMs ?? 500);
    };
    void tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  /** One poll. Returns the change set (or null when nothing changed) and its cost. */
  async poll(force = false): Promise<{ change: ChangeSet | null; stats: PollStats }> {
    if (this.busy) return { change: null, stats: { gateMs: 0, gateBytes: 0 } };
    this.busy = true;
    try {
      const t0 = performance.now();
      const meta = (await this.api.docInspect({ depth: 0, fields: [] })) as Meta;
      const stats: PollStats = { gateMs: performance.now() - t0, gateBytes: JSON.stringify(meta).length };
      const key = gateKey(meta);
      const backstop = performance.now() - this.lastFull > (this.opts.fullEveryMs ?? 5000);
      const metaChange = {
        selection: JSON.stringify(meta.selection) !== JSON.stringify(this.lastMeta.selection),
        page: meta.currentPage !== this.lastMeta.currentPage,
        history: JSON.stringify(meta.history) !== JSON.stringify(this.lastMeta.history),
        dirty: meta.dirty !== this.lastMeta.dirty,
      };
      this.lastMeta = meta;
      if (!force && key === this.lastGate && !backstop) {
        const any = metaChange.selection || metaChange.dirty;
        return { change: any ? { added: [], removed: [], changed: [], meta: metaChange } : null, stats };
      }
      this.lastGate = key;
      const t1 = performance.now();
      const full = (await this.api.docInspect({ depth: 64, fields: this.opts.fields ?? FIELDS })) as Meta & {
        pages: { id: number; children?: unknown[] }[];
      };
      stats.fullMs = performance.now() - t1;
      stats.fullBytes = JSON.stringify(full).length;
      const page = full.pages.find((p) => p.id === full.currentPage) ?? full.pages[0];
      const t2 = performance.now();
      const next = flatten(page ?? {});
      const d = diff(this.snapshot, next);
      stats.diffMs = performance.now() - t2;
      stats.nodes = next.size;
      this.snapshot = next;
      this.lastFull = performance.now();
      const nodeChange = d.added.length + d.removed.length + d.changed.length > 0;
      const change = nodeChange || metaChange.selection || metaChange.dirty || metaChange.history ? { ...d, meta: metaChange } : null;
      if (change) this.onChange(change, stats);
      return { change, stats };
    } finally {
      this.busy = false;
    }
  }
}
