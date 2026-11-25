/**
 * What the styles section shows for the selection (Story 5.9): which style slots and variable
 * fields a layer has, and one value across several layers (or "mixed").
 */
import type { NodeFields } from '@greenfield/editor-state';
import type { StyleType, VariableType } from '@/features/pickers/library';

export const MIXED = Symbol('mixed');
export type Mixed = typeof MIXED;

/** The layers' common value, `MIXED` when they differ (`undefined` for no layers). */
export function common<T>(nodes: readonly NodeFields[], read: (n: NodeFields) => T): T | Mixed {
  const [first, ...rest] = nodes.map(read);
  const key = JSON.stringify(first);
  return rest.every((v) => JSON.stringify(v) === key) ? (first as T) : MIXED;
}

export type StyleSlot = 'fill' | 'stroke' | 'text' | 'effect' | 'grid';

export const SLOT_TYPE: Record<StyleSlot, StyleType> = {
  fill: 'paint',
  stroke: 'paint',
  text: 'text',
  effect: 'effect',
  grid: 'grid',
};

const CONTAINERS = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);
export const isContainer = (n: NodeFields) => CONTAINERS.has(String(n.type));

/** The style slots a layer offers: text styles on text, grids on frames. */
export function styleSlots(n: NodeFields): StyleSlot[] {
  const slots: StyleSlot[] = n.type === 'TEXT' ? ['text', 'fill'] : ['fill'];
  slots.push('stroke', 'effect');
  if (isContainer(n)) slots.push('grid');
  return slots;
}

export interface BindableField {
  /** `variable.bind`'s `field`. */
  field: string;
  label: string;
  type: VariableType;
}

/** The fields a variable can be bound to from the Design tab, for this layer. */
export function bindableFields(n: NodeFields): BindableField[] {
  const fields: BindableField[] = [
    { field: 'fill', label: 'Fill', type: 'color' },
    { field: 'stroke', label: 'Stroke', type: 'color' },
    { field: 'width', label: 'Width', type: 'number' },
    { field: 'height', label: 'Height', type: 'number' },
    { field: 'opacity', label: 'Opacity (%)', type: 'number' },
    { field: 'visible', label: 'Visible', type: 'boolean' },
  ];
  if (n.type !== 'TEXT') fields.push({ field: 'cornerRadius', label: 'Radius', type: 'number' });
  if (isContainer(n) && n.layout) fields.push({ field: 'gap', label: 'Gap', type: 'number' });
  if (n.type === 'TEXT') {
    fields.push(
      { field: 'fontSize', label: 'Font size', type: 'number' },
      { field: 'characters', label: 'Text', type: 'string' },
    );
  }
  return fields;
}

/** How a bound field reads in the list: `fills/0/color` → `Fill 1`, `cornerRadius` → `Radius`. */
export function fieldLabel(field: string, known: readonly BindableField[]): string {
  const hit = known.find((f) => f.field === field);
  if (hit) return hit.label;
  const paint = /^(fill|stroke)s\/(\d+)\/color$/.exec(field);
  if (paint) return `${paint[1] === 'fill' ? 'Fill' : 'Stroke'} ${Number(paint[2]) + 1}`;
  return field;
}
