import { MockEditor } from '@greenfield/bridge/mock';
import { describe, expect, it } from 'vitest';
import {
  executeTool,
  mergeLayerChanges,
  planRevert,
  showOnCanvasIds,
  type LayerChange,
} from './index';

async function setup() {
  const editor = new MockEditor();
  const [card, title] = (await editor.batch(
    [
      {
        command: 'node.create',
        as: 'card',
        params: {
          type: 'frame',
          name: 'Card',
          select: false,
          props: { layout: 'vertical', padding: 18 },
        },
      },
      {
        command: 'node.create',
        params: { type: 'text', parent: { $ref: 'card' }, text: 'Hello', select: false },
      },
    ],
    { label: 'Setup' },
  )) as { id: number }[];
  return { editor, card: card!.id, title: title!.id };
}

describe('change records (Story 4.7)', () => {
  it('run_batch reports each changed layer with before/after values and its frame', async () => {
    const { editor, card, title } = await setup();
    const r = await executeTool(
      'run_batch',
      {
        label: 'Tighten',
        commands: [
          { command: 'node.set', params: { id: card, props: { padding: 16 } } },
          { command: 'node.set', params: { id: title, props: { characters: 'Hi' } } },
          {
            command: 'node.create',
            as: 'tag',
            params: { type: 'text', parent: card, text: 'Recommended', select: false },
          },
        ],
      },
      editor,
    );
    if (!r.ok) throw new Error(r.error.message);
    const byId = new Map(r.changes!.map((c) => [c.id, c]));
    expect(byId.get(card)).toMatchObject({ kind: 'changed', name: 'Card', frame: card });
    expect(byId.get(card)!.fields).toContainEqual({ field: 'padding', before: 18, after: 16 });
    expect(byId.get(title)!.fields).toContainEqual({
      field: 'characters',
      before: 'Hello',
      after: 'Hi',
    });
    const added = r.changes!.find((c) => c.kind === 'added')!;
    expect(added).toMatchObject({ name: 'Recommended', frame: card, fields: [] });
    expect(r.frames).toEqual([card]);
    // Not part of what the model sees.
    expect(JSON.stringify(r.content)).not.toContain('"before"');
  });

  it('merges a turn into one record per layer and drops what ended where it started', () => {
    const step1: LayerChange[] = [
      {
        id: 1,
        name: 'Card',
        kind: 'changed',
        frame: 1,
        fields: [{ field: 'gap', before: 14, after: 12 }],
      },
      { id: 5, name: 'Tag', kind: 'added', frame: 1, fields: [] },
      { id: 6, name: 'Tmp', kind: 'added', frame: 1, fields: [] },
      { id: 7, name: 'Old', kind: 'removed', frame: 1, fields: [] },
    ];
    const step2: LayerChange[] = [
      {
        id: 1,
        name: 'Card',
        kind: 'changed',
        frame: 1,
        fields: [{ field: 'gap', before: 12, after: 16 }],
      },
      {
        id: 5,
        name: 'Tag 2',
        kind: 'changed',
        frame: 1,
        fields: [{ field: 'name', before: 'Tag', after: 'Tag 2' }],
      },
      { id: 6, name: 'Tmp', kind: 'removed', frame: 1, fields: [] },
      {
        id: 2,
        name: 'Btn',
        kind: 'changed',
        frame: 1,
        fields: [{ field: 'fill', before: '#000', after: '#0f0' }],
      },
    ];
    const step3: LayerChange[] = [
      {
        id: 2,
        name: 'Btn',
        kind: 'changed',
        frame: 1,
        fields: [{ field: 'fill', before: '#0f0', after: '#000' }],
      },
    ];
    const merged = mergeLayerChanges([step1, step2, step3]);
    expect(merged).toEqual([
      {
        id: 1,
        name: 'Card',
        kind: 'changed',
        frame: 1,
        fields: [{ field: 'gap', before: 14, after: 16 }],
      },
      { id: 5, name: 'Tag 2', kind: 'added', frame: 1, fields: [] },
      { id: 7, name: 'Old', kind: 'removed', frame: 1, fields: [] },
    ]);
    expect(showOnCanvasIds(merged)).toEqual([1, 5]);
  });

  it('plans "Undo all": undo while the turn is newest, else write the old values back', async () => {
    const changes: LayerChange[] = [
      {
        id: 1,
        name: 'Card',
        kind: 'changed',
        frame: 1,
        fields: [{ field: 'gap', before: 14, after: 16 }],
      },
      { id: 5, name: 'Tag', kind: 'added', frame: 1, fields: [] },
      { id: 7, name: 'Old', kind: 'removed', frame: 1, fields: [] },
    ];
    expect(planRevert(changes, ['A', 'B'], ['B', 'A', 'Setup'])).toEqual({
      kind: 'undo',
      steps: 2,
    });
    expect(planRevert(changes, ['A', 'B'], ['Move', 'B', 'A'])).toEqual({
      kind: 'batch',
      commands: [
        { command: 'node.set', params: { id: 1, props: { gap: 14 } } },
        { command: 'edit.delete', params: { ids: [5] } },
      ],
      unrestorable: [7],
    });

    // The batch plan really restores the values in the editor.
    const { editor, card } = await setup();
    const r = await executeTool(
      'run_batch',
      {
        label: 'Pad',
        commands: [{ command: 'node.set', params: { id: card, props: { padding: 4 } } }],
      },
      editor,
    );
    if (!r.ok) throw new Error(r.error.message);
    await editor.batch([{ command: 'node.set', params: { id: card, props: { name: 'Mine' } } }], {
      label: 'User rename',
    });
    const history = (await editor.inspect({ depth: 0 })).history.undo;
    const plan = planRevert(r.changes!, ['Pad'], history);
    expect(plan.kind).toBe('batch');
    if (plan.kind === 'batch') await editor.batch(plan.commands as never, { label: 'Undo Claude' });
    expect(await editor.getNode(card)).toMatchObject({ padding: 18, name: 'Mine' });
  });
});
