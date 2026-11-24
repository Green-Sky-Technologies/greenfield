/**
 * Turns `figcraft.commands()` metadata into TypeScript (pure: no browser, unit-tested).
 *
 * Inputs per command:
 * - `params`: the editor's parameter doc, a terse mini-language such as
 *   `{type: rectangle|ellipse, x?, parent? (id; default: the page), text? | characters?, props? {node.set keys}}`
 * - `takes`: the parameter names the engine itself accepts, read from its error for an unknown
 *   parameter (`… (it takes type, x, y, …)`). This is the source of truth for which keys exist;
 *   the doc adds optionality, types where it states them, and the doc comments.
 *
 * Types come from, in order: an explicit `: a|b` or `: bool` in the doc, an exact enum in
 * parentheses `(fill|fit|crop)`, an object or list shape (`{…}`, `[…]`), then a small table of
 * well-known names (`x` is a number, `name` a string, `ids` layer ids…). Anything else is
 * `unknown`, with the doc text as its TSDoc comment.
 */
import { createHash } from 'node:crypto';

export interface CommandMeta {
  id: string;
  label: string;
  menu: string | null;
  params: string;
  shortcut: string | null;
  undoable: boolean;
}

export interface ParsedParam {
  name: string;
  optional: boolean;
  /** A TypeScript type expression. */
  type: string;
  doc: string;
}

/** Split at `sep` where not nested in (), [], {} or a "string". */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"') quote = !quote;
    if (quote) continue;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Index just past the bracket that closes the one at `open`, or -1. */
