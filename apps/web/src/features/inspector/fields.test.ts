import { describe, expect, it } from 'vitest';
import {
  constraint,
  layout,
  measure,
  measureValue,
  MIXED,
  parseHex,
  radius,
  shared,
  sizing,
  styleWeight,
} from './fields';

// Fields as the editor reports them (node.get at depth 0, recorded from editor-29af8688e00e).
const frame = {
  id: 2,
  type: 'FRAME',
  layout: { mode: 'vertical', gap: 12, padding: [8, 16, 8, 16], mainAlign: 'min', wrap: false },
  sizing: { horizontal: 'fixed', vertical: 'hug' },
};
const rect = { id: 4, type: 'RECTANGLE', cornerRadius: [1, 2, 3, 4], x: 10 };

describe('inspector fields', () => {
  it('shares a value across layers, or reports it mixed', () => {
    expect(shared([frame, { ...frame, id: 3 }], (n) => sizing(n, 'vertical'))).toBe('hug');
    expect(shared([frame, rect], (n) => sizing(n, 'vertical'))).toBe(MIXED);
    expect(shared([frame, { ...frame, id: 3 }], layout)).toEqual(layout(frame));
  });

  it('fills in the defaults the editor leaves out', () => {
    expect(constraint(rect, 'horizontal')).toBe('left');
    expect(constraint(rect, 'vertical')).toBe('top');
    expect(sizing(rect, 'horizontal')).toBe('fixed');
    expect(layout(rect)).toBeNull();
    expect(layout(frame)).toMatchObject({ mode: 'vertical', gap: 12, crossAlign: 'min' });
  });

  it('reads one radius, or mixed corners', () => {
    expect(radius({ id: 1, cornerRadius: 6 })).toBe(6);
    expect(radius({ id: 1, cornerRadius: [4, 4, 4, 4] })).toBe(4);
    expect(radius(rect)).toBe(MIXED);
  });

  it('parses measures the way node.set takes them', () => {
    expect(measure('150%')).toEqual({ value: 150, unit: '%' });
    expect(measure('2')).toEqual({ value: 2, unit: '' });
    expect(measure(24)).toEqual({ value: 24, unit: '' });
    expect(measure('Auto')).toBeNull();
    expect(measureValue({ value: 120, unit: '%' })).toBe('120%');
    expect(measureValue({ value: 24, unit: '' })).toBe(24);
  });

  it('parses hex colours and font weights', () => {
    expect(parseHex('3fd67f')).toBe('#3FD67F');
    expect(parseHex('#fff')).toBe('#FFFFFF');
    expect(parseHex('green')).toBeNull();
    expect(styleWeight('SemiBold Italic')).toBe(600);
    expect(styleWeight('Light')).toBe(300);
    expect(styleWeight('Regular')).toBe(400);
  });
});
