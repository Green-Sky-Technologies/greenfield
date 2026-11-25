import type { NodeFields } from '@greenfield/editor-state';
import { describe, expect, it } from 'vitest';
import { renderScale, sizeText } from './export-section';
import { bindableFields, common, fieldLabel, MIXED, styleSlots } from './model';

describe('styles section model', () => {
  it('finds the common value or mixed', () => {
    const a = { id: 1, styles: { fill: 'S:1' } };
    const b = { id: 2, styles: { fill: 'S:1' } };
    const c = { id: 3 };
    const fill = (n: NodeFields) => (n.styles as Record<string, unknown> | undefined)?.fill ?? null;
    expect(common([a, b], fill)).toBe('S:1');
    expect(common([a, c], fill)).toBe(MIXED);
  });
  it('offers text styles on text and grids on frames', () => {
    expect(styleSlots({ id: 1, type: 'TEXT' })).toEqual(['text', 'fill', 'stroke', 'effect']);
    expect(styleSlots({ id: 1, type: 'FRAME' })).toEqual(['fill', 'stroke', 'effect', 'grid']);
    expect(styleSlots({ id: 1, type: 'RECTANGLE' })).toEqual(['fill', 'stroke', 'effect']);
  });
  it('offers the fields a layer can bind', () => {
    const text = bindableFields({ id: 1, type: 'TEXT' }).map((f) => f.field);
    expect(text).toContain('fontSize');
    expect(text).not.toContain('cornerRadius');
    expect(
      bindableFields({ id: 1, type: 'FRAME', layout: { mode: 'vertical' } }).map((f) => f.field),
    ).toContain('gap');
    expect(fieldLabel('strokes/1/color', [])).toBe('Stroke 2');
    expect(fieldLabel('cornerRadius', bindableFields({ id: 1, type: 'RECTANGLE' }))).toBe('Radius');
  });
  it('reads export sizes', () => {
    expect(sizeText({ by: 'scale', value: 2 })).toBe('2x');
    expect(sizeText({ by: 'width', value: 512 })).toBe('512w');
    expect(renderScale({ by: 'width', value: 512 }, { id: 1, width: 256 })).toBe(2);
    expect(renderScale({ by: 'scale', value: 3 }, { id: 1 })).toBe(3);
  });
});
