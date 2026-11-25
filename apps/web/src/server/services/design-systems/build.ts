/**
 * Writing a design system's library file and guide from the tokens of a codebase (Story 10.2).
 *
 * The document is written the way the pinned editor (figcraft-web 0.18.1) saves one: colour
 * collections (one per colour family, `Theme` for named roles, with a Dark mode when the source
 * has one), Spacing and Radius number collections, text styles for the type scale, and the core
 * components (Button, Input, Card, Nav) as auto layout components whose fills, gaps, padding and
 * radii are bound to those variables and whose text uses the text styles. Names, not ids, are what
 * stays stable between builds; a library update (10.6) matches by name.
 */
import type { FigcraftDocument } from './library-file';
import { CORE_COMPONENTS, type ColourToken, type ScaleToken, type Tokens } from './tokens';

type Json = Record<string, unknown>;

const rgba = (hex: string) => {
  const n = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2) || 'ff', 16) / 255;
  return { r: n(0), g: n(1), b: n(2), a: n(3) };
};
const luminance = (hex: string) => {
  const { r, g, b } = rgba(hex);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const NEUTRAL = /^(gray|grey|slate|zinc|neutral|stone|ink|paper|sand|base)$/i;

/** The colours the core components use, picked by role name, then by family. */
export function colourRoles(colours: ColourToken[]) {
  const by = (re: RegExp) => colours.find((c) => re.test(c.name));
  /** The first of `names` the system has, in that order. */
  const named = (...names: string[]) =>
    names.map((n) => colours.find((c) => c.name === n)).find(Boolean);
  const shade = (group: RegExp, shades: string[]) => {
    for (const s of shades) {
      const c = colours.find((x) => group.test(x.group) && x.name.endsWith(`/${s}`));
      if (c) return c;
    }
    return undefined;
  };
  const families = [...new Set(colours.filter((c) => c.group !== 'Theme').map((c) => c.group))];
  const brandFamily =
    families.find((f) => /^(primary|brand|accent)$/i.test(f)) ??
    families.find((f) => !NEUTRAL.test(f));
  const neutral = families.find((f) => NEUTRAL.test(f));
  const fam = (f: string | undefined) => (f ? new RegExp(`^${f}$`) : /$^/);
  const primary =
    named('primary', 'brand', 'accent') ??
    shade(fam(brandFamily), ['600', '500', '700', '400']) ??
    by(/^(primary|brand|accent|field)/) ??
    colours.find(
      (c) =>
        c.group === 'Theme' &&
        !/background|foreground|bg|text|ink|border|muted|surface/.test(c.name),
    );
  const background =
    named('background', 'bg', 'surface', 'paper', 'ground', 'panel') ??
    shade(fam(neutral), ['50', '100']);
  const foreground =
    named('foreground', 'text', 'ink', 'fg') ?? shade(fam(neutral), ['900', '950', '800']);
  const border = named('border', 'input', 'rule', 'line') ?? shade(fam(neutral), ['200', '300']);
  const muted =
    named('muted-foreground', 'muted', 'body', 'subtle') ?? shade(fam(neutral), ['500', '600']);
  const onPrimary =
    named('primary-foreground', 'on-primary', 'accent-ink', 'primary-ink', 'brand-foreground') ??
    null;
  return { primary, background, foreground, border, muted, onPrimary };
}

// ---- ids ----

class Ids {
  private node = 2;
  private variable = 1;
  private collection = 1;
  private style = 1;
  nextNode = () => this.node++;
  nextVariable = () => `VariableID:${this.variable++}`;
  nextCollection = () => `VariableCollectionId:${this.collection++}`;
  nextStyle = () => `S:${this.style++}`;
  get nextNodeId() {
    return this.node;
  }
}

// ---- variables ----

interface Built {
  collections: Json[];
  variables: Json[];
  /** name → variable id. */
  byName: Map<string, string>;
}

function buildVariables(tokens: Tokens, ids: Ids): Built {
  const collections: Json[] = [];
  const variables: Json[] = [];
  const byName = new Map<string, string>();
  const groups = new Map<string, ColourToken[]>();
  for (const c of tokens.colours) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  // Named roles first, then the families in source order.
  const order = [...groups.keys()].sort((a, b) => Number(b === 'Theme') - Number(a === 'Theme'));
  for (const group of order) {
    const list = groups.get(group)!;
    const id = ids.nextCollection();
    const dark = list.some((c) => c.dark);
    const modes = [{ id: `${id}/mode1`, name: dark ? 'Light' : 'Mode 1' }];
    if (dark) modes.push({ id: `${id}/mode2`, name: 'Dark' });
    collections.push({ id, name: group, modes });
    for (const c of list) {
      const vid = ids.nextVariable();
      byName.set(c.name, vid);
      const values: Json = { [`${id}/mode1`]: { type: 'color', value: rgba(c.hex) } };
      if (dark) values[`${id}/mode2`] = { type: 'color', value: rgba(c.dark ?? c.hex) };
      variables.push({
        id: vid,
        name: c.name,
        collection: id,
        resolvedType: 'color',
        values,
        description: '',
      });
    }
  }
  const numbers = (name: string, list: ScaleToken[]) => {
    if (!list.length) return;
    const id = ids.nextCollection();
    collections.push({ id, name, modes: [{ id: `${id}/mode1`, name: 'Mode 1' }] });
    for (const s of list) {
      const vid = ids.nextVariable();
      byName.set(s.name, vid);
      variables.push({
        id: vid,
        name: s.name,
        collection: id,
        resolvedType: 'number',
        values: { [`${id}/mode1`]: { type: 'number', value: s.value } },
        description: '',
      });
    }
  };
  numbers('Spacing', tokens.spacing);
  numbers('Radius', tokens.radius);
  return { collections, variables, byName };
}

// ---- text styles ----

const textStyle = (family: string, style: string, size: number, lineHeight: number | null) => ({
  font_family: family,
  font_style: style,
  font_size: size,
  line_height: lineHeight ? { unit: 'pixels', value: lineHeight } : { unit: 'auto' },
  letter_spacing: { unit: 'percent', value: 0 },
  decoration: 'none',
  case: 'original',
  fills: null,
  link: null,
});

/** Headings for the steps from `xl` up, body text below; the guide says which is which. */
function buildStyles(tokens: Tokens, ids: Ids) {
  const sans = tokens.fonts.sans ?? 'Inter';
  const heading = tokens.fonts.heading ?? sans;
  const styles: (Json & { id: string; name: string; style: ReturnType<typeof textStyle> })[] = [];
  for (const t of tokens.type) {
    const isHeading = t.size >= 20;
    styles.push({
      id: ids.nextStyle(),
      name: `${isHeading ? 'heading' : 'body'}/${t.step}`,
      description: '',
      type: 'text',
      style: textStyle(
        isHeading ? heading : sans,
        isHeading ? 'Semi Bold' : 'Regular',
        t.size,
        t.lineHeight,
      ),
    });
  }
  if (!styles.length)
    styles.push({
      id: ids.nextStyle(),
      name: 'body/base',
      description: '',
      type: 'text',
      style: textStyle(sans, 'Regular', 16, 24),
    });
  return styles;
}

// ---- components ----

const solid = (hex: string) => ({
  type: 'solid',
  color: rgba(hex),
  opacity: 1,
  visible: true,
  blend: 'normal',
});
const childLayout = (h: string, v: string) => ({
  sizing_h: h,
  sizing_v: v,
  absolute: false,
  min_w: null,
  max_w: null,
  min_h: null,
  max_h: null,
  grid_column: null,
  grid_row: null,
  grid_column_span: 0,
  grid_row_span: 0,
});
const layout = (
  mode: 'horizontal' | 'vertical',
  gap: number,
  padding: number[],
  main = 'min',
  cross = 'center',
) => ({
  mode,
  wrap: false,
  gap,
  cross_gap: 0,
  padding,
  main_align: main,
  cross_align: cross,
  content_align: 'auto',
  grid_columns: 2,
  grid_rows: 2,
  column_tracks: [],
  row_tracks: [],
  strokes_included: true,
  reverse_z: false,
});
/** A rough text width (the editor lays text out again when it opens the file). */
const textWidth = (s: string, size: number) => Math.ceil(s.length * size * 0.56);

interface Ctx {
  ids: Ids;
  nodes: Record<string, Json>;
  vars: Map<string, string>;
  styles: ReturnType<typeof buildStyles>;
  hex: Map<string, string>;
}

function nearest(list: ScaleToken[], want: number): ScaleToken | null {
  let best: ScaleToken | null = null;
  for (const s of list)
    if (!best || Math.abs(s.value - want) < Math.abs(best.value - want)) best = s;
  return best;
}

function textNode(
  ctx: Ctx,
  parent: number,
  text: string,
  styleName: string,
  colour: string | undefined,
): number {
  const id = ctx.ids.nextNode();
  const style = ctx.styles.find((s) => s.name === styleName) ?? ctx.styles[0]!;
  const fill = colour ? ctx.hex.get(colour) : undefined;
  ctx.nodes[id] = {
    id,
    name: text,
    type: 'text',
    characters: text,
    style: { ...style.style, style_id: style.id },
    parent,
    blend: 'normal',
    transform: [1, 0, 0, 1, 0, 0],
    width: textWidth(text, style.style.font_size),
    height: Math.ceil(style.style.line_height.value ?? style.style.font_size * 1.25),
    fills: [solid(fill ?? '#111111')],
    child_layout: childLayout('hug', 'hug'),
    styles: { fill: null, stroke: null, effect: null, grid: null, text: style.id },
    ...(colour && ctx.vars.has(colour) ? { bound: { fill: ctx.vars.get(colour) } } : {}),
  };
  return id;
}

interface FrameSpec {
  name: string;
  type: 'component' | 'frame';
  parent: number;
  x?: number;
  y?: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  radius?: ScaleToken | null;
  layout: ReturnType<typeof layout>;
  gap?: ScaleToken | null;
  padH?: ScaleToken | null;
  padV?: ScaleToken | null;
  sizing: [string, string];
}

function frameNode(ctx: Ctx, f: FrameSpec): number {
  const id = ctx.ids.nextNode();
  const bound: Json = {};
  const bind = (field: string, name: string | undefined) => {
    if (name && ctx.vars.has(name)) bound[field] = ctx.vars.get(name);
  };
  bind('fill', f.fill);
  bind('stroke', f.stroke);
  bind('cornerRadius', f.radius?.name);
  bind('gap', f.gap?.name);
  bind('paddingHorizontal', f.padH?.name);
  bind('paddingVertical', f.padV?.name);
  const r = f.radius?.value ?? 0;
  ctx.nodes[id] = {
    id,
    name: f.name,
    type: f.type,
    ...(f.type === 'component' ? { description: '', props: {} } : {}),
    parent: f.parent,
    children: [],
    transform: [1, 0, 0, 1, f.x ?? 0, f.y ?? 0],
    width: f.width,
    height: f.height,
    fills: f.fill && ctx.hex.has(f.fill) ? [solid(ctx.hex.get(f.fill)!)] : [],
    ...(f.stroke && ctx.hex.has(f.stroke) ? { strokes: [solid(ctx.hex.get(f.stroke)!)] } : {}),
    ...(r ? { corners: { radii: [r, r, r, r], smoothing: 0 } } : {}),
    layout: f.layout,
    child_layout: childLayout(f.sizing[0], f.sizing[1]),
    clip: true,
    ...(Object.keys(bound).length ? { bound } : {}),
  };
  const parent = ctx.nodes[f.parent];
  if (parent) (parent.children as number[]).push(id);
  return id;
}

function addChild(ctx: Ctx, parent: number, child: number) {
  (ctx.nodes[parent]!.children as number[]).push(child);
}

function radiusFromClasses(tokens: Tokens, classes: string[]): ScaleToken | null {
  const r = classes.find((c) => /^rounded(-|$)/.test(c));
  if (!r) return null;
  const key = r === 'rounded' ? 'default' : r.slice('rounded-'.length);
  return tokens.radius.find((x) => x.name === `radius/${key}`) ?? null;
}

function buildComponents(ctx: Ctx, tokens: Tokens, page: number): string[] {
  const roles = colourRoles(tokens.colours);
  const s = (px: number) => nearest(tokens.spacing, px);
  const radius = (name: string, fallback: number) =>
    radiusFromClasses(tokens, tokens.components.find((c) => c.name === name)?.classes ?? []) ??
    nearest(tokens.radius, fallback);
  const onPrimary =
    roles.onPrimary?.name ??
    (roles.primary && luminance(roles.primary.hex) < 0.4
      ? roles.background?.name
      : roles.foreground?.name);
  const body =
    ctx.styles.find((x) => x.name === 'body/base' || x.name === 'body/sm')?.name ??
    ctx.styles[0]!.name;
  const small = ctx.styles.find((x) => x.name === 'body/sm')?.name ?? body;
  const title =
    ctx.styles.find((x) => x.name === 'heading/xl' || x.name === 'heading/2xl')?.name ??
    ctx.styles.at(-1)!.name;
  const built: string[] = [];
  let x = 0;
  const place = (w: number) => {
    const at = x;
    x += w + 80;
    return at;
  };

  // Button: primary fill, label in the "on primary" colour.
  const bh = s(16);
  const bv = s(8);
  const button = frameNode(ctx, {
    name: 'Button',
    type: 'component',
    parent: page,
    x: place(120),
    width: 120,
    height: 40,
    fill: roles.primary?.name,
    radius: radius('Button', 6),
    layout: layout(
      'horizontal',
      s(8)?.value ?? 8,
      [bv?.value ?? 8, bh?.value ?? 16, bv?.value ?? 8, bh?.value ?? 16],
      'center',
    ),
    gap: s(8),
    padH: bh,
    padV: bv,
    sizing: ['hug', 'hug'],
  });
  addChild(ctx, button, textNode(ctx, button, 'Button', small, onPrimary));
  built.push('Button');

  // Input: a bordered field with placeholder text.
  const input = frameNode(ctx, {
    name: 'Input',
    type: 'component',
    parent: page,
    x: place(240),
    width: 240,
    height: 40,
    fill: roles.background?.name,
    stroke: roles.border?.name,
    radius: radius('Input', 6),
    layout: layout('horizontal', s(8)?.value ?? 8, [
      s(8)?.value ?? 8,
      s(12)?.value ?? 12,
      s(8)?.value ?? 8,
      s(12)?.value ?? 12,
    ]),
    gap: s(8),
    padH: s(12),
    padV: s(8),
    sizing: ['fixed', 'hug'],
  });
  addChild(ctx, input, textNode(ctx, input, 'Placeholder', small, roles.muted?.name));
  built.push('Input');

  // Card: title and body text in a padded, bordered surface.
  const card = frameNode(ctx, {
    name: 'Card',
    type: 'component',
    parent: page,
    x: place(320),
    width: 320,
    height: 160,
    fill: roles.background?.name,
    stroke: roles.border?.name,
    radius: radius('Card', 12),
    layout: layout('vertical', s(8)?.value ?? 8, Array(4).fill(s(24)?.value ?? 24), 'min', 'min'),
    gap: s(8),
    padH: s(24),
    padV: s(24),
    sizing: ['fixed', 'hug'],
  });
  addChild(ctx, card, textNode(ctx, card, 'Card title', title, roles.foreground?.name));
  addChild(
    ctx,
    card,
    textNode(ctx, card, 'Supporting text for the card.', body, roles.muted?.name),
  );
  built.push('Card');

  // Nav: a bar with a brand, links and a button-like call to action.
  const nav = frameNode(ctx, {
    name: 'Nav',
    type: 'component',
    parent: page,
    x: place(960),
    width: 960,
    height: 64,
    fill: roles.background?.name,
    stroke: roles.border?.name,
    layout: layout(
      'horizontal',
      s(32)?.value ?? 32,
      [s(16)?.value ?? 16, s(24)?.value ?? 24, s(16)?.value ?? 16, s(24)?.value ?? 24],
      'min',
      'center',
    ),
    gap: s(32),
    padH: s(24),
    padV: s(16),
    sizing: ['fixed', 'hug'],
  });
  addChild(ctx, nav, textNode(ctx, nav, 'Brand', body, roles.foreground?.name));
  for (const link of ['Product', 'Pricing', 'About'])
    addChild(ctx, nav, textNode(ctx, nav, link, small, roles.muted?.name));
  built.push('Nav');
  return built;
}

// ---- the document ----

export interface BuiltLibrary {
  doc: FigcraftDocument;
  /** The core components built. */
  components: string[];
}

export function buildLibraryDocument(name: string, tokens: Tokens): BuiltLibrary {
  const ids = new Ids();
  const vars = buildVariables(tokens, ids);
  const styles = buildStyles(tokens, ids);
  const pageId = 1;
  const nodes: Record<string, Json> = {
    [pageId]: {
      id: pageId,
      name: 'Components',
      type: 'page',
      background: { r: 0.9607843, g: 0.9607843, b: 0.9607843, a: 1 },
      flows: [],
      prototype: {
        device: 'None',
        background: { r: 0.11764706, g: 0.11764706, b: 0.11764706, a: 1 },
        rotation: 'portrait',
      },
      children: [],
      width: 0,
      height: 0,
    },
  };
  const ctx: Ctx = {
    ids,
    nodes,
    vars: vars.byName,
    styles,
    hex: new Map(tokens.colours.map((c) => [c.name, c.hex])),
  };
  const components = buildComponents(ctx, tokens, pageId);
  const doc: FigcraftDocument = {
    format: 'figcraft',
    version: 1,
    imageIndex: [],
    name,
    pages: [pageId],
    nodes,
    next_id: ids.nextNodeId,
    styles,
    variables: { collections: vars.collections, variables: vars.variables },
    current_page: pageId,
    document_colors: [],
    comments: [],
  };
  return { doc, components };
}

// ---- the guide ----

export function buildGuide(
  name: string,
  tokens: Tokens,
  origin: string,
  components: string[],
): string {
  const roles = colourRoles(tokens.colours);
  const families = [...new Set(tokens.colours.map((c) => c.group))];
  const lines = [
    `# ${name}`,
    '',
    `Built from ${origin}. Edit this guide before publishing: it is what Claude reads before every design.`,
  ];
  lines.push('', '## Colour');
  const role = (label: string, c: ColourToken | undefined | null, use: string) => {
    if (c) lines.push(`- ${label}: \`${c.name}\` (${c.hex}) — ${use}.`);
  };
  role('Primary', roles.primary, 'primary buttons, links and focus; use it sparingly');
  role('Text', roles.foreground, 'headings and body text');
  role('Muted text', roles.muted, 'secondary text, captions, placeholders');
  role('Background', roles.background, 'page and card backgrounds');
  role('Border', roles.border, 'hairlines, input and card borders');
  lines.push(
    `- Collections: ${families.join(', ')}. Bind fills and strokes to these variables; don't type hex values.`,
  );
  if (tokens.colours.some((c) => c.dark))
    lines.push('- The colour collections have Light and Dark modes.');
  if (tokens.type.length) {
    const sans = tokens.fonts.sans ?? 'Inter';
    const heading = tokens.fonts.heading ?? sans;
    lines.push(
      '',
      '## Type',
      `- Headings: ${heading} Semi Bold, \`heading/*\` styles (${tokens.type
        .filter((t) => t.size >= 20)
        .map((t) => `${t.step} ${t.size}`)
        .join(', ')}).`,
      `- Body: ${sans} Regular, \`body/*\` styles (${tokens.type
        .filter((t) => t.size < 20)
        .map((t) => `${t.step} ${t.size}`)
        .join(', ')}). Default to body/base.`,
      ...(tokens.fonts.mono ? [`- Code: ${tokens.fonts.mono}.`] : []),
      '- Apply text styles instead of setting font, size and weight by hand.',
    );
  }
  if (tokens.spacing.length)
    lines.push(
      '',
      '## Spacing',
      `- Gaps and padding come from the \`space/*\` scale: ${tokens.spacing.map((s) => s.value).join(', ')} px.`,
      '- Inside components use the small steps; between sections the large ones. Nothing off the scale.',
    );
  if (tokens.radius.length)
    lines.push(
      '',
      '## Radius',
      `- Corners: ${tokens.radius.map((r) => `\`${r.name}\` ${r.value}`).join(', ')}.`,
    );
  lines.push(
    '',
    '## Components',
    `- In the library: ${components.join(', ')}. Place instances; don't draw your own.`,
  );
  const others = tokens.components
    .map((c) => c.name)
    .filter((n) => !Object.values(CORE_COMPONENTS).some((re) => re.test(n)));
  if (others.length)
    lines.push(
      `- The codebase also has: ${others.slice(0, 40).join(', ')}${others.length > 40 ? ', …' : ''}. Match their look when you build something similar.`,
    );
  return lines.join('\n');
}
