import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  enumType,
  generateModule,
  hashCommands,
  parseFieldKeys,
  parseParamDoc,
  parseTakes,
  splitTop,
  type CommandMeta,
} from '../scripts/command-types';
import type { BatchStep, CommandParams } from '../src/commands';
import {
  COMMAND_COUNT,
  COMMANDS,
  COMMANDS_HASH,
  NODE_FIELDS,
  NODE_SET_PROPS,
} from '../src/generated/commands';

const byName = (doc: string, command?: string) =>
  Object.fromEntries(parseParamDoc(doc, { command }).params.map((p) => [p.name, p]));

describe('parseParamDoc', () => {
  it('reads keys, optionality, enums and docs', () => {
    const p = byName(
      "{type: rectangle|ellipse|text, x?, y? (relative to the parent frame; groups don't count), parent? (id; default: the page), text? | characters? (for text), props? {node.set keys}, select? (default true)}",
      'node.create',
    );
    expect(p.type).toMatchObject({ optional: false, type: "'rectangle' | 'ellipse' | 'text'" });
    expect(p.x).toMatchObject({ optional: true, type: 'number' });
    expect(p.y!.doc).toBe("relative to the parent frame; groups don't count");
    expect(p.parent).toMatchObject({ type: 'NodeId', doc: 'id; default: the page' });
    expect(p.text).toMatchObject({ optional: true, type: 'string' });
    expect(p.characters).toMatchObject({ optional: true, type: 'string', doc: 'for text' });
    expect(p.props!.type).toBe('NodeProps');
    expect(p.select!.type).toBe('boolean');
  });

  it('handles enums in parentheses, explicit types, shapes and value forms', () => {
    const p = byName(
      '{ids?, width?, anchor? (tl|t|tr|l|c|r|bl|b|br), fields?: [node keys], outline?: bool (not with fields), features: {tag: bool | null (font default)}, value | {alias: variable} (same type) | {alpha}}',
      'transform.resize',
    );
    expect(p.ids!.type).toBe('NodeId[]');
    expect(p.anchor!.type).toBe("'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br'");
    expect(p.fields!.type).toBe('unknown[]');
    expect(p.outline!.type).toBe('boolean');
    expect(p.features!.type).toBe('Record<string, unknown> | null');
    expect(p.value).toMatchObject({ type: 'unknown', optional: true });
  });

  it('expands slash aliases and shorthand', () => {
    const p = byName(
      'paddingTop/Right/Bottom/Left, strokeCap / startCap / endCap, id?/ids?, minWidth, maxWidth (null removes)',
    );
    expect(Object.keys(p)).toEqual([
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'strokeCap',
      'startCap',
      'endCap',
      'id',
      'ids',
      'minWidth',
      'maxWidth',
    ]);
    expect(p.paddingLeft!.type).toBe('number');
    expect(p.maxWidth!.type).toBe('number | null');
  });

  it('types ids by namespace', () => {
    expect(byName('{id}', 'plugin.run').id!.type).toBe('number | string');
    expect(byName('{id}', 'node.get').id!.type).toBe('NodeId');
  });

  it('keeps the text after the braces', () => {
    expect(parseParamDoc('{x, y} → {selection}; more').rest).toBe('→ {selection}; more');
  });
});

describe('helpers', () => {
  it('splitTop respects nesting and quotes', () => {
    expect(splitTop('a, b (c, d), {e, f}, "g, h"', ',')).toEqual([
      'a',
      ' b (c, d)',
      ' {e, f}',
      ' "g, h"',
    ]);
  });
  it('enumType', () => {
    expect(enumType('a|b|null|2|true')).toBe("'a' | 'b' | null | 2 | true");
    expect(enumType('just words')).toBeNull();
    expect(enumType('one')).toBeNull();
  });
  it('parseTakes and parseFieldKeys read the engine’s messages', () => {
    expect(
      parseTakes(
        'invalid parameters for `align.left`: unknown parameter `__probe__` (it takes ids)',
      ),
    ).toEqual(['ids']);
    expect(parseTakes('… unknown parameter `__probe__` (it takes none)')).toEqual([]);
    expect(parseTakes('command `x` is not available right now')).toBeNull();
    expect(parseFieldKeys('unknown field `__probe__`; valid keys: id, name, x')).toEqual([
      'id',
      'name',
      'x',
    ]);
  });
  it('hashCommands ignores order', () => {
    const a: CommandMeta = {
      id: 'a',
      label: 'A',
      menu: null,
      params: '{}',
      shortcut: null,
      undoable: true,
    };
    const b: CommandMeta = { ...a, id: 'b' };
    expect(hashCommands([a, b])).toBe(hashCommands([b, a]));
    expect(hashCommands([a, b])).not.toBe(hashCommands([a, { ...b, params: '{x}' }]));
  });
  it('generateModule falls back without a key list', () => {
    const { source, stats } = generateModule({
      editorVersion: '1.0.0',
      editorSha256: 'x',
      commands: [
        { id: 'a.b', label: 'A', menu: null, params: '{x, y?}', shortcut: null, undoable: true },
        { id: 'c.d', label: 'C', menu: null, params: '{q}', shortcut: null, undoable: false },
      ],
      takes: { 'a.b': ['x', 'y'] },
      nodeFields: ['id', 'name'],
    });
    expect(source).toMatch(/'a\.b': \{\n {4}x: number;\n {4}y\?: number;/);
    expect(source).toContain("'c.d': Record<string, unknown>;");
    expect(stats).toMatchObject({ exactKeys: 1, fallback: 1 });
  });
});

describe('the committed generated file', () => {
  it('matches its own hash and count', () => {
    expect(COMMANDS).toHaveLength(COMMAND_COUNT);
    expect(hashCommands(COMMANDS)).toBe(COMMANDS_HASH);
    expect(NODE_FIELDS).toContain('characters');
    expect(NODE_SET_PROPS).toContain('paddingLeft');
  });

  it('gives precise parameter types', () => {
    expectTypeOf<CommandParams<'node.create'>['type']>().toEqualTypeOf<
      | 'rectangle'
      | 'ellipse'
      | 'polygon'
      | 'star'
      | 'line'
      | 'arrow'
      | 'vector'
      | 'text'
      | 'frame'
      | 'section'
      | 'component'
      | 'slice'
    >();
    expectTypeOf<CommandParams<'text.set'>>().toEqualTypeOf<{
      id?: number;
      characters?: string;
      text?: string;
      ids?: number[];
    }>();
    // Step references are accepted anywhere in batch params.
    const steps: BatchStep[] = [
      { command: 'node.create', as: 'a', params: { type: 'frame', parent: { $ref: 'x' } } },
      { command: 'node.set', params: { ids: [{ $step: 0 }], props: { name: 'n', fill: '#fff' } } },
    ];
    expect(steps).toHaveLength(2);
  });
});
