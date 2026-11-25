/**
 * Claude follows the system (Story 10.5): what the agent reads about a file's design system, and
 * the deterministic check run on the layers a turn changed.
 *
 * - `systemPrompt` is the guide plus a summary of the published variables, styles and components.
 *   It is the same text for every turn on files of one system version, so it sits in the agent's
 *   cached prefix.
 * - `checkLayers` flags raw colours (a solid fill or stroke bound to no variable and no style) and
 *   off-scale spacing (an auto layout gap or padding bound to no variable and not on the system's
 *   spacing scale). Each finding names the nearest variable, so the fix is one `variable.bind`.
 *   It reads layers as `get_node` returns them in the tab (`fills`, `strokes`, `layout`,
 *   `boundVariables`, `styles`).
 */
import type { DesignSystemItem } from '@greenfield/db';

export interface SystemRules {
  name: string;
  colours: { name: string; hex: string }[];
  /** Spacing steps (number variables of scales that aren't radii). */
  spacing: { name: string; value: number }[];
}

export interface CheckLayer {
  id: number;
  name: string;
}

export interface Violation {
  kind: 'colour' | 'spacing';
  /** `fill`, `stroke`, `gap` or `padding`. */
  field: string;
  /** `#rrggbb` (or `#rrggbbaa`), or the px value. */
  value: string | number;
  layers: CheckLayer[];
  /** The nearest variable, when the system has one. */
  suggestion: { name: string; value: string | number } | null;
}

/** A design-system check of one turn (stored on the reply; the agent pane shows it). */
export interface DesignCheck {
  system: string;
  rounds: number;
  /** What the first round found. */
  found: Violation[];
  /** What the last round still found. */
  left: Violation[];
}

/** The fields the check reads from `get_node`. */
export const CHECK_FIELDS = [
  'name',
  'type',
  'fills',
  'strokes',
  'layout',
  'boundVariables',
  'styles',
] as const;

const RADIUS = /radius|radii|corner|round/i;

export function rulesFor(name: string, summary: DesignSystemItem[]): SystemRules {
  const colours: SystemRules['colours'] = [];
  const spacing: SystemRules['spacing'] = [];
  for (const item of summary) {
    if (item.kind === 'colours')
      for (const c of item.colours) if (c.hex) colours.push({ name: c.name, hex: c.hex });
    if (item.kind === 'spacing' && !RADIUS.test(item.name))
      for (const v of item.values) if (!RADIUS.test(v.name)) spacing.push(v);
  }
  return { name, colours, spacing };
}

// ---- the prefix ----

function summaryLines(summary: DesignSystemItem[]): string[] {
  const lines: string[] = [];
  for (const item of summary)
    switch (item.kind) {
      case 'colours':
        lines.push(
          `- Colours · ${item.name}: ${item.colours.map((c) => `${c.name} ${c.hex ?? ''}`.trim()).join(', ')}`,
        );
        break;
      case 'spacing':
        lines.push(
          `- Scale · ${item.name}: ${item.values.map((v) => `${v.name} ${v.value}`).join(', ')}`,
        );
        break;
      case 'type':
        lines.push(
          `- Text style ${item.name}: ${item.fontFamily} ${item.fontStyle} ${item.fontSize}`,
        );
        break;
      case 'component':
        lines.push(
          `- Component ${item.name}${item.variants > 1 ? ` (${item.variants} variants)` : ''}`,
        );
        break;
    }
  return lines;
}

/**
 * The design-system block of the agent's system prompt. Deterministic for a system version, so
 * the prompt cache keeps it across turns and members.
 */
