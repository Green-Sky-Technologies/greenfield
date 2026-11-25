/**
 * Per-turn change records (Story 4.7): which layers an agent turn changed, which properties,
 * and their values before and after; plus how to revert the turn ("Undo all") and what to show
 * on the canvas.
 *
 * Records are built from two snapshots of the page (`id → record`, as `flatten` makes them):
 * `run_batch` takes them around each batch today, and the editor-state store can feed the same
 * function from `document.changed` payloads (Story 2.3) once they carry fields. Client-safe.
 */
import type { NodeId, NodeRecord } from '@greenfield/bridge';
import { z } from 'zod';

const nodeId = z.number().int().nonnegative();

export const fieldChange = z
  .object({ field: z.string().max(64), before: z.unknown(), after: z.unknown() })
  .strict();
export type FieldChange = z.infer<typeof fieldChange>;

export const layerChange = z
  .object({
    id: nodeId,
    /** The layer's name after the change (before it, for a removed layer). */
    name: z.string().max(200),
    type: z.string().max(40).optional(),
    kind: z.enum(['added', 'removed', 'changed']),
    /** Changed properties (`changed` layers only). */
    fields: z.array(fieldChange).max(100),
    /** The top-level frame the layer is in (itself, when it is top level). */
    frame: nodeId.nullable(),
  })
  .strict();
export type LayerChange = z.infer<typeof layerChange>;

/** Fields that are structure, not properties a person changed. */
const STRUCTURE: ReadonlySet<string> = new Set(['id', 'children', 'parent', 'absoluteBounds']);
/** Fields auto layout recomputes on layers nobody edited. */
export const LAYOUT_DERIVED: ReadonlySet<string> = new Set([
  'x',
  'y',
  'width',
  'height',
  'absoluteBounds',
]);

const same = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

/** The top-level layer above `id` (itself when its parent is the page). */
export function topFrame(records: Map<NodeId, NodeRecord>, id: NodeId): NodeId | null {
  let cur: NodeId = id;
  for (let n = 0; n < 256; n++) {
    const r = records.get(cur);
    if (!r) return null;
    const parent = r.parent as NodeId | null | undefined;
    if (parent == null) return cur;
    cur = parent;
  }
  return null;
}

/**
 * The layers that changed between two snapshots. A layer whose only differences are its position
 * or size counts only if `targeted` names it: auto layout moves the neighbours of whatever
 * changed, and those moves are not edits.
 */
export function layerChanges(
  before: Map<NodeId, NodeRecord>,
  after: Map<NodeId, NodeRecord>,
  targeted: ReadonlySet<NodeId> = new Set(),
): LayerChange[] {
  const out: LayerChange[] = [];
  const name = (r: NodeRecord) => String(r.name ?? '');
  const type = (r: NodeRecord) => (typeof r.type === 'string' ? { type: r.type } : {});
  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) {
      out.push({
        id,
        name: name(a),
        ...type(a),
        kind: 'added',
        fields: [],
        frame: topFrame(after, id),
      });
      continue;
    }
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
      (k) => !STRUCTURE.has(k) && !same(b[k], a[k]),
    );
    const moved = !same(b.parent, a.parent);
    if (!keys.length && !moved) continue;
    if (!moved && !targeted.has(id) && keys.every((k) => LAYOUT_DERIVED.has(k))) continue;
    out.push({
      id,
      name: name(a),
      ...type(a),
      kind: 'changed',
      fields: keys.sort().map((field) => ({ field, before: b[field], after: a[field] })),
      frame: topFrame(after, id),
    });
  }
  for (const [id, b] of before)
    if (!after.has(id))
      out.push({
        id,
        name: name(b),
        ...type(b),
        kind: 'removed',
        fields: [],
        frame: topFrame(before, id),
      });
  return out.sort((x, y) => x.id - y.id);
}

/**
 * Fold a turn's change records (in the order they happened) into one per layer: the first
 * `before` and the last `after` of each field, dropping fields that ended where they started and
 * layers added then removed.
 */
export function mergeLayerChanges(steps: readonly (readonly LayerChange[])[]): LayerChange[] {
  const byId = new Map<NodeId, LayerChange>();
  for (const step of steps)
    for (const c of step) {
      const prev = byId.get(c.id);
      if (!prev) {
        byId.set(c.id, { ...c, fields: c.fields.map((f) => ({ ...f })) });
        continue;
      }
      if (prev.kind === 'added' && c.kind === 'removed') {
        byId.delete(c.id);
        continue;
      }
      const kind = prev.kind === 'added' ? 'added' : c.kind;
      const fields = new Map(prev.fields.map((f) => [f.field, { ...f }]));
      for (const f of c.fields) {
        const p = fields.get(f.field);
        fields.set(f.field, p ? { ...p, after: f.after } : { ...f });
      }
      byId.set(c.id, {
        ...c,
        kind,
        name: c.kind === 'removed' ? prev.name : c.name,
        fields:
          kind === 'changed' ? [...fields.values()].filter((f) => !same(f.before, f.after)) : [],
      });
    }
  return [...byId.values()]
    .filter((c) => c.kind !== 'changed' || c.fields.length)
    .sort((x, y) => x.id - y.id);
}

/** What "Show on canvas" selects: the layers that still exist after the turn. */
export const showOnCanvasIds = (changes: readonly LayerChange[]): NodeId[] =>
  changes.filter((c) => c.kind !== 'removed').map((c) => c.id);

/** Properties `node.set` can write back (the rest are read-only or derived). */
const NOT_SETTABLE: ReadonlySet<string> = new Set(['type', 'absoluteBounds', 'childCount']);

export type RevertPlan =
  /** The turn's batches are still the newest undo steps: undo them (one per batch). */
  | { kind: 'undo'; steps: number }
  /**
   * Something happened after the turn: write the old values back with one batch. Removed
   * layers can't be rebuilt from their records and are listed in `unrestorable`.
   */
  | {
      kind: 'batch';
      commands: { command: string; params: Record<string, unknown> }[];
      unrestorable: NodeId[];
    };

/**
 * How to undo a turn. `undoLabels` are the turn's batch labels in the order they ran;
 * `history` is the editor's undo stack, newest first (`document.inspect` → `history.undo`).
 */
export function planRevert(
  changes: readonly LayerChange[],
  undoLabels: readonly string[],
  history: readonly string[],
): RevertPlan {
  const newest = [...undoLabels].reverse();
  if (newest.length && newest.every((l, i) => history[i] === l))
    return { kind: 'undo', steps: newest.length };
  const commands: { command: string; params: Record<string, unknown> }[] = [];
  const added = changes.filter((c) => c.kind === 'added').map((c) => c.id);
  for (const c of changes) {
    if (c.kind !== 'changed') continue;
    const props = Object.fromEntries(
      c.fields.filter((f) => !NOT_SETTABLE.has(f.field)).map((f) => [f.field, f.before ?? null]),
    );
    if (Object.keys(props).length)
      commands.push({ command: 'node.set', params: { id: c.id, props } });
  }
  if (added.length) commands.push({ command: 'edit.delete', params: { ids: added } });
  return {
    kind: 'batch',
    commands,
    unrestorable: changes.filter((c) => c.kind === 'removed').map((c) => c.id),
  };
}
