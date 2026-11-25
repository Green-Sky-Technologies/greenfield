/**
 * One paint of a layer (a fill or a stroke at `index`, bottom first) as the colour picker edits
 * it: its value from the layer's fields, and the commands that set it. The canvas asks for this
 * target with `ui.request colorPicker {target: 'paint', slot, index, ids}` (Story 2.11).
 */
import type { NodeFields, NodeId, PreviewCommand } from '@greenfield/editor-state';
import { normalizeHex } from './colour';
import type { ColourValue } from './open';

export interface PaintTarget {
  slot: 'fill' | 'stroke';
  index: number;
  ids: NodeId[];
}

/** `ui.request colorPicker`'s data, when it is a layer's paint. */
export function paintTarget(data: unknown): PaintTarget | null {
  const d = (data ?? {}) as Partial<PaintTarget> & { target?: unknown };
  if (d.target !== 'paint' || (d.slot !== 'fill' && d.slot !== 'stroke')) return null;
  if (typeof d.index !== 'number' || !Array.isArray(d.ids) || !d.ids.length) return null;
  return { slot: d.slot, index: d.index, ids: d.ids };
}

/** The `boundVariables` key a variable on this paint is under, if one is. */
function boundKey(t: PaintTarget, node: NodeFields | undefined): string | null {
  const bound = (node?.boundVariables ?? {}) as Record<string, unknown>;
  const keys = [`${t.slot}s/${t.index}/color`, ...(t.index === 0 ? [t.slot] : [])];
  return keys.find((k) => typeof bound[k] === 'string') ?? null;
}

/** What the paint shows now: its style, its variable, or its colour. */
export function paintValue(t: PaintTarget, node: NodeFields | undefined): ColourValue {
  const style = (node?.styles as Record<string, unknown> | undefined)?.[t.slot];
  if (typeof style === 'string') return { style };
  const key = boundKey(t, node);
  if (key) return { variable: (node!.boundVariables as Record<string, string>)[key]! };
  const paints = (node?.[`${t.slot}s`] ?? []) as { color?: string; opacity?: number }[];
  const paint = paints[t.index];
  return {
    hex: normalizeHex(paint?.color ?? '') ?? '#000000',
    opacity: typeof paint?.opacity === 'number' ? paint.opacity : 1,
  };
}

/** The commands that make the paint `value`, leaving whatever it was bound to. */
export function paintCommands(
  t: PaintTarget,
  node: NodeFields | undefined,
  value: ColourValue,
): PreviewCommand[] {
  const { ids, slot, index } = t;
  if ('style' in value) {
    return [{ command: 'style.apply', params: { ids, style: value.style, target: slot } }];
  }
  if ('variable' in value) {
    const field = boundKey(t, node) ?? `${slot}s/${index}/color`;
    return [{ command: 'variable.bind', params: { ids, field, variable: value.variable } }];
  }
  const was = paintValue(t, node);
  const unbind: PreviewCommand[] =
    'style' in was
      ? [{ command: 'style.detach', params: { ids, which: slot } }]
      : 'variable' in was
        ? [{ command: 'variable.bind', params: { ids, field: boundKey(t, node)!, variable: null } }]
        : [];
  return [
    ...unbind,
    {
      command: `${slot}.set`,
      params: { ids, index, color: value.hex, opacity: value.opacity },
    },
  ];
}
