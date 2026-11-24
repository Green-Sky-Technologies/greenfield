/**
 * The shell's keyboard map (Story 5.4). One function decides what a key does, wherever it was
 * pressed, so no key can act in both the shell and the editor:
 *
 * - Pressed in the shell (top bar, composer, menus): the editor never sees it.
 * - Pressed on the canvas: the editor gets every key except the ones returned here, which the
 *   shell takes before the editor sees them (`interceptEditorKeys`). Typing in an editor text
 *   field never reaches this function.
 *
 * Modified shortcuts (Save, zoom, undo) belong to the editor, which maps them per platform (Cmd on
 * a Mac, Ctrl elsewhere). The shell only forwards Save, using the bridge's platform check, so the
 * browser's "Save page" never opens.
 */
import { isEditableTarget, isSaveShortcut, type KeyPlatform } from '@greenfield/bridge';

export type ShellAction =
  /** Open "Comment or ask". */
  | 'comment'
  /** Close what's open in the shell and give the canvas focus. */
  | 'canvas'
  /** F6 / Shift+F6: move focus to the next / previous pane. */
  | 'next-pane'
  | 'previous-pane'
  /** The platform's Save chord, pressed in the shell: save the document. */
  | 'save';

type Key = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing' | 'target'
>;

const modified = (e: Key) => e.metaKey || e.ctrlKey || e.altKey;

export function shellKeyAction(
  e: Key,
  where: 'shell' | 'canvas',
  platform: KeyPlatform,
): ShellAction | null {
  if (e.isComposing) return null;
  if (e.key === 'F6' && !modified(e)) return e.shiftKey ? 'previous-pane' : 'next-pane';
  if (e.key.toLowerCase() === 'c' && !modified(e) && !e.shiftKey) {
    // C is the editor's comment tool; the shell's "Comment or ask" replaces it.
    if (e.repeat || isEditableTarget(e.target)) return null;
    return 'comment';
  }
  if (where === 'canvas') return null; // Escape and everything else stay the editor's
  if (e.key === 'Escape') return 'canvas';
  if (isSaveShortcut(e, platform)) return 'save';
  return null;
}
