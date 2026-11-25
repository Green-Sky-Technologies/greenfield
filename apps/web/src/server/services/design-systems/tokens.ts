/**
 * Reading a design system out of a codebase (Story 10.2), without running any of its code.
 *
 * Sources, in order of trust:
 * - Tailwind v4 `@theme` blocks (`--color-*`, `--spacing`, `--radius-*`, `--font-*`, `--text-*`);
 * - a Tailwind v3 `tailwind.config.*`, read as an object literal (`theme` and `theme.extend`:
 *   colors, spacing, fontSize, fontFamily, borderRadius); expressions it can't read are skipped;
 * - CSS custom properties anywhere (`:root { --primary: 222 47% 11% }`, shadcn style), which the
 *   two above refer to through `var()`, and which stand in for colours when neither exists;
 * - `next/font` declarations, so `var(--font-plex-sans)` becomes "IBM Plex Sans";
 * - React component files (`Button.tsx`, `ui/card.tsx`, …): their names, and for the core
 *   components the Tailwind classes they use (rounded, padding).
 * Where a Tailwind repo defines no spacing or type scale, Tailwind's defaults are what it uses,
 * so they are what the system gets.
 */

export interface SourceFile {
  path: string;
  text: string;
}

export interface ColourToken {
  /** Variable name: `brand/500`, `primary`, `primary-foreground`. */
  name: string;
  /** Collection: the colour's family (`brand`), or `Theme` for named roles. */
  group: string;
  hex: string;
  /** The dark-mode value, when the source has one (`light-dark()`, `.dark { }`). */
  dark?: string;
}

export interface ScaleToken {
  name: string;
  value: number;
}

export interface TypeToken {
  /** Tailwind step: `xs` … `6xl`. */
  step: string;
  size: number;
  lineHeight: number | null;
}

export interface Tokens {
  colours: ColourToken[];
  spacing: ScaleToken[];
  radius: ScaleToken[];
  type: TypeToken[];
  fonts: { sans: string | null; heading: string | null; mono: string | null };
  /** React components found, by name, with the classes of their root element's className. */
  components: { name: string; path: string; classes: string[] }[];
  /** Whether the codebase uses Tailwind (so its default scales apply). */
  tailwind: boolean;
  /** What was read, for the build's progress and the guide. */
  read: string[];
}

// ---- colours ----

const clamp = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
const hex2 = (n: number) => clamp(n).toString(16).padStart(2, '0');
const toHex = (r: number, g: number, b: number, a = 1) =>
  `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ''}`;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255;
  return [gamma(lin[0]!), gamma(lin[1]!), gamma(lin[2]!)];
}

const num = (s: string | undefined, pct = 1) => {
  if (!s) return NaN;
  const n = parseFloat(s);
  return s.trim().endsWith('%') ? (n / 100) * pct : n;
};

/** `#rgb`, `#rrggbb(aa)`, `rgb()`, `hsl()`, `oklch()`, or a bare HSL triplet (`222 47% 11%`). */
export function parseColour(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m) {
    const h = m[1]!;
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
    return `#${full.length === 8 && full.endsWith('ff') ? full.slice(0, 6) : full}`;
  }
  if (v === 'white') return '#ffffff';
  if (v === 'black') return '#000000';
  m = /^(rgba?|hsla?|oklch)\(\s*([^)]*)\)$/.exec(v);
  const parts = (m ? m[2]! : v).split(/[\s,/]+/).filter(Boolean);
  const alpha = parts[3] !== undefined ? num(parts[3], 1) : 1;
  const fn = m?.[1] ?? (/^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%/.test(v) ? 'hsl' : null);
  if (!fn || parts.length < 3) return null;
  let rgb: [number, number, number];
  if (fn.startsWith('rgb')) rgb = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)];
  else if (fn.startsWith('hsl'))
    rgb = hslToRgb(parseFloat(parts[0]!), num(parts[1], 1), num(parts[2], 1));
  else rgb = oklchToRgb(num(parts[0], 1), num(parts[1], 0.4), parseFloat(parts[2]!) || 0);
  if (rgb.some((c) => !Number.isFinite(c)) || !Number.isFinite(alpha)) return null;
  return toHex(...rgb, alpha);
}

/** px from `16px`, `1rem`, `0.25rem`, `12`. */
export function parseLength(raw: string): number | null {
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(raw.trim());
  if (!m) return null;
  const n = parseFloat(m[1]!);
  const px = m[2] === 'rem' || m[2] === 'em' ? n * 16 : n;
  return Number.isFinite(px) ? Math.round(px * 100) / 100 : null;
}

