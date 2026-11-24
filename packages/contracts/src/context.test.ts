/**
 * Story 4.1: per-turn context. The AC is a token budget for a one-element request, checked here
 * on the `landing` golden fixture with a design system of realistic size.
 */
import { MockEditor } from '@greenfield/bridge/mock';
import { describe, expect, it } from 'vitest';
import {
  buildTurnContext,
  compactValue,
  ONE_ELEMENT_TOKEN_BUDGET,
  outlineLines,
  styleLines,
  variableLines,
} from './context';
import { buildLanding } from './testing';

const MODE = 'VariableCollectionId:1/mode1';
const rgb = (r: number, g: number, b: number) => ({ r: r / 255, g: g / 255, b: b / 255, a: 1 });

/** Shapes as the pinned editor returns them (probed against figcraft-web 0.18.1). */
function designSystem() {
  const colors = [
    'background',
    'surface',
    'text',
    'muted',
    'border',
    'primary',
    'primary-text',
    'accent',
  ];
  const variables = [
    ...colors.map((name, i) => ({
      collection: 'VariableCollectionId:1',
      description: '',
      id: `VariableID:${i + 1}`,
      name: `color/${name}`,
      resolvedType: 'color',
      values: { [MODE]: { type: 'color', value: rgb(20 * i, 40, 200 - 10 * i) } },
    })),
    ...[4, 8, 12, 16, 24, 32, 48, 64].map((v, i) => ({
      collection: 'VariableCollectionId:1',
      description: '',
      id: `VariableID:${100 + i}`,
      name: `space/${v}`,
      resolvedType: 'number',
      values: { [MODE]: { type: 'number', value: v } },
    })),
  ];
  const styles = [
    {
      description: '',
      id: 'S:1',
      name: 'Brand/Primary',
      type: 'paint',
      paints: [
        { blend: 'normal', color: rgb(79, 70, 229), opacity: 1, type: 'solid', visible: true },
      ],
    },
    {
      description: '',
      id: 'S:2',
      name: 'Heading/XL',
      type: 'text',
      fontFamily: 'SF Pro',
      fontStyle: 'Bold',
      fontSize: 60,
    },
  ];
  return {
    variables: {
      collections: [
        { id: 'VariableCollectionId:1', modes: [{ id: MODE, name: 'Mode 1' }], name: 'Brand' },
      ],
      variables,
    },
    styles,
  };
}

async function landing() {
  const editor = new MockEditor();
  const fx = await buildLanding(editor);
  editor.setDesignSystem(designSystem());
  return { editor, fx };
}

describe('buildTurnContext', () => {
  it('a one-element request stays within the token budget', async () => {
    const { editor, fx } = await landing();
    const ctx = await buildTurnContext(editor, { selection: [fx.ids.n_herocta001!] });
    expect(ctx.scope).toEqual([fx.ids.n_herocta001]);
    expect(ctx.tokens).toBeLessThanOrEqual(ONE_ELEMENT_TOKEN_BUDGET);
    // Every part is there.
    expect(ctx.text).toMatch(/^<document>\nPage: "Page 1"/);
    expect(ctx.text).toContain('<selection>');
    expect(ctx.text).toContain('"characters":"Get started"');
    expect(ctx.text).toContain(`${fx.ids.n_features01} FRAME "n_features01"`);
    expect(ctx.text).toContain('Brand: color/primary = #');
    expect(ctx.text).toContain('Brand: space/16 = 16');
    expect(ctx.text).toContain('paint "Brand/Primary" (S:1)');
    console.info(`one-element context: ${ctx.text.length} chars, ~${ctx.tokens} tokens`);
  });

  it('defaults to the editor selection; nothing selected means the whole page', async () => {
    const { editor, fx } = await landing();
    const none = await buildTurnContext(editor);
    expect(none.scope).toBeNull();
    expect(none.text).toContain('Nothing is selected');
    expect(none.text).not.toContain('<selection>');
    await editor.execute('select.set', { ids: [fx.ids.n_herotitle1!] });
    expect((await buildTurnContext(editor)).scope).toEqual([fx.ids.n_herotitle1]);
  });

  it('skips selected layers that no longer exist', async () => {
    const { editor, fx } = await landing();
    const ctx = await buildTurnContext(editor, { selection: [9999, fx.ids.n_logo000001!] });
    expect(ctx.scope).toEqual([fx.ids.n_logo000001]);
  });
});

describe('compaction', () => {
  it('turns colours into hex and drops defaults', () => {
    expect(
      compactValue({
        fills: [
          { blend: 'normal', color: rgb(255, 0, 0), opacity: 1, type: 'solid', visible: true },
        ],
        visible: false,
        x: 10.123,
        effects: [],
      }),
    ).toEqual({ fills: [{ color: '#FF0000', type: 'solid' }], visible: false, x: 10.12 });
    expect(compactValue({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080');
  });

  it('caps the outline, variables and styles', () => {
    const page = {
      id: 1,
      children: Array.from({ length: 10 }, (_, i) => ({ id: i + 2, type: 'FRAME', name: `F${i}` })),
    };
    const lines = outlineLines(page, 3);
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toMatch(/^… 7 more layers/);
    const ds = designSystem();
    expect(variableLines(ds.variables, 2).at(-1)).toBe('… 14 more (variable.list)');
    expect(styleLines(ds.styles, 1)).toEqual([
      'paint "Brand/Primary" (S:1): {"paints":[{"color":"#4F46E5","type":"solid"}]}',
      '… 1 more (style.list)',
    ]);
    expect(variableLines(null)).toEqual([]);
    expect(styleLines(undefined)).toEqual([]);
  });
});
