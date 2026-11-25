/**
 * Story 5.0 spike: the editor state the throwaway panels read, and the three ways to keep it in
 * step with the canvas (`poll`, `pointer`, `events`). Throwaway: Story 5.6 builds the real store.
 */
import type { Editor } from '@greenfield/bridge';
import { perf } from './perf';

export type SyncMode = 'poll' | 'pointer' | 'events';

export interface LayerRow {
  id: number;
  name: string;
  type: string;
  depth: number;
  visible: boolean;
}

export interface SelectedNode {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** First solid fill as #rrggbb, or null. */
  fill: string | null;
}

export interface SpikeState {
  ready: boolean;
  layers: LayerRow[];
  selection: number[];
  node: SelectedNode | null;
  revision: string;
  agentActive: boolean;
  gestures: boolean;
  /** Last editor event of each kind, for the HUD. */
  eventsSeen: Record<string, number>;
  lastEvent: string;
  /** The last `spike.ping` event's send time, for the event-path floor measurement. */
  ping: number;
}

const initial: SpikeState = {
  ready: false,
  layers: [],
  selection: [],
  node: null,
  revision: '',
  agentActive: false,
  gestures: false,
  eventsSeen: {},
  lastEvent: '',
  ping: 0,
};

export class SpikeStore {
  private state = initial;
  /** True while a scrub is running: its previews don't ask for a read-back. */
  paused = false;
  /** Set by the page once the syncer exists: ask for a read now. */
  kick: () => void = () => {};
  private listeners = new Set<() => void>();
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = () => this.state;
  getServerSnapshot = () => initial;
  set(patch: Partial<SpikeState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  get current() {
    return this.state;
  }
}

const NODE_FIELDS = ['name', 'type', 'x', 'y', 'width', 'height', 'fills'] as const;

interface RawNode {
  id: number;
  name?: string;
  type?: string;
  visible?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fills?: unknown;
  children?: RawNode[];
}

const hex2 = (n: number) =>
  Math.round(Math.max(0, Math.min(1, n)) * 255)
    .toString(16)
    .padStart(2, '0');

/** The first visible solid fill as `#rrggbb`. Accepts `"#rrggbb"` strings and `{r,g,b}` paints. */
export function firstFill(fills: unknown): string | null {
  if (!Array.isArray(fills)) return null;
  for (const f of fills) {
    if (typeof f === 'string' && f.startsWith('#')) return f.slice(0, 7);
    if (f && typeof f === 'object') {
      const p = f as Record<string, unknown>;
      if (typeof p.color === 'string') return (p.color as string).slice(0, 7);
      const c = (p.color ?? p) as { r?: number; g?: number; b?: number };
      if (typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number') {
        return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
      }
    }
  }
  return null;
}

function flatten(page: RawNode | undefined): LayerRow[] {
  const rows: LayerRow[] = [];
  const walk = (n: RawNode, depth: number) => {
    rows.push({
      id: n.id,
      name: n.name ?? String(n.id),
      type: n.type ?? '',
      depth,
      visible: n.visible !== false,
    });
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  // Layers draw front-most first.
  for (const c of [...(page?.children ?? [])].reverse()) walk(c, 0);
  return rows;
}

export interface SyncOptions {
  mode: SyncMode;
  pollMs: number;
}

/**
 * Reads the editor and fills the store. One read cycle at a time; a request that arrives during
 * a cycle runs one more cycle after it (so the latest state always wins, with no queue).
 */
export class Syncer {
  private busy = false;
  private again = false;
  private disposed = false;
  private stops: Array<() => void> = [];
  private lastRevision = '';
  private lastSelection = '';
  private treeBusy = false;
  private treeAgain = false;

  constructor(
    private readonly editor: Editor,
    private readonly store: SpikeStore,
    private readonly opts: SyncOptions,
  ) {}

  /** Ask for a cycle; `why` goes in the perf log. */
  request(why: string) {
    if (this.disposed) return;
    perf.log('sync-request', { why });
    if (this.busy) {
      this.again = true;
      return;
    }
    void this.cycle(why);
  }

  private async cycle(why: string): Promise<void> {
    this.busy = true;
    try {
      const t0 = performance.now();
      const meta = await this.editor.inspect({ depth: 0, fields: [] });
      perf.log('gate', { ms: performance.now() - t0, why });
      const revision =
        typeof meta.revision === 'number'
          ? String(meta.revision)
          : JSON.stringify([meta.history, meta.currentPage, meta.dirty]);
      const selection = meta.selection ?? [];
      const selKey = JSON.stringify(selection);
      const revChanged = revision !== this.lastRevision;
      const selChanged = selKey !== this.lastSelection;
      this.lastRevision = revision;
      this.lastSelection = selKey;
      if (selChanged || revChanged) {
        // Selection and the node's numbers first: that's what the inspector shows.
        const node = selection.length > 0 ? await this.readNode(selection[0]!) : null;
        this.store.set({ selection, node, revision, ready: true });
        perf.log('state-set', { sel: selection[0] ?? null, rev: revision });
      }
      if (revChanged) void this.refreshTree();
    } catch (e) {
      perf.log('sync-error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.busy = false;
      if (this.again && !this.disposed) {
        this.again = false;
        void this.cycle('again');
      }
    }
  }

  /** The selected layer's numbers: one `node.get`. */
  private async readNode(id: number): Promise<SelectedNode | null> {
    const raw = (await this.editor.getNode(id, {
      depth: 0,
      fields: NODE_FIELDS as never,
    })) as RawNode | null;
    if (!raw) return null;
    return {
      id: raw.id,
      name: raw.name ?? '',
      type: raw.type ?? '',
      x: raw.x ?? 0,
      y: raw.y ?? 0,
      width: raw.width ?? 0,
      height: raw.height ?? 0,
      fill: firstFill(raw.fills),
    };
  }

  private nodeGen = 0;

  /** `selection.changed {ids}`: the layers list can highlight now; the numbers take one read. */
  onSelectionEvent(ids: number[]) {
    const gen = ++this.nodeGen;
    this.lastSelection = JSON.stringify(ids);
    this.store.set({ selection: ids, node: ids.length ? this.store.current.node : null });
    perf.log('selection-set', { sel: ids[0] ?? null });
    if (!ids.length) return;
    void this.readNode(ids[0]!).then((node) => {
      if (gen !== this.nodeGen) return;
      this.store.set({ node });
      perf.log('state-set', { sel: ids[0] ?? null, via: 'event' });
    });
  }

  /** `document.changed`: re-read the selected layer and the tree (each on its own track). */
  onDocumentEvent() {
    const gen = ++this.nodeGen;
    const sel = this.store.current.selection[0];
    if (sel !== undefined) {
      void this.readNode(sel).then((node) => {
        if (gen !== this.nodeGen) return;
        this.store.set({ node });
        perf.log('state-set', { sel, via: 'event' });
      });
    }
    void this.refreshTree();
  }

  /** The layers tree, on its own track: a big document must not hold up the inspector. */
  private async refreshTree(): Promise<void> {
    if (this.treeBusy) {
      this.treeAgain = true;
      return;
    }
    this.treeBusy = true;
    try {
      const t0 = performance.now();
      const info = await this.editor.inspect({ outline: true, depth: 12 });
      const layers = flatten(info.pages?.[0] as RawNode | undefined);
      perf.log('tree', { ms: performance.now() - t0, rows: layers.length });
      this.store.set({ layers });
    } catch (e) {
      perf.log('sync-error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.treeBusy = false;
      if (this.treeAgain && !this.disposed) {
        this.treeAgain = false;
        void this.refreshTree();
      }
    }
  }

  /** Start listening, per mode. `iframe` is the editor's frame (same origin). */
  start(iframe: HTMLIFrameElement) {
    const win = iframe.contentWindow!;
    const doc = win.document;
    const { mode, pollMs } = this.opts;
    // `pointer` mode: any input in the editor is a hint that something may have changed; read
    // on the frame after it. `poll` mode: a timer. Both keep a slow backstop.
    if (mode === 'poll') {
      const id = setInterval(() => this.request('poll'), pollMs);
      this.stops.push(() => clearInterval(id));
    } else {
      const id = setInterval(() => this.request('backstop'), mode === 'events' ? 5000 : 400);
      this.stops.push(() => clearInterval(id));
    }
    if (mode === 'pointer') {
      const hint = (e: Event) => {
        if (e.type === 'pointermove' && !(e as PointerEvent).buttons) return;
        // Wait for the editor's own frame to take the input, then read.
        requestAnimationFrame(() => setTimeout(() => this.request(e.type), 0));
      };
      for (const t of ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup']) {
        doc.addEventListener(t, hint, true);
        this.stops.push(() => doc.removeEventListener(t, hint, true));
      }
    }
    this.request('start');
  }

  dispose() {
    this.disposed = true;
    for (const s of this.stops) s();
    this.stops = [];
  }
}
