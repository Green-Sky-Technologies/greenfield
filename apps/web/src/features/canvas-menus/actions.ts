/**
 * What the context menu and the floating toolbar offer (Story 5.10), as data: each item is one
 * editor command with its params, or a request for "Comment or ask". Shortcut labels are the
 * editor's own bindings, shown the platform's way (⇧⌘G on a Mac, Ctrl+Shift+G elsewhere).
 */
import type { CommandId, KeyPlatform, NodeId } from '@greenfield/bridge';
import type { TreeNode } from '@greenfield/editor-state';

/** A shortcut as the editor binds it: `Mod` is Cmd on a Mac and Ctrl elsewhere. */
export type Shortcut = readonly ('Mod' | 'Alt' | 'Shift' | (string & {}))[];

export type MenuAction =
  | { kind: 'command'; command: CommandId; params: Record<string, unknown> }
  /** Open "Comment or ask" at the target; `ask` starts it as a question for Claude. */
  | { kind: 'comment'; ask: boolean };

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: Shortcut;
  action: MenuAction;
  /** Claude's items are ember (D24). */
  agent?: boolean;
}

export interface MenuContext {
  /** The layers the menu acts on (the right-clicked layer, selected by the canvas). */
  ids: readonly NodeId[];
  /** Their rows in the page tree, for types and the hidden and locked states. */
  layers: readonly (TreeNode | undefined)[];
  /** The page point under the pointer, where "Paste here" pastes. */
  at: { x: number; y: number } | null;
}

const command = (command: CommandId, params: Record<string, unknown>): MenuAction => ({
  kind: 'command',
  command,
  params,
});

/** The context menu's items, in groups (a rule between each). */
export function contextMenuGroups({ ids, layers, at }: MenuContext): MenuItem[][] {
  const paste: MenuItem = {
    id: 'paste',
    label: at ? 'Paste here' : 'Paste',
    shortcut: ['Mod', 'V'],
    action: command('edit.paste', at ? { x: at.x, y: at.y } : {}),
  };
  if (!ids.length) return [[paste]];

  const target = { ids: [...ids] };
  const known = layers.filter((l): l is TreeNode => !!l);
  const allHidden = known.length > 0 && known.every((l) => !l.visible);
  const allLocked = known.length > 0 && known.every((l) => l.locked);
  const hasGroup = known.some((l) => l.type === 'GROUP');
  const hasInstance = known.some((l) => l.component === 'instance');

  return [
    [
      { id: 'copy', label: 'Copy', shortcut: ['Mod', 'C'], action: command('edit.copy', target) },
      paste,
      {
        id: 'duplicate',
        label: 'Duplicate',
        shortcut: ['Mod', 'D'],
        action: command('edit.duplicate', target),
      },
      {
        id: 'delete',
        label: 'Delete',
        shortcut: ['Delete'],
        action: command('edit.delete', target),
      },
    ],
    [
      {
        id: 'group',
        label: 'Group selection',
        shortcut: ['Mod', 'G'],
        action: command('object.group', target),
      },
      ...(hasGroup
        ? [
            {
              id: 'ungroup',
              label: 'Ungroup',
              shortcut: ['Shift', 'Mod', 'G'],
              action: command('object.ungroup', target),
            } satisfies MenuItem,
          ]
        : []),
      {
        id: 'frame',
        label: 'Frame selection',
        shortcut: ['Alt', 'Mod', 'G'],
        action: command('object.frameSelection', target),
      },
      {
        id: 'auto-layout',
        label: 'Add auto layout',
        shortcut: ['Shift', 'A'],
        action: command('layout.add', target),
      },
      hasInstance
        ? {
            id: 'detach',
            label: 'Detach instance',
            shortcut: ['Alt', 'Mod', 'B'],
            action: command('component.detach', target),
          }
        : {
            id: 'component',
            label: 'Create component',
            shortcut: ['Alt', 'Mod', 'K'],
            action: command('component.create', target),
          },
    ],
    [
      {
        id: 'front',
        label: 'Bring to front',
        shortcut: ['Shift', 'Mod', ']'],
        action: command('arrange.front', target),
      },
      {
        id: 'forward',
        label: 'Bring forward',
        shortcut: ['Mod', ']'],
        action: command('arrange.forward', target),
      },
      {
        id: 'backward',
        label: 'Send backward',
        shortcut: ['Mod', '['],
        action: command('arrange.backward', target),
      },
      {
        id: 'back',
        label: 'Send to back',
        shortcut: ['Shift', 'Mod', '['],
        action: command('arrange.back', target),
      },
    ],
    [
      {
        id: 'visible',
        label: allHidden ? 'Show' : 'Hide',
        shortcut: ['Shift', 'Mod', 'H'],
        action: command('object.toggleVisible', { ...target, visible: allHidden }),
      },
      {
        id: 'lock',
        label: allLocked ? 'Unlock' : 'Lock',
        shortcut: ['Shift', 'Mod', 'L'],
        action: command('object.toggleLock', { ...target, locked: !allLocked }),
      },
    ],
    [
      {
        id: 'ask',
        label: 'Ask Claude about this…',
        agent: true,
        action: { kind: 'comment', ask: true },
      },
      { id: 'comment', label: 'Comment', shortcut: ['C'], action: { kind: 'comment', ask: false } },
    ],
  ];
}

const MAC_GLYPHS: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', Delete: '⌫' };
const MAC_ORDER = ['Alt', 'Shift', 'Mod'];

/** How a shortcut reads on this platform: `⇧⌘G` on a Mac, `Ctrl+Shift+G` elsewhere. */
export function shortcutLabel(keys: Shortcut, platform: KeyPlatform): string {
  if (platform === 'mac') {
    const mods = MAC_ORDER.filter((m) => keys.includes(m));
    const rest = keys.filter((k) => !MAC_ORDER.includes(k));
    return [...mods, ...rest].map((k) => MAC_GLYPHS[k] ?? k).join('');
  }
  const order = ['Mod', 'Shift', 'Alt'];
  const mods = order.filter((m) => keys.includes(m));
  const rest = keys.filter((k) => !order.includes(k));
  return [...mods, ...rest].map((k) => (k === 'Mod' ? 'Ctrl' : k)).join('+');
}

/** The shortcut for `aria-keyshortcuts` (`Meta+Shift+G`, `Control+Shift+G`). */
export function ariaShortcut(keys: Shortcut, platform: KeyPlatform): string {
  return keys.map((k) => (k === 'Mod' ? (platform === 'mac' ? 'Meta' : 'Control') : k)).join('+');
}