// ---- CSS ----

interface CssVar {
  value: string;
  /** In a `@theme` block. */
  theme: boolean;
  /** In a dark-mode block (`.dark`, `[data-theme=dark]`, `prefers-color-scheme: dark`). */
  dark: boolean;
}

/** Custom properties of a stylesheet, with where they were declared. */
export function cssVars(css: string): Map<string, CssVar[]> {
  const out = new Map<string, CssVar[]>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Walk the braces, keeping the selector (or at-rule) of each open block.
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      stack.push(text.slice(start, i).trim());
      start = i + 1;
    } else if (ch === '}') {
      const body = text.slice(start, i);
      const where = stack.join(' ');
      for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) {
        const list = out.get(m[1]!) ?? [];
        list.push({
          value: m[2]!.trim(),
          theme: /@theme/.test(where),
          dark: /\.dark|dark\b|prefers-color-scheme:\s*dark/.test(where),
        });
        out.set(m[1]!, list);
      }
      stack.pop();
      start = i + 1;
    } else if (ch === ';' && !stack.length) start = i + 1;
  }
  return out;
}

/** Split `a, b` at top level (not inside parentheses). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

type Resolver = (name: string, dark: boolean) => string | null;

/** Resolve `var()` and `light-dark()` in a value, for the light or dark mode. */
function resolveValue(value: string, lookup: Resolver, dark: boolean, depth = 0): string {
  if (depth > 10) return value;
  let v = value.trim();
  const ld = /^light-dark\(([\s\S]*)\)$/.exec(v);
  if (ld) {
    const [light, darkValue] = splitArgs(ld[1]!);
    v = (dark ? darkValue : light) ?? v;
  }
  return v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name: string, fb?: string) => {
    const found = lookup(name, dark);
    return found !== null ? resolveValue(found, lookup, dark, depth + 1) : (fb ?? '');
  });
}

// ---- a JS object literal reader (for tailwind.config) ----

type Literal = string | number | boolean | null | undefined | Literal[] | { [k: string]: Literal };

/** Read the object literal that starts at `text[start]` (a `{`). Unknown expressions → undefined. */
export function readLiteral(text: string, start: number): Literal {
  let i = start;
  const ws = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (text.startsWith('//', i))
        i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
      else if (text.startsWith('/*', i))
        i = text.indexOf('*/', i) < 0 ? text.length : text.indexOf('*/', i) + 2;
      else return;
    }
  };
  const str = (): string => {
    const q = text[i++]!;
    let out = '';
    while (i < text.length && text[i] !== q) {
      if (text[i] === '\\') i++;
      out += text[i++];
    }
    i++;
    return out;
  };
  /** Skip an expression we can't read, up to the next `,` or closing bracket at this depth. */
  const skip = () => {
    let depth = 0;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '"' || ch === "'" || ch === '`') {
        str();
        continue;
      }
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) {
        if (depth === 0) return;
        depth--;
      }
      if (ch === ',' && depth === 0) return;
      i++;
    }
  };
  const value = (): Literal => {
    ws();
    const ch = text[i];
    if (ch === '{') return object();
    if (ch === '[') {
      i++;
      const arr: Literal[] = [];
      for (;;) {
        ws();
        if (text[i] === ']' || i >= text.length) {
          i++;
          return arr;
        }
        arr.push(value());
        ws();
        if (text[i] === ',') i++;
      }
    }
    if (
      ch === '"' ||
      ch === "'" ||
      (ch === '`' && !text.slice(i, text.indexOf('`', i + 1)).includes('${'))
    ) {
      const s = str();
      ws();
      if (text[i] === ',' || text[i] === '}' || text[i] === ']') return s;
      skip();
      return undefined;
    }
    const m = /^(-?\d+(?:\.\d+)?)(?=\s*[,}\]])/.exec(text.slice(i, i + 40));
    if (m) {
      i += m[0].length;
      return parseFloat(m[1]!);
    }
    skip();
    return undefined;
  };
  const object = (): { [k: string]: Literal } => {
    i++;
    const obj: { [k: string]: Literal } = {};
    for (;;) {
      ws();
      if (text[i] === '}' || i >= text.length) {
        i++;
        return obj;
      }
      if (text.startsWith('...', i)) {
        skip();
      } else {
        let key: string | null = null;
        if (text[i] === '"' || text[i] === "'") key = str();
        else {
          const m = /^[\w$-]+/.exec(text.slice(i));
          if (m) {
            key = m[0];
            i += key.length;
          }
        }
        ws();
        if (key !== null && text[i] === ':') {
          i++;
          obj[key] = value();
        } else skip();
      }
      ws();
      if (text[i] === ',') i++;
      else if (text[i] !== '}') skip();
    }
  };
  return value();
}