function closeOf(s: string, open: number): number {
  let depth = 0;
  let quote = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"') quote = !quote;
    if (quote) continue;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const ENUM_TOKEN = /^[\w.-]+$/;

function literal(token: string): string {
  if (token === 'null') return 'null';
  if (token === 'true' || token === 'false') return token;
  if (/^-?\d+(\.\d+)?$/.test(token)) return token;
  return `'${token}'`;
}

/** `a|b|c` → `'a' | 'b' | 'c'`, or null when it isn't a plain enum. */
export function enumType(s: string): string | null {
  const parts = s.trim().split('|');
  if (parts.length < 2 || !parts.every((p) => ENUM_TOKEN.test(p))) return null;
  return [...new Set(parts.map(literal))].join(' | ');
}

const NUMBER = new Set(
  (
    'x y width height rotation index dx dy depth limit scale strokeWeight gap crossGap columnGap ' +
    'rowGap paddingTop paddingRight paddingBottom paddingLeft minWidth maxWidth minHeight maxHeight ' +
    'gridColumns gridRows gridColumn gridRow gridColumnSpan gridRowSpan fontSize paragraphSpacing ' +
    'paragraphIndent listSpacing maxLines pointCount innerRadius arcStart arcSweep arcInner ' +
    'cornerSmoothing strokeTopWeight strokeRightWeight strokeBottomWeight strokeLeftWeight ' +
    'miterAngle miterLimit fuel offset start end indentation'
  ).split(' '),
);
const STRING = new Set(
  'name text characters label description fontFamily fontStyle url title author filter data'.split(
    ' ',
  ),
);
const BOOLEAN = new Set(
  (
    'select closed deep force replace visible locked clip isMask wrap absolute strokesIncluded ' +
    'reverseZ hangingPunctuation hangingList constrainProportions textDecorationSkipInk map reload'
  ).split(' '),
);

/** Command namespaces whose `id`/`ids`/`parent` are layer ids. */
const LAYER_NAMESPACES = new Set(
  (
    'node shape frame text edit align arrange distribute layout object transform bool fill stroke ' +
    'effect select selection component instance image vector mask group'
  ).split(' '),
);

export interface TypeContext {
  /** The command id (for `id`/`ids` typing); undefined for node.set props. */
  command?: string;
}

function nameType(name: string, ctx: TypeContext): string | null {
  const ns = ctx.command?.split('.')[0];
  const layer = ctx.command === undefined || (ns !== undefined && LAYER_NAMESPACES.has(ns));
  if (name === 'ids') return layer ? 'NodeId[]' : '(number | string)[]';
  if (name === 'id') return layer ? 'NodeId' : 'number | string';
  if (name === 'parent') return layer ? 'NodeId' : null;
  if (name === 'props') return 'NodeProps';
  if (NUMBER.has(name)) return 'number';
  if (STRING.has(name)) return 'string';
  if (BOOLEAN.has(name)) return 'boolean';
  return null;
}

interface Head {
  names: string[];
  optional: boolean;
  rest: string;
}

/** `paddingTop/Right/Bottom/Left` → paddingTop, paddingRight, …; `a / b` → a, b. */
function expandSlashes(raw: string[]): string[] {
  const first = raw[0]!;
  if (raw.slice(1).every((n) => /^[A-Z]/.test(n)) && /[A-Z][a-z]*$/.test(first)) {
    const prefix = first.replace(/[A-Z][a-z]*$/, '');
    return [first, ...raw.slice(1).map((n) => prefix + n)];
  }
  return raw;
}

function parseHead(item: string): Head | null {
  const m = /^([A-Za-z_][\w]*)(\?)?((?:\s*\/\s*[A-Za-z_][\w]*\??)*)/.exec(item);
  if (!m) return null;
  const more = (m[3] ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  const optional = m[2] === '?' || more.some((n) => n.endsWith('?'));
  const names = expandSlashes([m[1]!, ...more.map((n) => n.replace(/\?$/, ''))]);
  return { names, optional, rest: item.slice(m[0].length) };
}

/** Explicit type and doc text from what follows a parameter's name. */
function parseTail(
  rest: string,
  name: string,
  ctx: TypeContext,
): { type: string | null; doc: string } {
  let type: string | null = null;
  let r = rest.trim();
  const docs: string[] = [];
  if (r.startsWith(':')) {
    r = r.slice(1).trim();
    // The type expression is a bracketed shape, or runs to the first bracket after a space.
    let end = r.length;
    if (r.startsWith('{') || r.startsWith('[')) {
      const close = closeOf(r, 0);
      if (close > 0) end = close;
    } else {
      for (const open of [' (', ' {', ' [']) {
        const i = r.indexOf(open);
        if (i >= 0 && i < end) end = i;
      }
    }
    const expr = r.slice(0, end).trim();
    r = r.slice(end).trim();
    if (/^(bool|boolean)$/.test(expr)) type = 'boolean';
    else if (/^(number|int|integer|float)$/.test(expr)) type = 'number';
    else if (expr === 'string') type = 'string';
    else if (expr.startsWith('[')) type = 'unknown[]';
    else if (expr.startsWith('{')) type = 'Record<string, unknown>';
    else type = enumType(expr);
    if (expr) docs.push(expr);
  }
  while (r.length) {
    const c = r[0]!;
    if (c === '(' || c === '[' || c === '{') {
      const end = closeOf(r, 0);
      const inner = r.slice(1, end < 0 ? r.length : end - 1).trim();
      r = end < 0 ? '' : r.slice(end).trim();
      if (c === '(') {
        const e = enumType(inner);
        if (e && type === null) type = e;
        docs.push(inner);
      } else if (c === '[') {
        if (type === null && name !== 'ids') type = 'unknown[]';
        docs.push(`[${inner}]`);
      } else {
        if (type === null && name !== 'props') type = 'Record<string, unknown>';
        docs.push(`{${inner}}`);
      }
    } else {
      docs.push(r);
      r = '';
    }
  }
  const doc = docs.join(' ').trim();
  type ??= nameType(name, ctx);
  if (type && type !== 'unknown' && /\bnull\b/.test(doc) && !type.includes('null')) {
    type = `${type} | null`;
  }
  return { type, doc };
}

/** One comma-separated item, possibly ` | `-separated alternatives (all optional then). */
function parseItem(item: string, ctx: TypeContext): ParsedParam[] {
  const alts = splitTop(item.trim(), ' | ');
  const out: ParsedParam[] = [];
  for (const alt of alts) {
    const head = parseHead(alt.trim());
    if (!head) {
      // A value form of the previous key (`value | {alias: variable}`): its type is wider.
      const prev = out[out.length - 1];
      if (prev) {
        prev.type = 'unknown';
        prev.doc = [prev.doc, alt.trim()].filter(Boolean).join(' | ');
      }
      continue;
    }
    const tail = parseTail(head.rest, head.names[0]!, ctx);
    for (const name of head.names) {
      out.push({
        name,
        optional: head.optional || alts.length > 1,
        type: tail.type ?? nameType(name, ctx) ?? 'unknown',
        doc: tail.doc,
      });
    }
  }
  return out;
}

/**
 * Parse a parameter doc. `{…}` docs give an object's keys; a bare list (node.set's props) is
 * parsed the same way. Returns the keys found and the text after the braces (results, notes).
 */
export function parseParamDoc(
  doc: string,
  ctx: TypeContext = {},
): { params: ParsedParam[]; rest: string } {
  const s = doc.trim();
  let inner: string;
  let rest = '';
  if (s.startsWith('{')) {
    const end = closeOf(s, 0);
    inner = s.slice(1, end < 0 ? s.length : end - 1);
    rest = end < 0 ? '' : s.slice(end).trim();
  } else {
    inner = s;
  }
  const params: ParsedParam[] = [];
  for (const item of splitTop(inner, ',')) {
    if (!item.trim()) continue;
    for (const p of parseItem(item, ctx)) {
      if (!params.some((q) => q.name === p.name)) params.push(p);
    }
  }
  return { params, rest };
}

/** The keys the engine accepts, from `… (it takes a, b, c)` or `… (it takes none)`. */
export function parseTakes(message: string): string[] | null {
  const m = /\(it takes ([^)]*)\)\s*$/.exec(message);
  if (!m) return null;
  return m[1]!.trim() === 'none'
    ? []
    : m[1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/** The node field names, from `document.inspect`'s error for an unknown field. */
export function parseFieldKeys(message: string): string[] | null {
  const m = /valid keys: (.*)$/.exec(message);
  return m
    ? m[1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
}

/** sha256 of the command list in a canonical form (sorted by id, fixed key order). */
export function hashCommands(commands: readonly CommandMeta[]): string {
  const canon = [...commands]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => [c.id, c.label, c.menu, c.params, c.shortcut, c.undoable]);
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

const tsDoc = (lines: string[], indent: string) => {
  const text = lines
    .join('\n')
    .replace(/\*\//g, '*\\/')
    .split('\n')
    .map((l) => `${indent} * ${l}`.trimEnd());
  return `${indent}/**\n${text.join('\n')}\n${indent} */\n`;
};

const key = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`);

export interface CommandTypeStats {
  commands: number;
  /** Commands typed from the engine's key list (exact keys). */
  exactKeys: number;
  /** Commands with no key list (`Record<string, unknown>`). */
  fallback: number;
  /** The engine's parameters (all commands) with a concrete type vs `unknown`. */
  typedParams: number;
  unknownParams: number;
  /** node.set props with a concrete type vs `unknown`. */
  typedProps: number;
  unknownProps: number;
}

export interface GenerateInput {
  editorVersion: string;
  editorSha256: string;
  commands: CommandMeta[];
  /** Engine-accepted keys per command id; missing = unknown (fallback type). */
  takes: Record<string, string[]>;
  nodeFields: string[];
}

/** The TypeScript module `src/generated/commands.ts` (unformatted; the script runs prettier). */
export function generateModule(input: GenerateInput): { source: string; stats: CommandTypeStats } {
  const hash = hashCommands(input.commands);
  const commands = [...input.commands].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stats: CommandTypeStats = {
    commands: commands.length,
    exactKeys: 0,
    fallback: 0,
    typedParams: 0,
    unknownParams: 0,
    typedProps: 0,
    unknownProps: 0,
  };

  // node.set's doc is the list of layer props.
  const nodeSet = commands.find((c) => c.id === 'node.set');
  const props = nodeSet ? parseParamDoc(nodeSet.params).params : [];
  let out = '';
  out += `// GENERATED by \`pnpm --filter @greenfield/bridge generate\` from figcraft-web ${input.editorVersion}.\n`;
  out +=
    '// Do not edit. `pnpm --filter @greenfield/bridge check:commands` fails when the pinned\n';
  out += "// editor's command list no longer matches COMMANDS_HASH.\n";
  out += "import type { CommandInfo, NodeId } from '../types';\n\n";
  out += `export const EDITOR_VERSION = '${input.editorVersion}';\n`;
  out += `/** sha256 of the pinned release archive. */\n`;
  out += `export const EDITOR_RELEASE_SHA256 = '${input.editorSha256}';\n`;
  out += `/** sha256 of \`figcraft.commands()\` in canonical form (see scripts/command-types.ts). */\n`;
  out += `export const COMMANDS_HASH = '${hash}';\n`;
  out += `export const COMMAND_COUNT = ${commands.length};\n\n`;
  out += `/** Layer keys \`document.inspect\` and \`node.get\` accept in \`fields\`. */\n`;
  out += `export const NODE_FIELDS = ${JSON.stringify(input.nodeFields)} as const;\n`;
  out += 'export type NodeField = (typeof NODE_FIELDS)[number];\n\n';
  out += `/** Layer properties \`node.set\` accepts (in \`props\`, or flat beside \`ids\`). */\n`;
  out += `export const NODE_SET_PROPS = ${JSON.stringify(props.map((p) => p.name))} as const;\n\n`;
  out += '/** Layer properties for `node.set` (and `props` of the create commands). */\n';
  out += 'export interface NodeProps {\n';
  for (const p of props) {
    if (p.type === 'unknown') stats.unknownProps++;
    else stats.typedProps++;
    if (p.doc) out += tsDoc([p.doc], '  ');
    out += `  ${key(p.name)}?: ${p.type};\n`;
  }
  out += '}\n\n';

  out += '/** Parameters per command id, from the pinned editor. */\n';
  out += 'export interface CommandParamsMap {\n';
  for (const c of commands) {
    const head = [
      `${c.label}${c.menu ? ` [${c.menu}]` : ''}${c.shortcut ? ` (${c.shortcut})` : ''}${c.undoable ? ' · undoable' : ''}`,
      '',
      '`' + c.params.replace(/`/g, "'") + '`',
    ];
    out += tsDoc(head, '  ');
    const takes = input.takes[c.id];
    if (!takes) {
      stats.fallback++;
      out += `  ${key(c.id)}: Record<string, unknown>;\n`;
      continue;
    }
    stats.exactKeys++;
    if (c.id === 'node.set') {
      out += `  ${key(c.id)}: NodeProps & { ids?: NodeId[]; id?: NodeId; props?: NodeProps };\n`;
      continue;
    }
    const ctx = { command: c.id };
    const doc = parseParamDoc(c.params, ctx).params;
    const names = [...takes];
    // `ids` and `id` are always taken (docs/control-protocol.md › engine.execute).
    for (const always of ['ids', 'id']) if (!names.includes(always)) names.push(always);
    out += `  ${key(c.id)}: {\n`;
    for (const name of names) {
      const p = doc.find((d) => d.name === name);
      const type = p?.type ?? nameType(name, ctx) ?? 'unknown';
      const optional = p ? p.optional : true;
      // Count the engine's own keys, not the `id`/`ids` added to every command.
      if (takes.includes(name)) {
        if (type === 'unknown') stats.unknownParams++;
        else stats.typedParams++;
      }
      if (p?.doc) out += tsDoc([p.doc], '    ');
      out += `    ${key(name)}${optional ? '?' : ''}: ${type};\n`;
    }
    out += '  };\n';
  }
  out += '}\n\n';

  const meta = commands.map((c) => ({ ...c, takes: input.takes[c.id] ?? null }));
  out +=
    '/** Every command of the pinned editor, as `figcraft.commands()` lists it, plus `takes`. */\n';
  out += `export const COMMANDS: readonly CommandInfo[] = ${JSON.stringify(meta)};\n`;
  return { source: out, stats };
}
