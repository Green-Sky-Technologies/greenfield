import { describe, expect, it } from 'vitest';
import {
  diffTrees,
  INITIAL_STATE,
  patchTree,
  reduce,
  treeFromLayers,
  visibleRows,
  type EditorState,
  type NodeFields,
  type PageTree,
  type RawNode,
  type TreePatch,
} from '../src';

/** A small seeded PRNG, so a failure reproduces. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const snapshot = (t: PageTree) =>
  t.rows.map(({ id, depth }) => {
    const n = t.nodes.get(id)!;
    return [id, depth, n.parent, n.name, n.type, n.visible, n.locked];
  });

/** Random edits a person or Claude could make: add, delete, move across parents, rename, wrap. */
function mutate(layers: RawNode[], rand: () => number, nextId: () => number): RawNode[] {
  const copy = structuredClone(layers);
  const all: { node: RawNode; siblings: RawNode[] }[] = [];
  const walk = (list: RawNode[]) => {
    for (const n of list) {
      all.push({ node: n, siblings: list });
      walk((n.children ??= []));
    }
  };
  walk(copy);
  const pick = () => all[Math.floor(rand() * all.length)];
  const lists = () => [copy, ...all.map((a) => a.node.children!)];
  for (let k = 0; k < 1 + Math.floor(rand() * 4); k++) {
    const r = rand();
    const target = pick();
    if (r < 0.25 || !target) {
      const list = lists()[Math.floor(rand() * lists().length)]!;
      list.splice(Math.floor(rand() * (list.length + 1)), 0, {
        id: nextId(),
        name: 'New',
        type: rand() < 0.5 ? 'FRAME' : 'INSTANCE',
        children: [],
      });
    } else if (r < 0.4) {
      target.siblings.splice(target.siblings.indexOf(target.node), 1);
      all.length = 0;
      walk(copy);
    } else if (r < 0.65) {
      // Move it somewhere that isn't inside itself.
      const inside = new Set<RawNode>();
      const mark = (n: RawNode) => (inside.add(n), n.children?.forEach(mark));
      mark(target.node);
      const dests = lists().filter(
        (l) => !all.some((a) => inside.has(a.node) && a.node.children === l),
      );
      const dest = dests[Math.floor(rand() * dests.length)]!;
      target.siblings.splice(target.siblings.indexOf(target.node), 1);
      dest.splice(Math.floor(rand() * (dest.length + 1)), 0, target.node);
      all.length = 0;
      walk(copy);
    } else if (r < 0.85) {
      target.node.name = `Renamed ${Math.floor(rand() * 100)}`;
      target.node.visible = rand() < 0.5;
      target.node.locked = rand() < 0.5;
    } else {
      // Group: wrap it in a new frame where it was.
      const i = target.siblings.indexOf(target.node);
      target.siblings.splice(i, 1, {
        id: nextId(),
        name: 'Group',
        type: 'GROUP',
        children: [target.node],
      });
      all.length = 0;
      walk(copy);
    }
  }
  return copy;
}

const PAGE = 999;
const page = (layers: RawNode[]) => treeFromLayers(PAGE, layers);

/**
 * The patch as the fork builds it (`host_sync.rs`, `Patch::between`): every removed and added
 * layer, and the fewest moves (children off a longest run kept in order, plus parent changes).
 */
