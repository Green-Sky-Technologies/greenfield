/**
 * The shell's keyboard map (Story 5.4). One function decides what a key does, wherever it was
 * pressed, so no key can act in both the shell and the editor:
 *
 * - Pressed in the shell (top bar, panels, composer, menus): the editor never sees it.
 * - Pressed on the canvas: the editor gets every key except the ones returned here, which the
 *   shell takes before the editor sees them (`interceptEditorKeys`). Typing in an editor text
 *   field never reaches this function. The editor binds F6 (its own regions) and Cmd+\ (its own
 *   panels) too; the shell takes both in canvas mode, and leaves Cmd+\ to the editor while its own
 *   panels are back (Story 5.13).
 *
 * Modified shortcuts belong to the platform: Cmd on a Mac, Ctrl elsewhere, the same rule the
 * editor uses (`platformFromUserAgent`). Nothing here hard-codes Ctrl.
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
  /** Cmd+\ (Ctrl+\ off a Mac): hide or show the edit panel. */
  | 'toggle-edit-panel'
  /** The platform's Save chord, pressed in the shell: save the document. */
  | 'save';

type Key = Pick<
  KeyboardEvent,
  | 'key'
  | 'code'
  | 'metaKey'
  | 'ctrlKey'
  | 'altKey'
  | 'shiftKey'
  | 'repeat'
  | 'isComposing'
  | 'target'
>;

const modified = (e: Key) => e.metaKey || e.ctrlKey || e.altKey;

/** The platform's modifier alone: Cmd on a Mac, Ctrl elsewhere. */
const platformMod = (e: Key, platform: KeyPlatform) =>
  !e.altKey &&
  !e.shiftKey &&
  (platform === 'mac' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

/** Cmd+\ on a Mac, Ctrl+\ elsewhere (by the physical key too, for layouts where \ moves). */
export const isEditPanelShortcut = (e: Key, platform: KeyPlatform) =>
  (e.key === '\\' || e.code === 'Backslash') && platformMod(e, platform);

/** How the edit panel shortcut reads on this platform, for labels and `aria-keyshortcuts`. */
export const editPanelChord = (platform: KeyPlatform) =>
  platform === 'mac' ? 'Meta+\\' : 'Control+\\';

export interface KeyContext {
  /** The editor draws only the canvas (false while its own panels are back, Story 5.13). */
  canvasMode: boolean;
}

export function shellKeyAction(
  e: Key,
  where: 'shell' | 'canvas',
  platform: KeyPlatform,
  { canvasMode }: KeyContext = { canvasMode: true },
): ShellAction | null {
  if (e.isComposing) return null;
  if (e.key === 'F6' && !modified(e)) return e.shiftKey ? 'previous-pane' : 'next-pane';
  if (isEditPanelShortcut(e, platform)) return canvasMode ? 'toggle-edit-panel' : null;
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