const isObj = (v: Literal): v is { [k: string]: Literal } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `theme` merged with `theme.extend` from a Tailwind config's source. */
function tailwindTheme(source: string): { [k: string]: Literal } | null {
  const m = /\btheme\s*:\s*\{/.exec(source);
  if (!m) return null;
  const theme = readLiteral(source, m.index + m[0].length - 1);
  if (!isObj(theme)) return null;
  const extend = isObj(theme.extend) ? theme.extend : {};
  const out: { [k: string]: Literal } = {};
  for (const k of new Set([...Object.keys(theme), ...Object.keys(extend)])) {
    if (k === 'extend') continue;
    const a = theme[k];
    const b = extend[k];
    out[k] = isObj(a) && isObj(b) ? { ...a, ...b } : (b ?? a);
  }
  return out;
}

// ---- Tailwind defaults ----

const DEFAULT_SPACING_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24];
const DEFAULT_TYPE: TypeToken[] = [
  { step: 'xs', size: 12, lineHeight: 16 },
  { step: 'sm', size: 14, lineHeight: 20 },
  { step: 'base', size: 16, lineHeight: 24 },
  { step: 'lg', size: 18, lineHeight: 28 },
  { step: 'xl', size: 20, lineHeight: 28 },
  { step: '2xl', size: 24, lineHeight: 32 },
  { step: '3xl', size: 30, lineHeight: 36 },
  { step: '4xl', size: 36, lineHeight: 40 },
  { step: '5xl', size: 48, lineHeight: null },
];
const DEFAULT_RADIUS: ScaleToken[] = [
  { name: 'radius/sm', value: 4 },
  { name: 'radius/md', value: 6 },
  { name: 'radius/lg', value: 8 },
  { name: 'radius/xl', value: 12 },
];

// ---- components ----

/** Core components the builder makes, and the file names that mean them. */
export const CORE_COMPONENTS = {
  Button: /^button$/i,
  Input: /^(input|text-?field|textinput)$/i,
  Card: /^card$/i,
  Nav: /^(nav|navbar|navigation|nav-?bar|header|site-?header|top-?bar)$/i,
} as const;

const COMPONENT_FILE = /(^|\/)(components?|ui)\/(?:[\w-]+\/)*([\w-]+)\.(tsx|jsx)$/i;
const pascal = (s: string) =>
  s.replace(/(^|[-_])(\w)/g, (_, __: string, c: string) => c.toUpperCase());

// ---- reading it all ----

const GENERIC_FONTS = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'inherit',
  '-apple-system',
  'blinkmacsystemfont',
]);

