/**
 * Where things on the canvas are in the host page. The canvas reports points in its own CSS
 * pixels from the iframe's top-left (`ui.request` `screen`), and layers in page coordinates
 * (`absoluteBounds`); `viewport` maps one to the other: page point `p` shows at
 * `(p - (x, y)) * zoom`.
 */
import type { NodeFields, Viewport } from '@greenfield/editor-state';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The editor's iframe (one per project page). */
export const canvasFrame = () =>
  document.querySelector<HTMLIFrameElement>('iframe[title="Design canvas"]');

export const toPage = (screen: { x: number; y: number }, v: Viewport) => ({
  x: screen.x / v.zoom + v.x,
  y: screen.y / v.zoom + v.y,
});

export const toScreen = (r: Rect, v: Viewport): Rect => ({
  x: (r.x - v.x) * v.zoom,
  y: (r.y - v.y) * v.zoom,
  width: r.width * v.zoom,
  height: r.height * v.zoom,
});

/** The box around the layers' `absoluteBounds`, or null when none reports one. */
export function unionBounds(nodes: readonly (NodeFields | undefined)[]): Rect | null {
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (const n of nodes) {
    const b = n?.absoluteBounds as Rect | undefined;
    if (!b) continue;
    box = box
      ? {
          x0: Math.min(box.x0, b.x),
          y0: Math.min(box.y0, b.y),
          x1: Math.max(box.x1, b.x + b.width),
          y1: Math.max(box.y1, b.y + b.height),
        }
      : { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
  }
  return box && { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 };
}

/** Keep a box of `size` inside `bounds`, moving it as little as possible. */
export function clampInto(
  at: { x: number; y: number },
  size: { width: number; height: number },
  bounds: Rect,
) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  return {
    x: clamp(at.x, bounds.x, bounds.x + bounds.width - size.width),
    y: clamp(at.y, bounds.y, bounds.y + bounds.height - size.height),
  };
}

/**
 * Where a menu opened at a point goes: right of and below it, flipped to the other side on an
 * axis where it would run out of `bounds`, and kept inside them.
 */
export function placeAt(
  at: { x: number; y: number },
  size: { width: number; height: number },
  bounds: Rect,
) {
  const flip = (v: number, len: number, start: number, end: number) =>
    v + len > end && v - len >= start ? v - len : v;
  return clampInto(
    {
      x: flip(at.x, size.width, bounds.x, bounds.x + bounds.width),
      y: flip(at.y, size.height, bounds.y, bounds.y + bounds.height),
    },
    size,
    bounds,
  );
}