export function systemPrompt(system: {
  name: string;
  version: number;
  guide: string;
  summary: DesignSystemItem[];
}): string {
  const guide = system.guide.trim();
  return [
    `<design_system name="${system.name}" version="${system.version}">`,
    `This file uses the ${system.name} design system. Its variables, text styles and components are in the file. Build with them:`,
    '- Colours: bind fills and strokes to the colour variables (variable.bind, field fill or stroke) instead of typing hex values.',
    '- Spacing: auto layout gaps and padding come from the spacing scale; bind them (variable.bind, field gap, paddingHorizontal, paddingVertical) or use a value on the scale.',
    '- Text: apply the text styles (style.apply) instead of setting font, size and weight by hand.',
    '- Components: place instances of the components (component.list finds them) instead of drawing your own buttons, inputs, cards or navigation.',
    'After each turn a check flags raw colours and off-scale spacing on the layers you changed; fix what it reports.',
    '',
    'What the system has:',
    ...summaryLines(system.summary),
    ...(guide ? ['', 'The guide:', guide] : []),
    '</design_system>',
  ].join('\n');
}

// ---- the check ----

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function rgb(hex: string): [number, number, number] {
  const n = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) || 0;
  return [n(0), n(1), n(2)];
}

function nearestColour(rules: SystemRules, hex: string) {
  const [r, g, b] = rgb(hex);
  let best: { name: string; value: string; d: number } | null = null;
  for (const c of rules.colours) {
    const [r2, g2, b2] = rgb(c.hex);
    // Weighted RGB distance: good enough to name "the brand red" for a near-miss red.
    const d = 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2;
    if (!best || d < best.d) best = { name: c.name, value: c.hex, d };
  }
  return best && { name: best.name, value: best.value };
}

function nearestStep(rules: SystemRules, value: number) {
  let best: { name: string; value: number } | null = null;
  for (const s of rules.spacing)
    if (!best || Math.abs(s.value - value) < Math.abs(best.value - value)) best = s;
  return best;
}

/** Solid paints a layer sets itself (visible, not from a style, not bound to a variable). */
function rawPaints(node: Json, field: 'fills' | 'strokes'): string[] {
  const one = field === 'fills' ? 'fill' : 'stroke';
  const bound = isRecord(node.boundVariables) ? node.boundVariables : {};
  const styles = isRecord(node.styles) ? node.styles : {};
  if (styles[one]) return [];
  const paints = Array.isArray(node[field]) ? (node[field] as unknown[]) : [];
  return paints.flatMap((p, i) => {
    if (!isRecord(p) || p.type !== 'solid' || p.visible === false) return [];
    if (typeof p.opacity === 'number' && p.opacity === 0) return [];
    if (bound[`${field}/${i}/color`] || (i === 0 && bound[one])) return [];
    return typeof p.color === 'string' ? [p.color.toLowerCase()] : [];
  });
}

/** Gaps and padding an auto layout frame sets itself (not bound to a variable). */
function rawSpacing(node: Json): { field: string; value: number }[] {
  const layout = isRecord(node.layout) ? node.layout : null;
  if (!layout || !layout.mode || layout.mode === 'none') return [];
  const bound = isRecord(node.boundVariables) ? node.boundVariables : {};
  const out: { field: string; value: number }[] = [];
  if (typeof layout.gap === 'number' && !bound.gap && layout.mainAlign !== 'spaceBetween')
    out.push({ field: 'gap', value: layout.gap });
  const pad = Array.isArray(layout.padding) ? layout.padding : [];
  const [t, r, b, l] = pad.map(Number);
  const sides: [string, number | undefined, string][] = [
    ['paddingVertical', t, 'paddingTop'],
    ['paddingHorizontal', r, 'paddingRight'],
    ['paddingVertical', b, 'paddingBottom'],
    ['paddingHorizontal', l, 'paddingLeft'],
  ];
  for (const [pair, v, side] of sides)
    if (typeof v === 'number' && !bound[pair] && !bound[side] && !bound.padding)
      out.push({ field: 'padding', value: v });
  return out;
}

