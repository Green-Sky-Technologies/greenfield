/**
 * Document snapshots and diffs, to find which layers an edit touched. Layout-derived values are
 * ignored: x/y/absoluteBounds always, width/height unless that axis is `fixed` (a hugging parent
 * growing because its child grew is not an edit of the parent).
 */
import type { FigcraftSession } from './mcp';

export interface Layer {
  id: number;
  parentId: number | null;
  name?: string;
  type?: string;
  props: Record<string, unknown>;
}
export type Snapshot = Map<number, Layer>;

interface RawNode {
  id: number;
  children?: RawNode[];
  [k: string]: unknown;
}

export async function snapshot(fc: FigcraftSession, rootId: number): Promise<Snapshot> {
  const root = await fc.json<RawNode>('get_node', { id: rootId, depth: 64 });
  const out: Snapshot = new Map();
  const walk = (n: RawNode, parentId: number | null) => {
    const { children, id, ...props } = n;
    out.set(id, {
      id,
      parentId,
      name: props.name as string | undefined,
      type: props.type as string | undefined,
      props,
    });
    for (const c of children ?? []) walk(c, id);
  };
  walk(root, null);
  return out;
}

function comparable(l: Layer): string {
  const { x: _x, y: _y, absoluteBounds: _a, gridCell: _g, width, height, ...rest } = l.props;
  const sizing = (l.props.sizing ?? {}) as { horizontal?: string; vertical?: string };
  const keep: Record<string, unknown> = { ...rest, parentId: l.parentId };
  if (!sizing.horizontal || sizing.horizontal === 'fixed') keep.width = width;
  if (!sizing.vertical || sizing.vertical === 'fixed') keep.height = height;
  return JSON.stringify(keep, Object.keys(keep).sort());
}

export interface Diff {
  created: number[];
  deleted: number[];
  changed: number[];
}

export function diff(before: Snapshot, after: Snapshot): Diff {
  const created: number[] = [];
  const deleted: number[] = [];
  const changed: number[] = [];
  for (const [id, l] of after) {
    const b = before.get(id);
    if (!b) created.push(id);
    else if (comparable(b) !== comparable(l)) changed.push(id);
  }
  for (const id of before.keys()) if (!after.has(id)) deleted.push(id);
  return { created, deleted, changed };
}

/** Layer ids a command's params name explicitly (`ids`, `id`), ignoring $ref/$step objects. */
export function explicitIds(params: unknown): number[] {
  if (!params || typeof params !== 'object') return [];
  const p = params as { ids?: unknown; id?: unknown };
  const out: number[] = [];
  if (Array.isArray(p.ids)) for (const x of p.ids) if (typeof x === 'number') out.push(x);
  if (typeof p.id === 'number') out.push(p.id);
  return out;
}
