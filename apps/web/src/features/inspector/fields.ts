/**
 * What the inspector shows for the selection (Story 5.8), read from the layers' fields as the
 * editor reports them (`node.get` at depth 0). The editor leaves out fields at their default
 * (opacity 1, blend normal, constraints left/top), so every reader supplies the default.
 * Several layers selected: a value they share, or `MIXED`.
 */
import type { NodeFields } from '@greenfield/editor-state';

export const MIXED = Symbol('mixed');
export type Shared<T> = T | typeof MIXED;

/** Deep equality for field values (key order ignored: Postgres jsonb reorders keys). */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ob = b as Record<string, unknown>;
  return ka.every((k) => k in ob && same((a as Record<string, unknown>)[k], ob[k]));
}

/** What every node gives for `read`, or `MIXED` when they differ. */
export function shared<T>(nodes: readonly NodeFields[], read: (n: NodeFields) => T): Shared<T> {
  const first = read(nodes[0]!);
  for (let i = 1; i < nodes.length; i++) if (!same(read(nodes[i]!), first)) return MIXED;
  return first;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const numOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strOr = <T extends string>(v: unknown, d: T): T => (typeof v === 'string' ? (v as T) : d);

export type Sizing = 'fixed' | 'hug' | 'fill';
export type LayoutMode = 'horizontal' | 'vertical' | 'grid' | null;

export const sizing = (n: NodeFields, axis: 'horizontal' | 'vertical'): Sizing =>
  strOr(isObj(n.sizing) ? n.sizing[axis] : undefined, 'fixed');

/** The frame's auto layout, or null without one. */
export interface Layout {
  mode: LayoutMode;
  gap: number;
  /** [top, right, bottom, left] */
  padding: [number, number, number, number];
  mainAlign: string;
  crossAlign: string;
  wrap: boolean;
}

export function layout(n: NodeFields): Layout | null {
  const l = n.layout;
  if (!isObj(l) || !l.mode) return null;
  const p = Array.isArray(l.padding) ? l.padding : [l.padding, l.padding, l.padding, l.padding];
  return {
    mode: l.mode as LayoutMode,
    gap: numOr(l.gap, 0),
    padding: [numOr(p[0], 0), numOr(p[1], 0), numOr(p[2], 0), numOr(p[3], 0)],
    mainAlign: strOr(l.mainAlign, 'min'),
    crossAlign: strOr(l.crossAlign, 'min'),
    wrap: l.wrap === true,
  };
}

export const constraint = (n: NodeFields, axis: 'horizontal' | 'vertical'): string =>
  strOr(
    isObj(n.constraints) ? n.constraints[axis] : undefined,
    axis === 'horizontal' ? 'left' : 'top',
  );

export const opacity = (n: NodeFields) => numOr(n.opacity, 1);
export const blend = (n: NodeFields) => strOr(n.blend, 'normal');

/** One radius for every corner, or `MIXED` when the corners differ. */
export function radius(n: NodeFields): Shared<number> {
  const r = n.cornerRadius;
  if (Array.isArray(r)) return r.every((c) => c === r[0]) ? numOr(r[0], 0) : MIXED;
  return numOr(r, 0);
}

/** A fill or stroke as the editor reports it. */
export interface Paint {
  type: string;
  /** `#RRGGBB` for a solid paint. */
  color?: string;
  opacity?: number;
  visible?: boolean;
  [k: string]: unknown;
}

export const paints = (n: NodeFields, key: 'fills' | 'strokes'): Paint[] =>
  Array.isArray(n[key]) ? (n[key] as Paint[]).filter(isObj) : [];

export interface Effect {
  type: string;
  radius?: number;
  visible?: boolean;
  [k: string]: unknown;
}

export const effects = (n: NodeFields): Effect[] =>
  Array.isArray(n.effects) ? (n.effects as Effect[]).filter(isObj) : [];

export const isText = (n: NodeFields) => n.type === 'TEXT';
/** Layers that can hold auto layout. */
export const isFrame = (n: NodeFields) =>
  n.type === 'FRAME' ||
  n.type === 'COMPONENT' ||
  n.type === 'COMPONENT_SET' ||
  n.type === 'INSTANCE';

/**
 * A number with an optional unit, as text fields hold them: `24`, `"150%"`, `"2"`, `"Auto"`.
 * `null` for a value with no number (Auto).
 */
export interface Measure {
  value: number;
  unit: '' | '%';
}

export function measure(v: unknown): Measure | null {
  if (typeof v === 'number' && Number.isFinite(v)) return { value: v, unit: '' };
  if (typeof v !== 'string') return null;
  const m = /^\s*(-?\d*\.?\d+)\s*(%|px)?\s*$/.exec(v);
  return m ? { value: Number(m[1]), unit: m[2] === '%' ? '%' : '' } : null;
}

/** A measure as `node.set` takes it: px as a number, a percentage as `"150%"`. */
export const measureValue = (m: Measure): number | string =>
  m.unit === '%' ? `${m.value}%` : m.value;

/** For display: at most two decimals. */
export const round = (v: number) => Math.round(v * 100) / 100;

export const formatMeasure = (v: unknown): string => {
  const m = measure(v);
  if (m) return `${round(m.value)}${m.unit}`;
  return typeof v === 'string' ? v : '';
};

/** `#RRGGBB`, or null for anything else. `fff` and `#FFF` are expanded. */
export function parseHex(text: string): string | null {
  const t = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) return `#${[...t].map((c) => c + c).join('')}`.toUpperCase();
  return /^[0-9a-f]{6}$/i.test(t) ? `#${t.toUpperCase()}` : null;
}

/** The weight a font style names (`"SemiBold Italic"` → 600), or null. */
const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/light/i, 300],
  [/medium/i, 500],
  [/bold/i, 700],
  [/black|heavy/i, 900],
  [/regular|normal|book|italic/i, 400],
];

export const styleWeight = (style: string): number | null =>
  WEIGHTS.find(([re]) => re.test(style))?.[1] ?? null;

/** The font styles the weight menu offers, lightest first. */
export const FONT_STYLES = [
  'Thin',
  'ExtraLight',
  'Light',
  'Regular',
  'Medium',
  'SemiBold',
  'Bold',
  'ExtraBold',
  'Black',
] as const;

/** Effect types by the names people know. */
export const EFFECT_NAMES: Record<string, string> = {
  dropShadow: 'Drop shadow',
  innerShadow: 'Inner shadow',
  layerBlur: 'Layer blur',
  backgroundBlur: 'Background blur',
  noise: 'Noise',
  texture: 'Texture',
  glass: 'Glass',
};

export const TYPE_NAMES: Record<string, string> = {
  FRAME: 'Frame',
  GROUP: 'Group',
  TEXT: 'Text',
  RECTANGLE: 'Rectangle',
  ELLIPSE: 'Ellipse',
  LINE: 'Line',
  VECTOR: 'Vector',
  POLYGON: 'Polygon',
  STAR: 'Star',
  COMPONENT: 'Component',
  COMPONENT_SET: 'Component set',
  INSTANCE: 'Instance',
  SECTION: 'Section',
  BOOLEAN_OPERATION: 'Boolean',
  IMAGE: 'Image',
};

export const typeName = (type: unknown) =>
  typeof type === 'string'
    ? (TYPE_NAMES[type] ?? type.charAt(0) + type.slice(1).toLowerCase())
    : '';
