import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, normalizeHex, parseOpacity, rgbaToHex } from './colour';
import { filterFonts, fontList } from './fonts';
import { parseStyles, parseVariables } from './library';
import { paintCommands, paintTarget, paintValue } from './paint';
import { placeInWindow } from './popover';

// `variable.list` and `style.list` as the pinned editor returns them (recorded from 0.18.1).
const VARIABLES = {
  collections: [
    {
      id: 'VariableCollectionId:1',
      name: 'Brand',
      modes: [
        { id: 'VariableCollectionId:1/mode1', name: 'Light' },
        { id: 'VariableCollectionId:1/mode2', name: 'Dark' },
      ],
    },
  ],
  variables: [
    {
      collection: 'VariableCollectionId:1',
      id: 'VariableID:1',
      name: 'ink/900',
      resolvedType: 'color',
      values: {
        'VariableCollectionId:1/mode1': {
          type: 'color',
          value: { a: 1, r: 0.08627451, g: 0.09019608, b: 0.05882353 },
        },
        'VariableCollectionId:1/mode2': {
          type: 'color',
          value: { a: 1, r: 0.96470588, g: 0.95294118, b: 0.9254902 },
        },
      },
    },
    {
      collection: 'VariableCollectionId:1',
      id: 'VariableID:2',
      name: 'text/primary',
      resolvedType: 'color',
      values: { 'VariableCollectionId:1/mode1': { type: 'alias', value: 'VariableID:1' } },
    },
    {
      collection: 'VariableCollectionId:1',
      id: 'VariableID:3',
      name: 'radius/md',
      resolvedType: 'number',
      values: { 'VariableCollectionId:1/mode1': { type: 'number', value: 8 } },
    },
  ],
};
const STYLES = [
  {
    id: 'S:1',
    name: 'Brand/Field',
    type: 'paint',
    paints: [{ type: 'solid', color: { a: 1, r: 0.24705882, g: 0.83921569, b: 0.49803922 } }],
  },
  { id: 'S:2', name: 'Heading/H1', type: 'text', style: { font_family: 'Inter' } },
];

describe('colour', () => {
  it('normalises hex in the forms people type', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('3fd67f')).toBe('#3fd67f');
    expect(normalizeHex('#3FD67F80')).toBe('#3fd67f');
    expect(normalizeHex('nope')).toBeNull();
  });
  it('round-trips hex through HSV', () => {
    for (const hex of ['#3fd67f', '#16170f', '#ffffff', '#000000', '#e0452f'])
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
  });
  it('reads the editor colour and percentages', () => {
    expect(rgbaToHex({ r: 1, g: 0.5, b: 0 })).toBe('#ff8000');
    expect(parseOpacity('50%')).toBe(0.5);
    expect(parseOpacity('120')).toBe(1);
    expect(parseOpacity('x')).toBeNull();
  });
});

describe('library', () => {
  it('lists variables with their default-mode value, aliases resolved', () => {
    const { collections, variables } = parseVariables(VARIABLES);
    expect(collections[0]!.modes.map((m) => m.name)).toEqual(['Light', 'Dark']);
    expect(variables.map((v) => [v.name, v.type, v.display])).toEqual([
      ['ink/900', 'color', '#16170f'],
      ['text/primary', 'color', '#16170f'],
      ['radius/md', 'number', '8'],
    ]);
  });
  it('lists styles with a swatch or a family', () => {
    expect(parseStyles(STYLES)).toEqual([
      { id: 'S:1', name: 'Brand/Field', type: 'paint', hex: '#3fd67f', font: null },
      { id: 'S:2', name: 'Heading/H1', type: 'text', hex: null, font: 'Inter' },
    ]);
    expect(parseStyles(null)).toEqual([]);
  });
});

describe('fonts', () => {
  it('puts the design system first, each family once', () => {
    const list = fontList({
      designSystem: ['Cormorant Garamond', 'IBM Plex Sans'],
      file: ['Inter', 'IBM Plex Sans'],
      installed: ['Noto Sans', 'inter', 'Cormorant Garamond'],
    });
    expect(list).toEqual([
      { family: 'Cormorant Garamond', source: 'Design system' },
      { family: 'IBM Plex Sans', source: 'Design system' },
      { family: 'Inter', source: 'This file' },
      { family: 'Noto Sans', source: 'Installed' },
    ]);
    expect(filterFonts(list, 'plex').map((f) => f.family)).toEqual(['IBM Plex Sans']);
  });
});

describe('paint', () => {
  const target = paintTarget({ target: 'paint', slot: 'fill', index: 0, ids: [7] })!;
  it("reads the canvas's request", () => {
    expect(target).toEqual({ slot: 'fill', index: 0, ids: [7] });
    expect(paintTarget({ target: 'pageBackground' })).toBeNull();
  });
  it('reads the value: style, then variable, then colour', () => {
    const fills = [{ type: 'solid', color: '#FF0000', opacity: 0.5 }];
    expect(paintValue(target, { id: 7, fills })).toEqual({ hex: '#ff0000', opacity: 0.5 });
    expect(paintValue(target, { id: 7, fills, boundVariables: { fill: 'VariableID:1' } })).toEqual({
      variable: 'VariableID:1',
    });
    expect(
      paintValue(target, { id: 7, fills, styles: { fill: 'S:1' }, boundVariables: { fill: 'V' } }),
    ).toEqual({ style: 'S:1' });
  });
  it('writes a colour, leaving what it was bound to', () => {
    const node = { id: 7, boundVariables: { fill: 'VariableID:1' } };
    expect(paintCommands(target, node, { hex: '#00ff00', opacity: 1 })).toEqual([
      { command: 'variable.bind', params: { ids: [7], field: 'fill', variable: null } },
      { command: 'fill.set', params: { ids: [7], index: 0, color: '#00ff00', opacity: 1 } },
    ]);
    expect(
      paintCommands(target, { id: 7, styles: { fill: 'S:1' } }, { hex: '#000000', opacity: 1 })[0],
    ).toEqual({ command: 'style.detach', params: { ids: [7], which: 'fill' } });
    expect(
      paintCommands({ ...target, slot: 'stroke', index: 1 }, { id: 7 }, { variable: 'V' }),
    ).toEqual([
      { command: 'variable.bind', params: { ids: [7], field: 'strokes/1/color', variable: 'V' } },
    ]);
    expect(paintCommands(target, { id: 7 }, { style: 'S:1' })).toEqual([
      { command: 'style.apply', params: { ids: [7], style: 'S:1', target: 'fill' } },
    ]);
  });
});

describe('placeInWindow', () => {
  it('keeps the picker inside the window', () => {
    const win = { width: 1440, height: 900 };
    const size = { width: 286, height: 400 };
    expect(placeInWindow({ x: 100, y: 100 }, size, win)).toEqual({ x: 100, y: 100 });
    expect(placeInWindow({ x: 1400, y: 800 }, size, win)).toEqual({ x: 1146, y: 492 });
    expect(placeInWindow({ x: -20, y: -5 }, size, win)).toEqual({ x: 8, y: 8 });
  });
});
