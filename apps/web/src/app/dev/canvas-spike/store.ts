/**
 * Story 5.0 spike: the editor state the throwaway panels read, and the three ways to keep it in
 * step with the canvas (`poll`, `pointer`, `events`). Throwaway: Story 5.6 builds the real store.
 */
import type { Editor, EditorEventMap } from '@greenfield/bridge';
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

function toSelected(raw: RawNode): SelectedNode {
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

/** A layer in the spike's copy of the page tree, patched from `document.changed`. */
interface TreeNode {
  id: number;
  name: string;
  type: string;
  visible: boolean;
  parent: number | null;
  children: number[];
}

/** The page tree as rows, front-most first. */
function rowsOf(tree: Map<number, TreeNode>, page: number): LayerRow[] {
  const rows: LayerRow[] = [];
  const walk = (id: number, depth: number) => {
    const n = tree.get(id);
    if (!n) return;
    rows.push({ id, name: n.name || String(id), type: n.type, depth, visible: n.visible });
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const c of [...(tree.get(page)?.children ?? [])].reverse()) walk(c, 0);
  return rows;
}

function treeOf(page: RawNode): Map<number, TreeNode> {
  const tree = new Map<number, TreeNode>();
  const add = (n: RawNode, parent: number | null) => {
    const kids = n.children ?? [];
    tree.set(n.id, {
      id: n.id,
      name: n.name ?? '',
      type: n.type ?? '',
      visible: n.visible !== false,
      parent,
      children: kids.map((c) => c.id),
    });
    for (const c of kids) add(c, n.id);
  };
  add(page, null);
  return tree;
}

/**
 * Apply a `document.changed` patch (the order the event documents: removed, take moved out,
 * insert added and moved by ascending index). False when it can't: the host reads the tree.
 */
function applyPatch(tree: Map<number, TreeNode>, d: EditorEventMap['document.changed']): boolean {
  const detach = (id: number) => {
    const n = tree.get(id);
    const p = n?.parent != null ? tree.get(n.parent) : undefined;
    if (p) p.children = p.children.filter((c) => c !== id);
  };
  const drop = (id: number) => {
    for (const c of tree.get(id)?.children ?? []) drop(c);
    tree.delete(id);
  };
  for (const r of d.removed) {
    detach(r.id);
    drop(r.id);
  }
  for (const m of d.moved) detach(m.id);
  const fields = new Map(d.nodes.map((n) => [n.id, n]));
  for (const a of d.added) {
    const n = fields.get(a.id);
    tree.set(a.id, {
      id: a.id,
      name: String(n?.name ?? ''),
      type: String(n?.type ?? ''),
      visible: n?.visible !== false,
      parent: a.parent,
      children: [],
    });
  }
  for (const place of [...d.added, ...d.moved].sort((x, y) => x.index - y.index)) {
    const parent = place.parent != null ? tree.get(place.parent) : undefined;
    const n = tree.get(place.id);
    if (!parent || !n) return false;
    n.parent = place.parent;
    parent.children.splice(place.index, 0, place.id);
  }
  for (const c of d.nodes) {
    const n = tree.get(c.id);
    if (!n) continue;
    if (typeof c.name === 'string') n.name = c.name;
    if ('visible' in c) n.visible = c.visible !== false;
  }
  return true;
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
  /** The page tree from the last read, patched by `document.changed` (events mode). */
  private tree: Map<number, TreeNode> | null = null;
  private treePage = 0;

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
    return raw ? toSelected(raw) : null;
  }

  private nodeGen = 0;

  /**
   * `selection.changed`: the layers list can highlight now. With the layers' fields in the event
   * (fork 2.3 payloads) the inspector has its numbers too; without, they take one read.
   */
  onSelectionEvent(ids: number[], nodes?: RawNode[]) {
    const gen = ++this.nodeGen;
    this.lastSelection = JSON.stringify(ids);
    const first = nodes?.[0];
    if (first) {
      this.store.set({ selection: ids, node: toSelected(first) });
      perf.log('state-set', { sel: ids[0] ?? null, via: 'payload' });
      return;
    }
    this.store.set({ selection: ids, node: ids.length ? this.store.current.node : null });
    perf.log('selection-set', { sel: ids[0] ?? null });
    if (!ids.length) return;
    void this.readNode(ids[0]!).then((node) => {
      if (gen !== this.nodeGen) return;
      this.store.set({ node });
      perf.log('state-set', { sel: ids[0] ?? null, via: 'event' });
    });
  }

  /**
   * `document.changed`: with a patch (fork 2.3 payloads), apply it to the selected layer and the
   * tree; without one, re-read them (each on its own track).
   */
  onDocumentEvent(d?: EditorEventMap['document.changed']) {
    if (d?.nodes && !d.resync && this.tree) {
      const node = this.store.current.node;
      const change = node && d.nodes.find((n) => n.id === node.id);
      if (change) {
        const { fills, ...rest } = change as RawNode;
        const fill = 'fills' in change ? firstFill(fills) : node.fill;
        this.store.set({ node: { ...node, ...(rest as Partial<SelectedNode>), fill } });
        perf.log('state-set', { sel: node.id, via: 'payload' });
      }
      if (applyPatch(this.tree, d)) {
        this.store.set({ layers: rowsOf(this.tree, this.treePage) });
        perf.log('tree', { ms: 0, rows: this.store.current.layers.length, via: 'payload' });
        return;
      }
    }
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
      const page = info.pages?.[0] as RawNode | undefined;
      const layers = flatten(page);
      this.tree = page ? treeOf(page) : null;
      this.treePage = page?.id ?? 0;
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
