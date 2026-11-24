import { CommandError, type CommandId } from '@greenfield/bridge';
import { MockEditor } from '@greenfield/bridge/mock';
import { describe, expect, it } from 'vitest';
import { exportFile, exportFileName, exportTargets, type ExportEditor } from './export';

async function withFrames() {
  const editor = new MockEditor();
  const card = (await editor.execute('node.create', { type: 'frame', name: 'Card' })) as {
    id: number;
  };
  await editor.execute('node.create', { type: 'frame', name: 'Hero' });
  await editor.execute('node.create', { type: 'rectangle', name: 'Box' });
  await editor.execute('select.set', { ids: [] }); // creating a layer selects it
  return { editor, card: card.id };
}

describe('exportTargets', () => {
  it('lists the top-level frames when nothing is selected', async () => {
    const { editor } = await withFrames();
    const targets = await exportTargets(editor);
    expect(targets.map((t) => t.label)).toEqual(['Card', 'Hero']);
  });

  it('puts the selection first, named after the selected layer', async () => {
    const { editor, card } = await withFrames();
    await editor.execute('select.set', { ids: [card] });
    const [first] = await exportTargets(editor);
    expect(first).toMatchObject({ key: 'selection', ids: [card], name: 'Card' });
  });
});

describe('exportFile', () => {
  const calls: { command: CommandId; params: unknown }[] = [];
  const stub = (data: unknown): ExportEditor => ({
    inspect: () => Promise.reject(new Error('unused')),
    execute: async (command, params) => {
      calls.push({ command, params });
      return { data, format: 'png' };
    },
  });

  it('runs file.export and decodes the bytes', async () => {
    calls.length = 0;
    const file = await exportFile(stub(btoa('%PDF-1.7')), { ids: [2], name: 'Card' }, 'pdf', 2);
    expect(calls).toEqual([
      { command: 'file.export', params: { ids: [2], format: 'pdf', scale: 1 } },
    ]);
    expect(file.fileName).toBe('Card.pdf');
    expect(file.mime).toBe('application/pdf');
    expect(new TextDecoder().decode(file.bytes)).toBe('%PDF-1.7');
  });

  it('keeps the scale for raster formats', async () => {
    calls.length = 0;
    const file = await exportFile(stub('AAAA'), { ids: [2], name: 'Card' }, 'webp', 2);
    expect(calls[0]?.params).toEqual({ ids: [2], format: 'webp', scale: 2 });
    expect(file.fileName).toBe('Card@2x.webp');
  });

  it('fails when the editor returns no data', async () => {
    await expect(exportFile(stub(''), { ids: [2], name: 'Card' }, 'png')).rejects.toBeInstanceOf(
      CommandError,
    );
  });
});

describe('exportFileName', () => {
  it('replaces characters file systems refuse', () => {
    expect(exportFileName('Home / Mobile: v2', 'png', 1)).toBe('Home - Mobile- v2.png');
    expect(exportFileName('  ', 'svg', 3)).toBe('Export.svg');
  });
});
