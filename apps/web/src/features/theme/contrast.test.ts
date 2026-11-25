import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every text/background token pair in both themes passes WCAG AA (4.5:1), read from the tokens in
 * globals.css, so a token change that breaks a pair fails here.
 */
const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in globals.css`);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]!] = m[2]!;
  return out;
}

const dark = block(':root');
const light = block(":root[data-theme='light']");
const system = block("  :root[data-theme='system']");

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT = ['ink', 'body', 'field', 'ember', 'danger'] as const;
const BACKGROUNDS = ['ground', 'panel', 'raise'] as const;
const FILLS = ['field', 'ember', 'danger'] as const;

describe.each([
  ['dark', dark],
  ['light', light],
])('%s theme contrast', (_name, t) => {
  it.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg] as const)))(
    '%s text on %s',
    (fg, bg) => {
      expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(FILLS)('ground text on a %s fill', (fill) => {
    expect(contrast(t.ground!, t[fill]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('ember-ink text on an ember fill', () => {
    expect(contrast(t['ember-ink']!, t.ember!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('theme blocks', () => {
  it('System under prefers-color-scheme: light repeats the light tokens', () => {
    expect(system).toEqual(light);
  });

  it('danger stays well apart from ember in lightness', () => {
    const lstar = (hex: string) => {
      const y = luminance(hex);
      return y <= 216 / 24389 ? (y * 24389) / 27 : 116 * Math.cbrt(y) - 16;
    };
    expect(Math.abs(lstar(dark.danger!) - lstar(dark.ember!))).toBeGreaterThan(12);
    expect(Math.abs(lstar(light.danger!) - lstar(light.ember!))).toBeGreaterThan(12);
  });
});