function firstFamily(raw: string, nextFonts: Map<string, string>): string | null {
  const v = raw.trim();
  const viaVar = /var\(\s*(--[\w-]+)/.exec(v);
  if (viaVar && nextFonts.has(viaVar[1]!)) return nextFonts.get(viaVar[1]!)!;
  for (const part of splitArgs(v)) {
    const name = part.replace(/^['"]|['"]$/g, '').trim();
    if (!name || name.startsWith('var(') || GENERIC_FONTS.has(name.toLowerCase())) continue;
    return name;
  }
  return null;
}

/** `next/font/google` loaders with a `variable`: `--font-plex-sans` → "IBM Plex Sans". */
function nextFontVariables(files: SourceFile[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) {
    if (!/next\/font\/(google|local)/.test(f.text)) continue;
    for (const m of f.text.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*\(\s*\{([^}]*)\}/g)) {
      const variable = /variable\s*:\s*['"](--[\w-]+)['"]/.exec(m[2]!);
      if (variable) out.set(variable[1]!, m[1]!.replace(/_/g, ' '));
    }
  }
  return out;
}

const SHADE = /^(.*?)[-/](\d{2,3}|\d*xs|\d*xl|sm|md|lg|base|default)$/i;

function colourEntry(name: string, hex: string, dark?: string): ColourToken {
  const m = SHADE.exec(name);
  if (m && /\d/.test(m[2]!))
    return { name: `${m[1]}/${m[2]}`, group: pascal(m[1]!), hex, ...(dark ? { dark } : {}) };
  return { name, group: 'Theme', hex, ...(dark ? { dark } : {}) };
}

function flattenColours(
  v: Literal,
  prefix: string,
  resolve: (raw: string, dark: boolean) => string,
): ColourToken[] {
  if (typeof v === 'string') {
    const hex = parseColour(resolve(v, false));
    if (!hex) return [];
    const dark = parseColour(resolve(v, true));
    return [colourEntry(prefix, hex, dark && dark !== hex ? dark : undefined)];
  }
  if (!isObj(v)) return [];
  return Object.entries(v).flatMap(([k, inner]) =>
    flattenColours(inner, k === 'DEFAULT' ? prefix : prefix ? `${prefix}-${k}` : k, resolve),
  );
}

export function extractTokens(files: SourceFile[]): Tokens {
  const read: string[] = [];
  const css = files.filter((f) => /\.(css|scss|pcss)$/i.test(f.path));
  const configs = files.filter((f) =>
    /(^|\/)tailwind\.config\.(js|cjs|mjs|ts|cts|mts)$/.test(f.path),
  );
  const tailwind =
    configs.length > 0 ||
    css.some((f) => /@import\s+['"]tailwindcss|@tailwind\s|@theme/.test(f.text)) ||
    files.some((f) => f.path.endsWith('package.json') && /"tailwindcss"/.test(f.text));

  // Every custom property, the files with @theme first so their definitions win.
  const vars = new Map<string, CssVar[]>();
  const withTheme = [...css].sort(
    (a, b) => Number(/@theme/.test(b.text)) - Number(/@theme/.test(a.text)),
  );
  for (const f of withTheme) {
    const found = cssVars(f.text);
    if (found.size) read.push(f.path);
    for (const [k, list] of found) vars.set(k, [...(vars.get(k) ?? []), ...list]);
  }
  const lookup: Resolver = (name, dark) => {
    const list = vars.get(name) ?? [];
    const pick = (dark ? list.find((v) => v.dark) : null) ?? list.find((v) => !v.dark) ?? list[0];
    return pick?.value ?? null;
  };
  const resolve = (raw: string, dark: boolean) => resolveValue(raw, lookup, dark);
  const nextFonts = nextFontVariables(files);

  const themeVars = [...vars].filter(([, list]) => list.some((v) => v.theme));
  const themeValue = (prefix: string) =>
    themeVars
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, list]) => [k.slice(prefix.length), list.find((v) => v.theme)!.value] as const);

  // Colours: @theme, then the Tailwind config, then plain custom properties.
  const colours = new Map<string, ColourToken>();
  const addColour = (c: ColourToken) => {
    if (!colours.has(c.name)) colours.set(c.name, c);
  };
  for (const [name, value] of themeValue('--color-'))
    for (const c of flattenColours(value, name, resolve)) addColour(c);
  const theme = configs.map((f) => tailwindTheme(f.text)).find(Boolean) ?? null;
  if (configs.length) read.push(...configs.map((f) => f.path));
  if (theme) for (const c of flattenColours(theme.colors ?? null, '', resolve)) addColour(c);
  if (!colours.size)
    for (const [k, list] of vars) {
      const plain = list.find((v) => !v.dark);
      if (!plain || k.startsWith('--tw-')) continue;
      for (const c of flattenColours(plain.value, k.slice(2), resolve)) addColour(c);
    }

  // Spacing: @theme's --spacing base (v4), the config's spacing, or Tailwind's 4 px steps.
  let spacing: ScaleToken[] = [];
  const base = themeValue('--spacing').find(([k]) => k === '');
  const basePx = base ? parseLength(resolve(base[1], false)) : null;
  if (isObj(theme?.spacing ?? null))
    spacing = Object.entries(theme!.spacing as Record<string, Literal>).flatMap(([k, v]) => {
      const px = typeof v === 'string' ? parseLength(resolve(v, false)) : null;
      return px !== null && px > 0 ? [{ name: `space/${k}`, value: px }] : [];
    });
  for (const [k, v] of themeValue('--spacing-')) {
    const px = parseLength(resolve(v, false));
    if (px !== null && px > 0) spacing.push({ name: `space/${k}`, value: px });
  }
  if (!spacing.length && (tailwind || basePx))
    spacing = DEFAULT_SPACING_STEPS.map((n) => ({
      name: `space/${n}`,
      value: Math.round(n * (basePx ?? 4) * 100) / 100,
    }));

  // Radius.
  let radius: ScaleToken[] = [];
  for (const [k, v] of themeValue('--radius-')) {
    const px = parseLength(resolve(v, false));
    if (px !== null) radius.push({ name: `radius/${k}`, value: px });
  }
  if (isObj(theme?.borderRadius ?? null))
    for (const [k, v] of Object.entries(theme!.borderRadius as Record<string, Literal>)) {
      const raw = typeof v === 'string' ? resolve(v, false).replace(/calc\(([^)]*)\)/, '$1') : '';
      const m = /^([\d.]+(?:px|rem)?)\s*([-+])\s*([\d.]+(?:px|rem)?)$/.exec(raw.trim());
      const px = m
        ? (parseLength(m[1]!) ?? 0) + (m[2] === '-' ? -1 : 1) * (parseLength(m[3]!) ?? 0)
        : parseLength(raw);
      if (px !== null && px >= 0)
        radius.push({ name: `radius/${k === 'DEFAULT' ? 'default' : k}`, value: px });
    }
  if (!radius.length) {
    const r = lookup('--radius', false);
    const px = r ? parseLength(resolve(r, false)) : null;
    if (px !== null)
      radius = [
        { name: 'radius/sm', value: Math.max(px - 4, 0) },
        { name: 'radius/md', value: Math.max(px - 2, 0) },
        { name: 'radius/lg', value: px },
      ];
    else if (tailwind) radius = DEFAULT_RADIUS;
  }

  // Type scale.
  let type: TypeToken[] = [];
  for (const [k, v] of themeValue('--text-')) {
    if (k.includes('--')) continue;
    const size = parseLength(resolve(v, false));
    const lh = themeValue(`--text-${k}--line-height`)[0];
    const lhRaw = lh ? resolve(lh[1], false) : null;
    const lineHeight = lhRaw
      ? /^[\d.]+$/.test(lhRaw)
        ? size! * parseFloat(lhRaw)
        : parseLength(lhRaw)
      : null;
    if (size) type.push({ step: k, size, lineHeight: lineHeight ? Math.round(lineHeight) : null });
  }
  if (isObj(theme?.fontSize ?? null))
    for (const [k, v] of Object.entries(theme!.fontSize as Record<string, Literal>)) {
      const [s, opts] = Array.isArray(v) ? v : [v, null];
      const size = typeof s === 'string' ? parseLength(resolve(s, false)) : null;
      const lhRaw =
        typeof opts === 'string'
          ? opts
          : isObj(opts ?? null)
            ? (opts as { lineHeight?: Literal }).lineHeight
            : null;
      const lineHeight = typeof lhRaw === 'string' ? parseLength(lhRaw) : null;
      if (size) type.push({ step: k, size, lineHeight });
    }
  if (!type.length && tailwind) type = DEFAULT_TYPE;
  type.sort((a, b) => a.size - b.size);

  // Fonts.
  const fontOf = (keys: string[]): string | null => {
    for (const key of keys) {
      const fromTheme = themeValue(`--font-${key}`).find(([k]) => k === '');
      if (fromTheme) {
        const f =
          firstFamily(resolve(fromTheme[1], false), nextFonts) ??
          firstFamily(fromTheme[1], nextFonts);
        if (f) return f;
      }
      const fromConfig = isObj(theme?.fontFamily ?? null)
        ? (theme!.fontFamily as Record<string, Literal>)[key]
        : undefined;
      if (Array.isArray(fromConfig) && typeof fromConfig[0] === 'string') {
        const f = firstFamily(
          fromConfig.filter((x) => typeof x === 'string').join(', '),
          nextFonts,
        );
        if (f) return f;
      }
      if (typeof fromConfig === 'string') {
        const f = firstFamily(fromConfig, nextFonts);
        if (f) return f;
      }
    }
    return null;
  };
  const fonts = {
    sans: fontOf(['sans', 'body', 'base']) ?? [...nextFonts.values()][0] ?? null,
    heading: fontOf(['heading', 'display', 'serif', 'wordmark']),
    mono: fontOf(['mono', 'code']),
  };

  // Components.
  const components: Tokens['components'] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const m = COMPONENT_FILE.exec(f.path);
    if (!m || /\.(test|spec|stories)\./.test(f.path) || m[3] === 'index') continue;
    const name = pascal(m[3]!);
    if (seen.has(name)) continue;
    seen.add(name);
    // Tailwind classes in its string literals (className, cn(), cva()).
    const classes = new Set<string>();
    for (const m of f.text.matchAll(/['"`]([\w\s:/.[\]%-]+)['"`]/g))
      if (/\b(rounded|px-|py-|p-|gap-|bg-)/.test(m[1]!))
        for (const c of m[1]!.split(/\s+/)) if (c) classes.add(c);
    components.push({ name, path: f.path, classes: [...classes] });
  }

  return {
    colours: [...colours.values()],
    spacing,
    radius,
    type,
    fonts,
    components,
    tailwind,
    read: [...new Set(read)],
  };
}
