/**
 * The layers list's rules, apart from React: which layers a click selects, where a drop puts the
 * dragged layers, and which collapsed layers hide a given one. Rows are front-most first; a
 * parent's `children` are back to front, as `node.reparent` counts its `index`.
 */
import type { NodeId, PageTree, TreeRow } from '@greenfield/editor-state';

export interface ClickMods {
  /** Shift: the range from the anchor. */
  range: boolean;
  /** Cmd (Ctrl off a Mac): add or remove one layer. */
  toggle: boolean;
}

/** The selection after clicking `id` in `rows`. */
export function clickSelection(
  selection: readonly NodeId[],
  rows: readonly TreeRow[],
  id: NodeId,
  anchor: NodeId | null,
  mods: ClickMods,
): NodeId[] {
  if (mods.toggle)
    return selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
  if (mods.range && anchor !== null) {
    const a = rows.findIndex((r) => r.id === anchor);
    const b = rows.findIndex((r) => r.id === id);
    if (a >= 0 && b >= 0) {
      const [from, to] = a < b ? [a, b] : [b, a];
      return rows.slice(from, to + 1).map((r) => r.id);
    }
  }
  return [id];
}

/** Layer types that take children. */
const CONTAINERS = new Set(['FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'COMPONENT_SET']);

export const canContain = (type: string) => CONTAINERS.has(type);

export type DropPosition = 'above' | 'below' | 'inside';

/** Where over a row of `height` a pointer at `y` (from the row's top) drops. */
export function dropPosition(y: number, height: number, container: boolean): DropPosition {
  if (!container) return y < height / 2 ? 'above' : 'below';
  if (y < height / 4) return 'above';
  if (y > (height * 3) / 4) return 'below';
  return 'inside';
}

export interface Drop {
  parent: NodeId;
  /** Final position among `parent`'s children, bottom first (`node.reparent`). */
  index: number;
}

const isWithin = (tree: PageTree, id: NodeId, ancestor: NodeId) => {
  for (let n = tree.nodes.get(id); n; n = tree.nodes.get(n.parent))
    if (n.id === ancestor) return true;
  return false;
};

/**
 * Where dropping `dragged` at `position` of the row `target` puts them, or null when it can't
 * (onto or into a dragged layer). Below an expanded layer with children is its front-most child,
 * which is where that line shows.
 */
export function dropTarget(
  tree: PageTree,
  dragged: readonly NodeId[],
  target: NodeId,
  position: DropPosition,
  expanded: boolean,
): Drop | null {
  const node = tree.nodes.get(target);
  if (!node || dragged.some((d) => isWithin(tree, target, d))) return null;
  const into =
    position === 'inside' || (position === 'below' && expanded && node.children.length > 0);
  if (into) {
    if (!canContain(node.type)) return null;
    return { parent: target, index: node.children.filter((c) => !dragged.includes(c)).length };
  }
  const siblings = node.parent === tree.page ? tree.roots : tree.nodes.get(node.parent)?.children;
  if (!siblings) return null;
  const at = siblings.filter((s) => !dragged.includes(s)).indexOf(target);
  return { parent: node.parent, index: position === 'above' ? at + 1 : at };
}

/** `id`'s collapsed ancestors: what to expand to show it. */
export function collapsedAncestors(
  tree: PageTree,
  id: NodeId,
  collapsed: ReadonlySet<NodeId>,
): NodeId[] {
  const out: NodeId[] = [];
  for (let n = tree.nodes.get(tree.nodes.get(id)?.parent ?? -1); n; n = tree.nodes.get(n.parent))
    if (collapsed.has(n.id)) out.push(n.id);
  return out;
}
