import type { TreeNode } from '@greenfield/editor-state';
import { describe, expect, it } from 'vitest';
import { ariaShortcut, contextMenuGroups, shortcutLabel, type MenuItem } from './actions';

const layer = (id: number, over: Partial<TreeNode> = {}): TreeNode => ({
  id,
  parent: 1,
  children: [],
  name: `L${id}`,
  type: 'RECTANGLE',
  visible: true,
  locked: false,
  component: null,
  ...over,
});

const byId = (groups: MenuItem[][]) => new Map(groups.flat().map((i) => [i.id, i]));

describe('contextMenuGroups', () => {
  it('offers only Paste on empty canvas, at the pointer when there is one', () => {
    const [[paste], ...rest] = contextMenuGroups({ ids: [], layers: [], at: { x: 40, y: 50 } });
    expect(rest).toEqual([]);
    expect(paste).toMatchObject({
      label: 'Paste here',
      action: { kind: 'command', command: 'edit.paste', params: { x: 40, y: 50 } },
    });
    const [[keyed]] = contextMenuGroups({ ids: [], layers: [], at: null });
    expect(keyed).toMatchObject({ label: 'Paste', action: { params: {} } });
  });

  it('targets the right-clicked layers with every command', () => {
    const items = contextMenuGroups({ ids: [7, 8], layers: [layer(7), layer(8)], at: null }).flat();
    for (const item of items)
      if (item.action.kind === 'command' && item.id !== 'paste')
        expect(item.action.params, item.id).toMatchObject({ ids: [7, 8] });
    expect(items.map((i) => i.label)).toEqual([
      'Copy',
      'Paste',
      'Duplicate',
      'Delete',
      'Group selection',
      'Frame selection',
      'Add auto layout',
      'Create component',
      'Bring to front',
      'Bring forward',
      'Send backward',
      'Send to back',
      'Hide',
      'Lock',
      'Ask Claude about this…',
      'Comment',
    ]);
  });

  it('follows what the layers are: Show and Unlock, Ungroup, Detach instance', () => {
    const items = byId(
      contextMenuGroups({
        ids: [1, 2],
        layers: [
          layer(1, { type: 'GROUP', visible: false, locked: true }),
          layer(2, { component: 'instance', visible: false, locked: true }),
        ],
        at: null,
      }),
    );
    expect(items.get('visible')).toMatchObject({
      label: 'Show',
      action: { params: { visible: true } },
    });
    expect(items.get('lock')).toMatchObject({
      label: 'Unlock',
      action: { params: { locked: false } },
    });
    expect(items.get('ungroup')?.action).toMatchObject({ command: 'object.ungroup' });
    expect(items.get('detach')?.action).toMatchObject({ command: 'component.detach' });
    expect(items.has('component')).toBe(false);
  });

  it('hides when any layer is visible', () => {
    const items = byId(
      contextMenuGroups({
        ids: [1, 2],
        layers: [layer(1, { visible: false }), layer(2)],
        at: null,
      }),
    );
    expect(items.get('visible')).toMatchObject({
      label: 'Hide',
      action: { params: { visible: false } },
    });
  });
});

describe('shortcut labels', () => {
  it('reads the platform’s way, never a fixed Ctrl', () => {
    expect(shortcutLabel(['Shift', 'Mod', 'G'], 'mac')).toBe('⇧⌘G');
    expect(shortcutLabel(['Alt', 'Mod', 'K'], 'mac')).toBe('⌥⌘K');
    expect(shortcutLabel(['Shift', 'Mod', 'G'], 'other')).toBe('Ctrl+Shift+G');
    expect(shortcutLabel(['Alt', 'Mod', 'K'], 'other')).toBe('Ctrl+Alt+K');
    expect(shortcutLabel(['C'], 'mac')).toBe('C');
    expect(ariaShortcut(['Mod', 'C'], 'mac')).toBe('Meta+C');
    expect(ariaShortcut(['Mod', 'C'], 'other')).toBe('Control+C');
  });
});
