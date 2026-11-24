/**
 * Per-turn document context (Story 4.1). Built in the browser, next to the editor, and sent with
 * the user's message; it is the volatile part of the request, after the cached prefix.
 *
 * - the selection's subtree (`node.get` with `CONTEXT_FIELDS`), which is also the turn's scope;
 * - a compact outline of the current page (one line per layer);
 * - the file's variables and styles (`variable.list`, `style.list`), one line each.
 *
 * Values are compacted for the model: colours become `#RRGGBB(AA)`, and keys at their defaults
 * (`visible: true`, `opacity: 1`, `blend: "normal"`, `locked: false`, `rotation: 0`) are dropped.
 * Every section has a cap, so a one-element request stays within `ONE_ELEMENT_TOKEN_BUDGET`.
 */
import type { Editor, EditorNode, NodeField, NodeId } from '@greenfield/bridge';

/** Layer keys the selection subtree carries (geometry, layout, style, text). */
export const CONTEXT_FIELDS = [
  'name',
  'type',
  'x',
  'y',
  'width',
  'height',
  'layout',
  'sizing',
  'fills',
  'strokes',
  'strokeWeight',
  'cornerRadius',
  'effects',
  'opacity',
  'visible',
  'characters',
  'fontFamily',
  'fontStyle',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'styles',
  'boundVariables',
] as const satisfies readonly NodeField[];

/** Story 4.1 AC: the context for a request about one element stays under this (estimated). */
export const ONE_ELEMENT_TOKEN_BUDGET = 2_000;

export const CONTEXT_LIMITS = {
  /** Children depth of each selected layer. */
  selectionDepth: 2,
  /** Selected layers read in full; more are listed by id only. */
  selectionLayers: 5,
  selectionChars: 12_000,
  outlineDepth: 6,
  outlineLines: 150,
  variables: 120,
  styles: 60,
} as const;

/** Conservative token estimate (JSON and ids tokenize at about 3 characters a token). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

export interface TurnContext {
  /** The `<document>` block for the user turn. */
  text: string;
  /** Layers the turn may change, with their descendants (the selection); null = whole page. */
  scope: NodeId[] | null;
  page: NodeId;
  tokens: number;
}

export interface TurnContextOptions {
  /** Defaults to the editor's current selection. */
  selection?: readonly NodeId[];
}

const DEFAULTS: Record<string, unknown> = {
  visible: true,
  opacity: 1,
  blend: 'normal',
  locked: false,
  rotation: 0,
};