function forkPatch(from: PageTree, to: PageTree): TreePatch {
  const where = (t: PageTree, id: number) => {
    const parent = t.nodes.get(id)!.parent;
    const sibs = parent === PAGE ? t.roots : t.nodes.get(parent)!.children;
    return { id, parent, index: sibs.indexOf(id) };
  };
  const removed = [...from.nodes.keys()]
    .filter((id) => !to.nodes.has(id))
    .map((id) => where(from, id));
  const added = [...to.nodes.keys()].filter((id) => !from.nodes.has(id)).map((id) => where(to, id));
  const nodes: NodeFields[] = added.map(({ id }) => ({ ...to.nodes.get(id)! }));
  const moved = new Set<number>();
  const reordered = (old: readonly number[], now: readonly number[]) => {
    const kept = now.filter((id) => old.includes(id));
    // Longest run of kept children still in their old order; the rest move.
    const pos = kept.map((id) => old.indexOf(id));
    const best: number[][] = [];
    pos.forEach((p, i) => {
      let run = [i];
      for (let j = 0; j < i; j++)
        if (pos[j]! < p && best[j]!.length + 1 > run.length) run = [...best[j]!, i];
      best.push(run);
    });
    const keep = new Set(best.reduce((a, b) => (b.length > a.length ? b : a), [] as number[]));
    kept.forEach((id, i) => keep.has(i) || moved.add(id));
  };
  reordered(from.roots, to.roots);
  for (const [id, n] of to.nodes) {
    const old = from.nodes.get(id);
    if (!old) continue;
    if (old.parent !== n.parent) moved.add(id);
    reordered(old.children, n.children);
    const diff = Object.fromEntries(
      (['name', 'type', 'visible', 'locked'] as const)
        .filter((k) => old[k] !== n[k])
        .map((k) => [k, n[k]]),
    );
    if (Object.keys(diff).length) nodes.push({ id, ...diff });
  }
  return { nodes, added, removed, moved: [...moved].map((id) => where(to, id)) };
}

describe('patchTree', () => {
  for (const [name, patchOf] of [
    ['diffTrees (the ids-only adapter)', diffTrees],
    ['the fork’s own patches', forkPatch],
  ] as const)
    it(`gives the same tree as a full read over 2,000 random edits: ${name}`, () => {
      const rand = rng(7);
      let id = 100;
      let layers: RawNode[] = [
        { id: 2, name: 'Home', type: 'FRAME', children: [{ id: 3, name: 'Nav', type: 'FRAME' }] },
        { id: 4, name: 'Pricing', type: 'FRAME' },
      ];
      let tree = page(layers);
      for (let i = 0; i < 2000; i++) {
        layers = mutate(layers, rand, () => ++id);
        const full = page(layers);
        tree = patchTree(tree, patchOf(tree, full));
        expect(snapshot(tree), `edit ${i}`).toEqual(snapshot(full));
      }
    });

  const tree = page([
    { id: 1, name: 'Card', type: 'FRAME', children: [{ id: 2, name: 'Title', type: 'TEXT' }] },
    { id: 3, name: 'Button', type: 'INSTANCE' },
  ]);

  it('lists rows front-most first, depth-first, with component marks', () => {
    expect(tree.rows).toEqual([
      { id: 3, depth: 0 },
      { id: 1, depth: 0 },
      { id: 2, depth: 1 },
    ]);
    expect(tree.nodes.get(3)!.component).toBe('instance');
  });

  it('keeps the rows (and the tree) when only fields change, or nothing does', () => {
    const renamed = patchTree(tree, { nodes: [{ id: 2, name: 'Headline' }] });
    expect(renamed.rows).toBe(tree.rows);
    expect(renamed.nodes.get(2)!.name).toBe('Headline');
    expect(renamed.nodes.get(1)).toBe(tree.nodes.get(1));
    expect(patchTree(tree, { nodes: [{ id: 2, x: 40 }] })).toBe(tree);
    expect(patchTree(tree, { nodes: [{ id: 2, name: 'Title' }] })).toBe(tree);
  });

  it('reads a null field as one the layer no longer has', () => {
    const hidden = patchTree(tree, { nodes: [{ id: 3, visible: false, locked: true }] });
    const back = patchTree(hidden, { nodes: [{ id: 3, visible: null, locked: null }] });
    expect(back.nodes.get(3)).toMatchObject({ visible: true, locked: false });
  });

  it('never changes the tree it was given', () => {
    const before = snapshot(tree);
    patchTree(tree, {
      removed: [{ id: 1, parent: PAGE, index: 0 }],
      added: [{ id: 9, parent: PAGE, index: 0 }],
      nodes: [{ id: 9, name: 'X' }],
    });
    expect(snapshot(tree)).toEqual(before);
  });

  it('leaves out layers added on another page', () => {
    const next = patchTree(tree, { added: [{ id: 9, parent: 77, index: 0 }] });
    expect(next.nodes.has(9)).toBe(false);
  });
});

