/**
 * The page tree and its row model. Built in full from a `document.inspect` read; after that only
 * patched from `document.changed` (ADR 0005: re-reading 5,002 layers costs 64 ms, a patch costs a
 * map copy). Patches copy on write, so an older `PageTree` never changes under a reader.
 *
 * Patches follow the editor's rule (Story 2.3, the fork's `host_sync.rs`): apply `removed`, take
 * `moved` out, then insert `added` and `moved` in ascending `index`; layers not listed keep their
 * order. A top-level layer's `parent` is its page; a page's is null.
 */
import type { NodeFields, NodeId, PageTree, Placement, RawNode, TreeNode, TreeRow } from './types';

export const EMPTY_TREE: PageTree = { page: null, nodes: new Map(), roots: [], rows: [] };

/** The fields a tree node keeps; anything else in a patch only matters to `nodes`. */
const TREE_FIELDS = ['name', 'type', 'visible', 'locked'] as const;

function componentMark(type: string): TreeNode['component'] {
  if (type === 'COMPONENT') return 'main';
  if (type === 'COMPONENT_SET') return 'set';
  if (type === 'INSTANCE') return 'instance';
  return null;
}

/** `f`'s fields (a `null` field is one the layer no longer has: its default). */
function makeNode(f: NodeFields, parent: NodeId, children: readonly NodeId[]): TreeNode {
  const type = f.type ?? '';
  return {
    id: f.id,
    parent,
    children,
    name: f.name ?? '',
    type,
    visible: f.visible !== false,
    locked: f.locked === true,
    component: componentMark(type),
  };
}

/** Front-most first, depth-first: the order the layers list shows. */
function rowsOf(nodes: ReadonlyMap<NodeId, TreeNode>, roots: readonly NodeId[]): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (ids: readonly NodeId[], depth: number) => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i]!;
      rows.push({ id, depth });
      const n = nodes.get(id);
      if (n && n.children.length) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

/** The tree of `page` from its top-level layers (children nested, as `document.inspect` gives). */
export function treeFromLayers(page: NodeId, layers: readonly RawNode[]): PageTree {
  const nodes = new Map<NodeId, TreeNode>();
  const add = (raw: RawNode, parent: NodeId): NodeId => {
    const children = (raw.children ?? []).map((c) => add(c, raw.id));
    nodes.set(raw.id, makeNode(raw as NodeFields, parent, children));
    return raw.id;
  };
  const roots = layers.map((l) => add(l, page));
  return { page, nodes, roots, rows: rowsOf(nodes, roots) };
}

export interface TreePatch {
  /** Added layers in full; changed layers' differing fields (`null`: gone). */
  nodes?: readonly NodeFields[];
  added?: readonly Placement[];
  removed?: readonly Placement[];
  moved?: readonly Placement[];
}

/** The tree nodes `fields` gives new values to (most changes, like x or fills, give none). */
function fieldUpdates(tree: ReadonlyMap<NodeId, TreeNode>, fields: readonly NodeFields[]) {
  const out: TreeNode[] = [];
  for (const f of fields) {
    const n = tree.get(f.id);
    if (!n || !TREE_FIELDS.some((k) => k in f)) continue;
    const next = makeNode({ ...n, ...f }, n.parent, n.children);
    if (TREE_FIELDS.some((k) => next[k] !== n[k])) out.push(next);
  }
  return out;
}

/** Apply a `document.changed` patch. Returns `tree` itself when nothing in it changed. */
export function patchTree(tree: PageTree, patch: TreePatch): PageTree {
  const { nodes: fields = [], added = [], removed = [], moved = [] } = patch;
  const onPage = (p: Placement) => p.parent !== null; // the rest are pages
  if (!added.some(onPage) && !removed.some(onPage) && !moved.some(onPage)) {
    // Fields only: the rows stay, and the map is copied only when a row's text or marks change.
    const updates = fieldUpdates(tree.nodes, fields);
    if (!updates.length) return tree;
    const nodes = new Map(tree.nodes);
    for (const n of updates) nodes.set(n.id, n);
    return { ...tree, nodes };
  }
  const nodes = new Map(tree.nodes);
  let roots = tree.roots;

  const siblingsOf = (parent: NodeId | null) =>
    parent === tree.page ? roots : parent === null ? null : (nodes.get(parent)?.children ?? null);
  const setSiblings = (parent: NodeId, ids: readonly NodeId[]) => {
    if (parent === tree.page) roots = ids;
    else nodes.set(parent, { ...nodes.get(parent)!, children: ids });
  };
  const detach = (id: NodeId) => {
    const n = nodes.get(id);
    const sibs = n && siblingsOf(n.parent);
    if (sibs)
      setSiblings(
        n.parent,
        sibs.filter((s) => s !== id),
      );
  };
  // A removed layer's subtree goes with it, except layers moved out of it in the same change.
  const staying = new Set(moved.map((m) => m.id));
  const drop = (id: NodeId) => {
    const n = nodes.get(id);
    if (!n) return;
    nodes.delete(id);
    for (const c of n.children) if (!staying.has(c)) drop(c);
  };

  for (const r of removed) {
    detach(r.id);
    drop(r.id);
  }
  for (const m of moved) detach(m.id);
  const full = new Map(fields.map((f) => [f.id, f]));
  for (const a of added.filter(onPage)) {
    drop(a.id);
    nodes.set(a.id, makeNode(full.get(a.id) ?? { id: a.id }, a.parent!, []));
  }
  // Every added layer is in the map first, so a child can go into a parent added with it.
  const placed = [...added, ...moved].filter(onPage).sort((a, b) => a.index - b.index);
  for (const p of placed) {
    const n = nodes.get(p.id);
    const sibs = siblingsOf(p.parent);
    if (!n) continue;
    if (!sibs) {
      drop(p.id); // to another page
      continue;
    }
    const next = sibs.slice();
    next.splice(Math.max(0, Math.min(p.index, next.length)), 0, p.id);
    setSiblings(p.parent!, next);
    if (n.parent !== p.parent) nodes.set(p.id, { ...nodes.get(p.id)!, parent: p.parent! });
  }
  const addedIds = new Set(added.map((a) => a.id));
  for (const n of fieldUpdates(
    nodes,
    fields.filter((f) => !addedIds.has(f.id)),
  ))
    nodes.set(n.id, n);
  return { page: tree.page, nodes, roots, rows: rowsOf(nodes, roots) };
}

/**
 * The rows a layers list shows with some layers collapsed: `rows` minus every collapsed layer's
 * descendants. Returns `rows` itself when nothing is collapsed.
 */
export function visibleRows(
  rows: readonly TreeRow[],
  collapsed: ReadonlySet<NodeId>,
): readonly TreeRow[] {
  if (!collapsed.size) return rows;
  const out: TreeRow[] = [];
  let hideBelow = Infinity;
  for (const r of rows) {
    if (r.depth > hideBelow) continue;
    hideBelow = collapsed.has(r.id) ? r.depth : Infinity;
    out.push(r);
  }
  return out;
}