const hex2 = (x: number) =>
  Math.round(Math.min(1, Math.max(0, x)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

function isRgba(v: Record<string, unknown>): boolean {
  const keys = Object.keys(v);
  return (
    keys.length >= 3 &&
    keys.length <= 4 &&
    ['r', 'g', 'b'].every((k) => typeof v[k] === 'number') &&
    keys.every((k) => k === 'r' || k === 'g' || k === 'b' || (k === 'a' && typeof v.a === 'number'))
  );
}

/** `{r,g,b,a}` (0..1) as `#RRGGBB`, with `AA` when not opaque. */
export function rgbaHex(c: { r: number; g: number; b: number; a?: number }): string {
  const a = c.a ?? 1;
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${a < 1 ? hex2(a) : ''}`;
}

/** Colours as hex, default-valued keys dropped, numbers rounded to 2 decimals. */
export function compactValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(compactValue);
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (isRgba(o)) return rgbaHex(o as { r: number; g: number; b: number; a?: number });
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    if (k in DEFAULTS && DEFAULTS[k] === x) continue;
    if (x === undefined || x === null) continue;
    if (Array.isArray(x) && x.length === 0) continue;
    out[k] = compactValue(x);
  }
  return out;
}

function clip(s: string, max: number, hint: string): string {
  return s.length > max ? `${s.slice(0, max)}…(truncated; ${hint})` : s;
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** One line per layer: `<indent><id> <TYPE> "name" "text"`, to `depth`, at most `maxLines`. */
export function outlineLines(page: EditorNode, maxLines: number = CONTEXT_LIMITS.outlineLines) {
  const lines: string[] = [];
  let total = 0;
  const walk = (n: EditorNode, level: number) => {
    total++;
    if (lines.length < maxLines) {
      const chars =
        typeof n.characters === 'string' && n.characters !== n.name
          ? ` "${oneLine(n.characters, 40)}"`
          : '';
      const hidden = n.visible === false ? ' hidden' : '';
      const more = n.childCount ? ` (+${n.childCount})` : '';
      lines.push(
        `${' '.repeat(level)}${n.id} ${n.type ?? '?'} "${oneLine(String(n.name ?? ''), 40)}"${chars}${hidden}${more}`,
      );
    }
    for (const c of n.children ?? []) walk(c, level + 1);
  };
  for (const c of page.children ?? []) walk(c, 0);
  if (total > lines.length)
    lines.push(`… ${total - lines.length} more layers (read them with get_outline or get_node)`);
  return lines;
}

interface VariableList {
  collections?: { id: string; name: string; modes?: { id: string; name: string }[] }[];
  variables?: {
    id: string;
    name: string;
    collection: string;
    resolvedType?: string;
    values?: Record<string, { type?: string; value?: unknown } | undefined>;
  }[];
}

function variableValue(
  v: { type?: string; value?: unknown } | undefined,
  names: Map<string, string>,
) {
  if (!v) return '?';
  const x = v.value;
  if (v.type === 'alias' || (x && typeof x === 'object' && 'id' in (x as object))) {
    const id = String((x as { id?: unknown })?.id ?? x);
    return `→ ${names.get(id) ?? id}`;
  }
  const c = compactValue(x);
  return typeof c === 'string' ? c : JSON.stringify(c);
}

/** `Collection: name = value` per variable (the collection's first mode). */
export function variableLines(list: unknown, max: number = CONTEXT_LIMITS.variables): string[] {
  const l = (list ?? {}) as VariableList;
  const collections = new Map((l.collections ?? []).map((c) => [c.id, c]));
  const names = new Map((l.variables ?? []).map((v) => [v.id, v.name]));
  const vars = l.variables ?? [];
  const lines = vars.slice(0, max).map((v) => {
    const col = collections.get(v.collection);
    const mode = col?.modes?.[0]?.id;
    const value = variableValue(mode ? v.values?.[mode] : Object.values(v.values ?? {})[0], names);
    return `${col?.name ?? v.collection}: ${v.name} = ${value}`;
  });
  if (vars.length > max) lines.push(`… ${vars.length - max} more (variable.list)`);
  return lines;
}

interface StyleEntry {
  id: string;
  name: string;
  type: string;
  paints?: unknown[];
  effects?: unknown[];
  [k: string]: unknown;
}

/** `type name (id): summary` per style. */
export function styleLines(list: unknown, max: number = CONTEXT_LIMITS.styles): string[] {
  const styles = Array.isArray(list) ? (list as StyleEntry[]) : [];
  const lines = styles.slice(0, max).map((s) => {
    const { id, name, type, description: _d, ...rest } = s;
    const value = compactValue(rest) as Record<string, unknown>;
    const summary = oneLine(JSON.stringify(value), 120);
    return `${type} "${name}" (${id}): ${summary}`;
  });
  if (styles.length > max) lines.push(`… ${styles.length - max} more (style.list)`);
  return lines;
}

/** Read the selection subtree, the page outline, variables and styles; never throws for empties. */
export async function buildTurnContext(
  editor: Editor,
  opts: TurnContextOptions = {},
): Promise<TurnContext> {
  const doc = await editor.inspect({ depth: CONTEXT_LIMITS.outlineDepth, outline: true });
  const page = doc.pages.find((p) => p.id === doc.currentPage) ?? { id: doc.currentPage };
  const selection = [...(opts.selection ?? doc.selection)];
  const parts: string[] = [`Page: "${oneLine(String(page.name ?? ''), 60)}" (${page.id})`];

  const scope: NodeId[] = [];
  if (selection.length) {
    const read: unknown[] = [];
    for (const id of selection.slice(0, CONTEXT_LIMITS.selectionLayers)) {
      const n = await editor.getNode(id, {
        depth: CONTEXT_LIMITS.selectionDepth,
        fields: CONTEXT_FIELDS,
      });
      if (!n) continue;
      scope.push(id);
      read.push(compactValue(n));
    }
    for (const id of selection.slice(CONTEXT_LIMITS.selectionLayers)) scope.push(id);
    if (scope.length) {
      parts.push(
        `Selected (the scope): ${scope.join(', ')}. Change only these layers and their descendants; an edit outside them is undone.`,
      );
      parts.push(
        `<selection>\n${clip(JSON.stringify(read), CONTEXT_LIMITS.selectionChars, 'read deeper layers with get_node')}\n</selection>`,
      );
    }
  }
  if (!scope.length)
    parts.push(
      'Nothing is selected: the whole page is in scope. Read layers with get_node before editing.',
    );

  parts.push(`<outline>\n${outlineLines(page).join('\n')}\n</outline>`);

  const variables = variableLines(await editor.execute('variable.list', {}).catch(() => null));
  if (variables.length) parts.push(`<variables>\n${variables.join('\n')}\n</variables>`);
  const styles = styleLines(await editor.execute('style.list', {}).catch(() => null));
  if (styles.length) parts.push(`<styles>\n${styles.join('\n')}\n</styles>`);

  const text = `<document>\n${parts.join('\n')}\n</document>`;
  return { text, scope: scope.length ? scope : null, page: page.id, tokens: estimateTokens(text) };
}