describe('visibleRows', () => {
  it('hides a collapsed layer’s descendants', () => {
    const tree = page([
      { id: 1, children: [{ id: 2, children: [{ id: 3 }] }, { id: 4 }] },
      { id: 5 },
    ]);
    expect(visibleRows(tree.rows, new Set())).toBe(tree.rows);
    expect(visibleRows(tree.rows, new Set([1])).map((r) => r.id)).toEqual([5, 1]);
    expect(visibleRows(tree.rows, new Set([2])).map((r) => r.id)).toEqual([5, 1, 4, 2]);
  });
});

describe('reduce', () => {
  const loaded: EditorState = reduce(INITIAL_STATE, {
    type: 'document.loaded',
    document: { id: 1, revision: 1, undoDepth: 0, dirty: false },
    pages: [{ id: 1, name: 'Page 1', current: true }],
    layers: [{ id: 2, name: 'Card', type: 'FRAME' }],
    selection: [],
  });

  it('returns the same state for events that change nothing', () => {
    const selected = reduce(loaded, { type: 'selection.changed', document: 1, page: 1, ids: [2] });
    expect(reduce(selected, { type: 'selection.changed', document: 1, page: 1, ids: [2] })).toBe(
      selected,
    );
    expect(reduce(loaded, { type: 'canvas.mode', on: false })).toBe(loaded);
    expect(reduce(loaded, { type: 'dirty', dirty: false })).toBe(loaded);
  });

  it('ignores events for a document it hasn’t loaded', () => {
    expect(
      reduce(loaded, { type: 'document.changed', document: 9, revision: 5, undoDepth: 3 }),
    ).toBe(loaded);
    expect(reduce(loaded, { type: 'selection.changed', document: 9, page: 1, ids: [7] })).toBe(
      loaded,
    );
  });

  it('keeps full fields only for selected layers', () => {
    let s = reduce(loaded, {
      type: 'selection.changed',
      document: 1,
      page: 1,
      ids: [2],
      nodes: [{ id: 2, name: 'Card', x: 10 }],
    });
    expect(s.nodes.get(2)).toEqual({ id: 2, name: 'Card', x: 10 });
    s = reduce(s, {
      type: 'document.changed',
      document: 1,
      revision: 2,
      undoDepth: 1,
      nodes: [{ id: 2, x: 30, name: null }],
    });
    expect(s.nodes.get(2)).toEqual({ id: 2, x: 30 });
    s = reduce(s, { type: 'selection.changed', document: 1, page: 1, ids: [] });
    expect(s.nodes.size).toBe(0);
  });

  it('drops a removed layer from the selection', () => {
    let s = reduce(loaded, { type: 'selection.changed', document: 1, page: 1, ids: [2] });
    s = reduce(s, {
      type: 'document.changed',
      document: 1,
      revision: 2,
      undoDepth: 1,
      removed: [{ id: 2, parent: 1, index: 0 }],
    });
    expect(s.selection).toEqual([]);
  });

  it('adds, renames and reorders pages', () => {
    const s = reduce(loaded, {
      type: 'document.changed',
      document: 1,
      revision: 2,
      undoDepth: 1,
      nodes: [
        { id: 1, name: 'Home' },
        { id: 7, name: 'Second', type: 'PAGE' },
      ],
      added: [{ id: 7, parent: null, index: 0 }],
    });
    expect(s.pages).toEqual([
      { id: 7, name: 'Second', current: false },
      { id: 1, name: 'Home', current: true },
    ]);
    expect(s.tree).toBe(loaded.tree);
  });

  it('a resync keeps the tree for the store to read again', () => {
    const s = reduce(loaded, {
      type: 'document.changed',
      document: 1,
      revision: 9,
      undoDepth: 4,
      resync: true,
    });
    expect(s.tree).toBe(loaded.tree);
    expect(s.document?.undoDepth).toBe(4);
  });
});
