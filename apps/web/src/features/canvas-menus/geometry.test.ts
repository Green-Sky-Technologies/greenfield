import { describe, expect, it } from 'vitest';
import { placeAt, toPage, toScreen, unionBounds } from './geometry';

const view = { zoom: 2, x: -10, y: 5 };
const bounds = { x: 0, y: 0, width: 1000, height: 800 };
const size = { width: 200, height: 300 };

describe('canvas geometry', () => {
  it('maps canvas pixels and page points both ways', () => {
    const r = toScreen({ x: 10, y: 15, width: 4, height: 6 }, view);
    expect(r).toEqual({ x: 40, y: 20, width: 8, height: 12 });
    expect(toPage({ x: r.x, y: r.y }, view)).toEqual({ x: 10, y: 15 });
  });

  it('boxes the layers that report bounds', () => {
    expect(
      unionBounds([
        { id: 1, absoluteBounds: { x: 10, y: 20, width: 30, height: 40 } },
        undefined,
        { id: 2 },
        { id: 3, absoluteBounds: { x: -5, y: 50, width: 10, height: 100 } },
      ]),
    ).toEqual({ x: -5, y: 20, width: 45, height: 130 });
    expect(unionBounds([{ id: 1 }])).toBeNull();
  });

  it('opens a menu right of and below the point, flipping where it would not fit', () => {
    expect(placeAt({ x: 100, y: 100 }, size, bounds)).toEqual({ x: 100, y: 100 });
    expect(placeAt({ x: 900, y: 700 }, size, bounds)).toEqual({ x: 700, y: 400 });
    // No room on either side: kept inside.
    expect(placeAt({ x: 100, y: 200 }, { width: 200, height: 700 }, bounds)).toEqual({
      x: 100,
      y: 100,
    });
  });
});