/** Every layer in a `get_node` result (the node and its children, depth first). */
export function walkNodes(root: unknown): Json[] {
  const out: Json[] = [];
  const visit = (n: unknown) => {
    if (!isRecord(n) || typeof n.id !== 'number') return;
    out.push(n);
    if (Array.isArray(n.children)) for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

/**
 * Check `layers` (as `get_node` returns them) against the system. Only layers in `only` are
 * checked when it's given: the turn's own changes, not what was already on the page. Findings
 * are grouped by value, so "#e1472f on 2 layers" is one finding with one fix.
 */
export function checkLayers(
  layers: unknown[],
  rules: SystemRules,
  only: ReadonlySet<number> | null = null,
): Violation[] {
  const byKey = new Map<string, Violation>();
  const scale = new Set(rules.spacing.map((s) => s.value));
  const add = (kind: Violation['kind'], field: string, value: string | number, node: Json) => {
    const key = `${kind}:${field}:${value}`;
    const layer = { id: node.id as number, name: String(node.name ?? '') };
    const v = byKey.get(key);
    if (v) {
      if (!v.layers.some((l) => l.id === layer.id)) v.layers.push(layer);
      return;
    }
    byKey.set(key, {
      kind,
      field,
      value,
      layers: [layer],
      suggestion:
        kind === 'colour' ? nearestColour(rules, String(value)) : nearestStep(rules, Number(value)),
    });
  };
  const seen = new Set<number>();
  for (const node of layers.flatMap(walkNodes)) {
    const id = node.id as number;
    if (seen.has(id) || (only && !only.has(id))) continue;
    seen.add(id);
    // An instance's paints and layout come from its component; checking the component is enough.
    if (String(node.type).toUpperCase() === 'INSTANCE') continue;
    if (rules.colours.length) {
      for (const hex of rawPaints(node, 'fills')) add('colour', 'fill', hex, node);
      for (const hex of rawPaints(node, 'strokes')) add('colour', 'stroke', hex, node);
    }
    if (scale.size)
      for (const s of rawSpacing(node))
        if (s.value !== 0 && !scale.has(s.value)) add('spacing', s.field, s.value, node);
  }
  return [...byKey.values()];
}

const layersText = (v: Violation) =>
  v.layers
    .slice(0, 6)
    .map((l) => `"${l.name}" (${l.id})`)
    .join(', ') + (v.layers.length > 6 ? ` and ${v.layers.length - 6} more` : '');

/** The message that asks the agent to fix what the check found. */
export function checkPrompt(rules: SystemRules, found: Violation[]): string {
  const lines = found.map((v) =>
    v.kind === 'colour'
      ? `- Raw colour ${v.value} as ${v.field} on ${layersText(v)}${v.suggestion ? `: bind ${v.field} to ${v.suggestion.name} (${v.suggestion.value})` : ''}.`
      : `- ${v.field === 'gap' ? 'Gap' : 'Padding'} ${v.value} is off the spacing scale on ${layersText(v)}${v.suggestion ? `: use ${v.suggestion.name} (${v.suggestion.value})` : ''}.`,
  );
  return [
    `Design system check (${rules.name}): the layers you changed use values outside the system.`,
    ...lines,
    'Fix these with one run_batch (variable.bind for colours and spacing; another variable if the suggested one is wrong for the role), then reply with one short sentence.',
  ].join('\n');
}

/** "Replaced #e1472f with rubric/500 on 2 layers." for a finding the agent fixed. */
export function describeFix(v: Violation): string {
  const n = v.layers.length;
  const on = `on ${n} layer${n === 1 ? '' : 's'}`;
  if (v.kind === 'colour')
    return v.suggestion
      ? `Replaced ${v.value} with ${v.suggestion.name} ${on}.`
      : `Bound ${v.field} ${v.value} to a variable ${on}.`;
  return v.suggestion
    ? `Moved ${v.field} ${v.value} to ${v.suggestion.name} (${v.suggestion.value}) ${on}.`
    : `Put ${v.field} ${v.value} on the scale ${on}.`;
}

const key = (v: Violation) => `${v.kind}:${v.field}:${v.value}`;

/** Findings of the first round that the last round no longer reports. */
export function fixedFindings(check: DesignCheck): Violation[] {
  const left = new Set(check.left.map(key));
  return check.found.filter((v) => !left.has(key(v)));
}
