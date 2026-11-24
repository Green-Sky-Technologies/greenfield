import { describe, expect, it } from 'vitest';
import { ref, step } from '../src/commands';
import {
  CommandError,
  EditorFailedError,
  EditorHiddenError,
  EditorNotReadyError,
  NoDocumentError,
} from '../src/errors';
import { COMMAND_COUNT } from '../src/generated/commands';
import { MockEditor } from '../src/mock';
import type { DocumentInfo, EditorNode, SaveEvent } from '../src/types';

const tree = (doc: DocumentInfo) => {
  const walk = (n: EditorNode): unknown =>
    n.children ? { [String(n.name)]: n.children.map(walk) } : String(n.name);
  return doc.pages[0]!.children?.map(walk) ?? [];
};

describe('MockEditor', () => {
  it('is ready at once, with deterministic ids', async () => {
    const ed = new MockEditor();
    expect(ed.isReady).toBe(true);
    await expect(ed.ready()).resolves.toMatchObject({ version: '1', appVersion: '0.18.1' });
    expect(await ed.execute('node.create', { type: 'frame', name: 'A' })).toEqual({ id: 2 });
    expect(await ed.execute('node.create', { type: 'rectangle' })).toEqual({ id: 3 });
    const doc = await ed.inspect({ fields: ['name', 'type'] });
    expect(doc.pages[0]!.children).toEqual([
      { id: 2, name: 'A', type: 'FRAME' },
      { id: 3, name: 'Rectangle', type: 'RECTANGLE' },
    ]);
    expect(doc.selection).toEqual([3]);
    expect(doc.history.undo).toEqual(['Create layer', 'Create layer']);
  });

  it('node.set takes props or flat keys; fill and stroke shorthands', async () => {
    const ed = new MockEditor();
    const { id } = (await ed.execute('node.create', { type: 'frame' })) as { id: number };
    await ed.execute('node.set', { ids: [id], props: { name: 'Card', fill: '#ff0000' } });
    await ed.execute('node.set', { id, x: 40, stroke: '#00ff00' });
    expect(await ed.getNode(id, { fields: ['name', 'x', 'fills', 'strokes'] })).toEqual({
      id,
      name: 'Card',
      x: 40,
      fills: [{ type: 'solid', color: '#FF0000' }],
      strokes: [{ type: 'solid', color: '#00FF00' }],
    });
    const bad = await ed
      // @ts-expect-error: not a node.set prop
      .execute('node.set', { ids: [id], props: { colour: 'red' } })
      .catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(CommandError);
    expect((bad as CommandError).editorMessage).toBe(
      'invalid parameters for `node.set`: unknown properties: colour',
    );
  });

  it('text.set and edit.delete', async () => {
    const ed = new MockEditor();
    const frame = (await ed.execute('node.create', { type: 'frame', name: 'F' })) as { id: number };
    const text = (await ed.execute('node.create', {
      type: 'text',
      text: 'Hi',
      parent: frame.id,
    })) as {
      id: number;
    };
    await ed.execute('text.set', { id: text.id, text: 'Hello' });
    expect(await ed.getNode(text.id, { fields: ['name', 'characters'] })).toEqual({
      id: text.id,
      name: 'Hello',
      characters: 'Hello',
    });
    await expect(ed.execute('text.set', { id: frame.id, text: 'x' })).rejects.toThrow(
      /is not text/,
    );
    expect(await ed.execute('edit.delete', { ids: [frame.id] })).toEqual({
      deleted: [frame.id],
      hidden: [],
    });
    expect(await ed.getNode(text.id)).toBeNull();
    await expect(ed.execute('edit.delete', { ids: [frame.id] })).rejects.toThrow(
      `no such node ${frame.id}`,
    );
  });

  it('select.set replaces the selection without an undo step', async () => {
    const ed = new MockEditor();
    const a = (await ed.execute('node.create', { type: 'frame', select: false })) as { id: number };
    const b = (await ed.execute('node.create', { type: 'frame', select: false })) as { id: number };
    await ed.execute('select.set', { ids: [b.id, a.id] });
    const doc = await ed.inspect({ depth: 0 });
    expect(doc.selection).toEqual([b.id, a.id]);
    expect(doc.history.undo).toEqual(['Create layer', 'Create layer']);
    await ed.execute('select.set', { ids: [] });
    expect((await ed.inspect({ depth: 0 })).selection).toEqual([]);
    await expect(ed.execute('select.set', { ids: [99] })).rejects.toThrow('no such node 99');
    await expect(ed.execute('select.set', { ids: [1] })).rejects.toThrow('no such node 1');
  });

  it('rejects unknown commands and parameters like the editor', async () => {
    const ed = new MockEditor();
    // @ts-expect-error: not a command
    await expect(ed.execute('nope.nope', {})).rejects.toThrow('unknown command `nope.nope`');
    const e = (await ed
      // @ts-expect-error: not a parameter of node.create
      .execute('node.create', { type: 'frame', bogus: 1 })
      .catch((x: unknown) => x)) as CommandError;
    expect(e.editorMessage).toBe(
      'invalid parameters for `node.create`: unknown parameter `bogus` (it takes type, x, y, width, height, parent, index, name, text, characters, path, points, closed, props, select)',
    );
    await expect(ed.execute('align.left', {})).rejects.toThrow(
      "MockEditor doesn't implement `align.left`",
    );
  });

  it('batch: refs and step refs with field paths, one undo step', async () => {
    const ed = new MockEditor();
    const r = await ed.batch(
      [
        { command: 'node.create', as: 'card', params: { type: 'frame', name: 'Card' } },
        {
          command: 'node.create',
          as: 'btn',
          params: { type: 'frame', name: 'Button', parent: ref('card') },
        },
        { command: 'node.create', params: { type: 'text', text: 'Go', parent: step(1) } },
        { command: 'node.set', params: { ids: [ref('btn', '/id')], props: { name: 'CTA' } } },
      ],
      { label: 'Card' },
    );
    expect(r).toEqual([{ id: 2 }, { id: 3 }, { id: 4 }, { ok: true }]);
    const doc = await ed.inspect({ fields: ['name'] });
    expect(tree(doc)).toEqual([{ Card: [{ CTA: ['Go'] }] }]);
    expect(doc.history.undo).toEqual(['Card']);
  });

  it('batch: the first failure rolls back everything; continue runs the rest', async () => {
    const ed = new MockEditor();
    await expect(
      ed.batch([
        { command: 'node.create', params: { type: 'frame', name: 'Gone' } },
        { command: 'text.set', params: { id: 999, text: 'x' } },
      ]),
    ).rejects.toThrow('no such node 999');
    let doc = await ed.inspect({ fields: ['name'] });
    expect(tree(doc)).toEqual([]);
    expect(doc.history.undo).toEqual([]);
    expect(doc.dirty).toBe(false);

    const per = await ed.batchContinue([
      { command: 'text.set', params: { id: 999, text: 'x' } },
      { command: 'node.create', as: 'a', params: { type: 'ellipse', name: 'Dot' } },
      { command: 'node.set', params: { ids: [step(0)], props: { name: 'never' } } },
    ]);
    expect(per).toEqual([
      { step: 0, command: 'text.set', ok: false, error: 'no such node 999' },
      { step: 1, command: 'node.create', ok: true, result: { id: 2 } },
      { step: 2, command: 'node.set', ok: false, error: 'step 2: step 0 failed' },
    ]);
    doc = await ed.inspect({ fields: ['name'] });
    expect(tree(doc)).toEqual(['Dot']);
    expect(doc.history.undo).toEqual(['Batch']);
  });

  it('batch reference errors', async () => {
    const ed = new MockEditor();
    await expect(
      ed.batch([
        { command: 'node.create', as: 'x', params: { type: 'frame' } },
        { command: 'node.create', as: 'x', params: { type: 'frame' } },
      ]),
    ).rejects.toThrow('the name `x` is used twice');
    await expect(
      ed.batch([{ command: 'node.create', params: { type: 'frame', parent: ref('later') } }]),
    ).rejects.toThrow('no step is named `later`');
    await expect(
      ed.batch([
        { command: 'node.create', as: 'a', params: { type: 'frame' } },
        { command: 'node.set', params: { ids: [ref('a', 'ids/0')], props: { name: 'x' } } },
      ]),
    ).rejects.toThrow("step 0's result has no `ids/0`");
  });

  it('inspect: depth, fields, outline', async () => {
    const ed = new MockEditor();
    await ed.batch([
      { command: 'node.create', as: 'a', params: { type: 'frame', name: 'Outer' } },
      { command: 'node.create', params: { type: 'rectangle', name: 'Leaf', parent: ref('a') } },
    ]);
    const shallow = await ed.inspect({ depth: 1, fields: ['name'] });
    expect(shallow.pages[0]!.children).toEqual([{ id: 2, name: 'Outer', childCount: 1 }]);
    const gate = await ed.inspect({ depth: 0, fields: [] });
    expect(gate.pages).toEqual([{ id: 1, childCount: 1 }]);
    const outline = await ed.inspect({ outline: true });
    expect(outline.pages[0]!.children![0]).toEqual({
      id: 2,
      name: 'Outer',
      type: 'FRAME',
      visible: true,
      children: [{ id: 3, name: 'Leaf', type: 'RECTANGLE', visible: true }],
    });
    // @ts-expect-error: not a node field
    await expect(ed.inspect({ fields: ['nope'] })).rejects.toThrow(
      /unknown field `nope`; valid keys: /,
    );
    await expect(ed.inspect({ outline: true, fields: ['name'] })).rejects.toBeInstanceOf(
      CommandError,
    );
  });

  it('render returns a tiny PNG; nothing to render is an error', async () => {
    const ed = new MockEditor();
    await expect(ed.render()).rejects.toThrow('nothing to export');
    const { id } = (await ed.execute('node.create', { type: 'frame' })) as { id: number };
    const r = await ed.render({ ids: [id], scale: 2 });
    expect(r).toMatchObject({ width: 1, height: 1 });
    expect([...r.png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('lists the pinned editor’s commands', async () => {
    const list = await new MockEditor().commands();
    expect(list).toHaveLength(COMMAND_COUNT);
    expect(list.find((c) => c.id === 'command.batch')).toMatchObject({
      label: 'Run several commands',
    });
  });

  it('dirty and save events; a save reopens exactly', async () => {
    const ed = new MockEditor();
    const dirty: boolean[] = [];
    const saves: SaveEvent[] = [];
    ed.onDirty((d) => dirty.push(d));
    ed.onSave((s) => {
      saves.push(s);
    });
    await ed.execute('node.create', { type: 'frame', name: 'Keep' });
    await ed.execute('node.create', { type: 'frame', name: 'Me' });
    await ed.save();
    expect(dirty).toEqual([true, false]);
    expect(saves[0]).toMatchObject({ name: 'Untitled.figcraft', saveAs: true });
    await ed.execute('node.create', { type: 'rectangle' });
    await ed.save();
    expect(saves[1]).toMatchObject({ name: 'Untitled.figcraft', saveAs: false });
    // The Ctrl chord is not Save on a Mac.
    await expect(ed.request('ui.key', { key: 'S', ctrl: true })).rejects.toThrow('no shortcut `S`');

    const other = new MockEditor({ document: false });
    await expect(other.inspect()).rejects.toBeInstanceOf(NoDocumentError);
    other.open('Poster.figcraft', saves[0]!.bytes);
    const doc = await other.inspect({ fields: ['name'] });
    expect(tree(doc)).toEqual(['Keep', 'Me']);
    expect(doc.dirty).toBe(false);
    await other.execute('node.create', { type: 'frame' });
    const back: SaveEvent[] = [];
    other.onSave((s) => {
      back.push(s);
    });
    await other.save();
    expect(back[0]).toMatchObject({ name: 'Poster.figcraft', saveAs: false });
  });

  it('opens non-mock bytes as an empty document under that name', async () => {
    const ed = new MockEditor({ document: false });
    ed.open('Real.figcraft', new Uint8Array([0x50, 0x4b, 3, 4]));
    const doc = await ed.inspect();
    expect(doc.name).toBe('Real');
    expect(doc.pages[0]!.children).toBeUndefined();
  });

  it('hidden, not ready, failed and disposed', async () => {
    const ed = new MockEditor({ ready: false });
    await expect(ed.inspect()).rejects.toBeInstanceOf(EditorNotReadyError);
    expect(() => ed.open('a', new Uint8Array())).toThrow(EditorNotReadyError);
    const ready = ed.ready();
    ed.makeReady();
    await expect(ready).resolves.toMatchObject({ version: '1' });
    ed.setHidden(true);
    await expect(ed.execute('node.create', { type: 'frame' })).rejects.toBeInstanceOf(
      EditorHiddenError,
    );
    ed.setHidden(false);
    await expect(ed.execute('node.create', { type: 'frame' })).resolves.toEqual({ id: 2 });
    ed.dispose();
    await expect(ed.inspect()).rejects.toBeInstanceOf(EditorNotReadyError);

    const broken = new MockEditor({ ready: false });
    const waiting = broken.ready();
    broken.fail('no WebGL2');
    await expect(waiting).rejects.toBeInstanceOf(EditorFailedError);
  });

  it('records calls', async () => {
    const ed = new MockEditor();
    await ed.execute('file.new', {});
    await ed.inspect();
    expect(ed.calls).toEqual([
      { method: 'engine.execute', command: 'file.new' },
      { method: 'document.inspect' },
    ]);
  });
});
