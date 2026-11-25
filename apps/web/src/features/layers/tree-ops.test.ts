import { treeFromLayers } from '@greenfield/editor-state';
import { describe, expect, it } from 'vitest';
import { clickSelection, collapsedAncestors, dropPosition, dropTarget } from './tree-ops';

// Page 1: Card (frame 2) holds Title (3) and Button (4, a component); Note (5) is in front of it.
const tree = treeFromLayers(1, [
  {
    id: 2,
    name: 'Card',
    type: 'FRAME',
    children: [
      { id: 3, name: 'Title', type: 'TEXT' },
      { id: 4, name: 'Button', type: 'COMPONENT' },
    ],
  },
  { id: 5, name: 'Note', type: 'TEXT' },
]);

describe('clickSelection', () => {
  const rows = tree.rows; // Note, Card, Button, Title
  it('selects one layer, a range from the anchor, or one more', () => {
    expect(rows.map((r) => r.id)).toEqual([5, 2, 4, 3]);
    const plain = { range: false, toggle: false };
    expect(clickSelection([5], rows, 4, 5, plain)).toEqual([4]);
    expect(clickSelection([3], rows, 2, 3, { range: true, toggle: false })).toEqual([2, 4, 3]);
    expect(clickSelection([5], rows, 3, 5, { range: false, toggle: true })).toEqual([5, 3]);
    expect(clickSelection([5, 3], rows, 5, 5, { range: false, toggle: true })).toEqual([3]);
  });
  it('without an anchor in view, a range is the one layer', () => {
    expect(clickSelection([], rows, 4, null, { range: true, toggle: false })).toEqual([4]);
    expect(clickSelection([], rows, 4, 99, { range: true, toggle: false })).toEqual([4]);
  });
});

describe('dropPosition', () => {
  it('splits a container row in three, any other in two', () => {
    expect(dropPosition(2, 28, true)).toBe('above');
    expect(dropPosition(14, 28, true)).toBe('inside');
    expect(dropPosition(26, 28, true)).toBe('below');
    expect(dropPosition(13, 28, false)).toBe('above');
    expect(dropPosition(15, 28, false)).toBe('below');
  });
});

describe('dropTarget', () => {
  it('above a row is in front of it, below is behind it (bottom-first index)', () => {
    // Card's children back to front: Title, Button.
    expect(dropTarget(tree, [5], 3, 'above', false)).toEqual({ parent: 2, index: 1 });
    expect(dropTarget(tree, [5], 3, 'below', false)).toEqual({ parent: 2, index: 0 });
    expect(dropTarget(tree, [5], 4, 'above', false)).toEqual({ parent: 2, index: 2 });
  });
  it('counts the index without the dragged layers (a move among siblings)', () => {
    // Title (index 0) to in front of Button: Button is then at 0, so Title goes to 1.
    expect(dropTarget(tree, [3], 4, 'above', false)).toEqual({ parent: 2, index: 1 });
    // Note behind Card, on the page.
    expect(dropTarget(tree, [5], 2, 'below', false)).toEqual({ parent: 1, index: 0 });
  });
  it('inside a container, or below an expanded one, is its front-most child', () => {
    expect(dropTarget(tree, [5], 2, 'inside', false)).toEqual({ parent: 2, index: 2 });
    expect(dropTarget(tree, [5], 2, 'below', true)).toEqual({ parent: 2, index: 2 });
    expect(dropTarget(tree, [3], 2, 'inside', true)).toEqual({ parent: 2, index: 1 });
  });
  it('never onto or into a dragged layer, nor into one that takes no children', () => {
    expect(dropTarget(tree, [2], 2, 'above', false)).toBeNull();
    expect(dropTarget(tree, [2], 3, 'above', false)).toBeNull();
    expect(dropTarget(tree, [3], 5, 'inside', false)).toBeNull();
  });
});

describe('collapsedAncestors', () => {
  it("lists a layer's collapsed ancestors only", () => {
    expect(collapsedAncestors(tree, 3, new Set([2, 5]))).toEqual([2]);
    expect(collapsedAncestors(tree, 2, new Set([2]))).toEqual([]);
  });
});
