/**
 * Colour maths for the colour picker (Story 5.11): `#rrggbb` hex as the inspector holds it, the
 * editor's `{r, g, b, a}` (0..1 channels, `variable.list` and `style.list`), and HSV for the
 * saturation/brightness square and the hue strip.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Hsv {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  v: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const byte = (n: number) =>
  Math.round(clamp01(n) * 255)
    .toString(16)
    .padStart(2, '0');

/** `#RGB`, `RRGGBB`, `#rrggbbaa`… as `#rrggbb` (alpha dropped), or null if it isn't a colour. */
export function normalizeHex(input: string): string | null {
  let h = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3,4}$/.test(h)) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  if (/^[0-9a-f]{8}$/.test(h)) h = h.slice(0, 6);
  return /^[0-9a-f]{6}$/.test(h) ? `#${h}` : null;
}

export function rgbaToHex({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): string {
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function hexToRgb(hex: string): Omit<Rgba, 'a'> {
  const h = normalizeHex(hex) ?? '#000000';
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(1), g: n(3), b: n(5) };
}

export function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbaToHex({ r: f(5), g: f(3), b: f(1) });
}

/** "50" or "50%" → 0.5; null when it isn't a percentage. */
export function parseOpacity(input: string): number | null {
  const t = input.trim().replace(/%$/, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return clamp01(Number(t) / 100);
}

export const formatOpacity = (opacity: number) => `${Math.round(clamp01(opacity) * 100)}%`;
