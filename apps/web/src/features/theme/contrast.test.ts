import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const COLOURS = [
  'ground',
  'panel',
  'raise',
  'ink',
  'body',
  'field',
  'ember',
  'ember-ink',
  'danger',
] as const;
type Colour = (typeof COLOURS)[number];
type Theme = Record<Colour, string>;

function themes(): { light: Theme; dark: Theme } {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
  const light = {} as Theme;
  const dark = {} as Theme;
  for (const name of COLOURS) {
    const m = css.match(new RegExp(`--${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\);`));
    if (!m) throw new Error(`--${name} must be light-dark(#light, #dark) in globals.css`);
    light[name] = m[1]!;
    dark[name] = m[2]!;
  }
  return { light, dark };
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function lightness(hex: string): number {
  const y = luminance(hex);
  return y <= 216 / 24389 ? (y * 24389) / 27 : 116 * Math.cbrt(y) - 16;
}

const TEXT = ['ink', 'body', 'field', 'ember', 'danger'] as const;
const BACKGROUNDS = ['ground', 'panel', 'raise'] as const;
const FILLS = [
  ['ground', 'field'],
  ['ember-ink', 'ember'],
  ['ground', 'danger'],
] as const;

describe.each(Object.entries(themes()))('%s theme', (_name, t) => {
  it.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg] as const)))(
    '%s text on %s passes 4.5:1',
    (fg, bg) => {
      expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(FILLS)('%s text on a %s fill passes 4.5:1', (fg, fill) => {
    expect(contrast(t[fg], t[fill])).toBeGreaterThanOrEqual(4.5);
  });

  it('danger differs from ember in lightness', () => {
    expect(Math.abs(lightness(t.danger) - lightness(t.ember))).toBeGreaterThan(12);
  });
});
