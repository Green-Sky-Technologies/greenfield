import { saveChord, type KeyPlatform } from '@greenfield/bridge';
import { describe, expect, it } from 'vitest';
import { editPanelChord, shellKeyAction } from './keys';

type Init = Partial<Parameters<typeof shellKeyAction>[0]>;
const key = (k: string, init: Init = {}) => ({
  key: k,
  code: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  target: null,
  ...init,
});

/** The platform's Save chord as a key event, from the bridge's own mapping (never a fixed Ctrl). */
function save(platform: KeyPlatform) {
  const [mod] = saveChord(platform).split('+');
  return key('s', mod === 'Meta' ? { metaKey: true } : { ctrlKey: true });
}

/** The platform's edit panel chord as a key event, from `editPanelChord` (never a fixed Ctrl). */
function editPanel(platform: KeyPlatform, init: Init = {}) {
  const mod = editPanelChord(platform).split('+')[0];
  return key('\\', {
    code: 'Backslash',
    ...(mod === 'Meta' ? { metaKey: true } : { ctrlKey: true }),
    ...init,
  });
}

const textarea = { tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget;

describe('shellKeyAction', () => {
  for (const platform of ['mac', 'other'] as const) {
    describe(platform, () => {
      it('C opens "Comment or ask" from the shell and the canvas', () => {
        expect(shellKeyAction(key('c'), 'shell', platform)).toBe('comment');
        expect(shellKeyAction(key('C'), 'canvas', platform)).toBe('comment');
      });

      it('C is just a letter in a text field, held down, or with a modifier', () => {
        expect(shellKeyAction(key('c', { target: textarea }), 'shell', platform)).toBeNull();
        expect(shellKeyAction(key('c', { repeat: true }), 'canvas', platform)).toBeNull();
        expect(shellKeyAction(key('c', { shiftKey: true }), 'canvas', platform)).toBeNull();
        const copy = save(platform);
        expect(shellKeyAction({ ...copy, key: 'c' }, 'canvas', platform)).toBeNull();
      });

      it('Esc returns to the canvas from the shell, even from a text field', () => {
        expect(shellKeyAction(key('Escape'), 'shell', platform)).toBe('canvas');
        expect(shellKeyAction(key('Escape', { target: textarea }), 'shell', platform)).toBe(
          'canvas',
        );
      });

      it('leaves Esc on the canvas to the editor', () => {
        expect(shellKeyAction(key('Escape'), 'canvas', platform)).toBeNull();
      });

      it('F6 moves between panes from both places', () => {
        expect(shellKeyAction(key('F6'), 'shell', platform)).toBe('next-pane');
        expect(shellKeyAction(key('F6', { shiftKey: true }), 'canvas', platform)).toBe(
          'previous-pane',
        );
      });

      it('the edit panel chord toggles the edit panel from both places in canvas mode', () => {
        for (const where of ['shell', 'canvas'] as const)
          expect(shellKeyAction(editPanel(platform), where, platform)).toBe('toggle-edit-panel');
        // By the physical key too, for layouts where it types another character.
        expect(shellKeyAction(editPanel(platform, { key: '#' }), 'canvas', platform)).toBe(
          'toggle-edit-panel',
        );
        const other = editPanel(platform === 'mac' ? 'other' : 'mac');
        expect(shellKeyAction(other, 'canvas', platform)).toBeNull();
        const shifted = editPanel(platform, { shiftKey: true });
        expect(shellKeyAction(shifted, 'canvas', platform)).toBeNull();
      });

      it('leaves the edit panel chord to the editor while its own panels are back', () => {
        const fallback = { canvasMode: false };
        expect(shellKeyAction(editPanel(platform), 'canvas', platform, fallback)).toBeNull();
        expect(shellKeyAction(key('F6'), 'canvas', platform, fallback)).toBe('next-pane');
      });

      it('routes the platform Save chord to the editor only from the shell', () => {
        expect(shellKeyAction(save(platform), 'shell', platform)).toBe('save');
        expect(shellKeyAction(save(platform), 'canvas', platform)).toBeNull();
        const other = save(platform === 'mac' ? 'other' : 'mac');
        expect(shellKeyAction(other, 'shell', platform)).toBeNull();
      });

      it('leaves every other key alone', () => {
        for (const k of ['v', 'r', 'Tab', 'Enter', ' ', 'Delete'])
          for (const where of ['shell', 'canvas'] as const)
            expect(shellKeyAction(key(k), where, platform)).toBeNull();
      });

      it('ignores keys while an IME is composing', () => {
        expect(shellKeyAction(key('c', { isComposing: true }), 'canvas', platform)).toBeNull();
      });
    });
  }
});
