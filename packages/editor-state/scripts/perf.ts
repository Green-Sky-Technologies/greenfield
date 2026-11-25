/**
 * Store update + row-model update on a 30,000-layer page (Story 5.6 AC):
 *
 *   pnpm --filter @greenfield/editor-state perf [--layers 30000] [--runs 300]
 *
 * Times `EditorStore.dispatch` of a `document.changed` with payloads (what the editor will send)
 * plus the layers list's row model (`visibleRows`, a few frames collapsed), per kind of edit, and
 * the full build a re-read would cost on our side (`treeFromLayers`) as the baseline. Prints
 * p50 / p95 / max in ms. The same function runs in the browser from the e2e perf spec.
 */
import { EditorStore, visibleRows, type RawNode } from '../src';

export interface PerfResult {
  layers: number;
  runs: number;
  /** ms: [p50, p95, max] */
  [kind: string]: number | [number, number, number];
}

/** `frames` frames of `perFrame` layers, every tenth a group of 5: about frames × perFrame. */
export function generateLayers(total: number): RawNode[] {
  let id = 10;
  const frames: RawNode[] = [];
  const perFrame = 100;
  while (id < total) {
    const children: RawNode[] = [];
    for (let i = 0; i < perFrame - 1 && id < total; i++) {
      if (i % 10 === 0) {
        const groupId = ++id;
        const inner = Array.from({ length: 4 }, () => ({ id: ++id, name: 'Icon', type: 'VECTOR' }));
        children.push({ id: groupId, name: 'Group', type: 'GROUP', children: inner });
      } else children.push({ id: ++id, name: `Card ${id}`, type: 'RECTANGLE' });
    }
    frames.push({ id: ++id, name: `Frame ${frames.length}`, type: 'FRAME', children });
  }
  return frames;
}

const stats = (xs: number[]): [number, number, number] => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) =>
    Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]! * 1000) / 1000;
  return [at(0.5), at(0.95), Math.round(s.at(-1)! * 1000) / 1000];
};

export function measure(layers: number, runs: number): PerfResult {
  const raw = generateLayers(layers);
  const store = new EditorStore();
  store.dispatch({
    type: 'document.loaded',
    document: { id: 1, revision: 0, undoDepth: 0, dirty: false },
    pages: [{ id: 1, name: 'Page 1', current: true }],
    layers: raw,
    selection: [],
  });
  const count = store.getState().tree.nodes.size;
  const frames = store.getState().tree.roots;
  const collapsed = new Set(frames.slice(0, Math.floor(frames.length / 2)));
  let rev = 0;
  let nextId = 10_000_000;
  const time = (patch: object) => {
    const t0 = performance.now();
    store.dispatch({
      type: 'document.changed',
      document: 1,
      revision: ++rev,
      undoDepth: rev,
      ...patch,
    });
    visibleRows(store.getState().tree.rows, collapsed);
    return performance.now() - t0;
  };
  const pick = () => {
    const rows = store.getState().tree.rows;
    return rows[Math.floor(Math.random() * rows.length)]!.id;
  };
  const kinds: Record<string, () => object> = {
    rename: () => ({ nodes: [{ id: pick(), name: `Renamed ${rev}` }] }),
    move: () => ({ nodes: [{ id: pick(), x: rev }] }),
    add: () => {
      const id = ++nextId;
      return {
        added: [{ id, parent: frames[0]!, index: 0 }],
        nodes: [{ id, name: 'New', type: 'RECTANGLE' }],
      };
    },
    remove: () => {
      const id = pick();
      return { removed: [{ id, parent: store.getState().tree.nodes.get(id)!.parent, index: 0 }] };
    },
    reorder: () => {
      const f = store.getState().tree.nodes.get(frames[1]!)!;
      return { moved: [{ id: f.children[0]!, parent: f.id, index: f.children.length - 1 }] };
    },
  };
  const out: PerfResult = { layers: count, runs };
  for (const [kind, make] of Object.entries(kinds)) {
    for (let i = 0; i < 20; i++) time(make()); // warm up
    out[kind] = stats(Array.from({ length: runs }, () => time(make())));
  }
  const full: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    store.dispatch({
      type: 'document.loaded',
      document: { id: 1, revision: 0, undoDepth: 0, dirty: false },
      pages: [{ id: 1, name: 'Page 1', current: true }],
      layers: raw,
      selection: [],
    });
    full.push(performance.now() - t0);
  }
  out['full build (baseline)'] = stats(full);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string, d: number) => {
    const i = process.argv.indexOf(`--${k}`);
    return i >= 0 ? Number(process.argv[i + 1]) : d;
  };
  console.log(JSON.stringify(measure(arg('layers', 30_000), arg('runs', 300)), null, 1));
}
