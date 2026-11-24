/**
 * Keyboard focus between the host page and the editor iframe (Story 5.4).
 *
 * FigCraft draws into one `<canvas>` that takes keyboard focus; while a text field or text layer
 * is being edited, focus moves to a hidden `<input>` (egui's text agent). Keys pressed in the
 * iframe never reach the host page, so a host shortcut that should also work from the canvas
 * (C for "Comment or ask") has to be taken in the iframe before the editor sees it, or both would
 * act on it.
 */
import type { Unsubscribe } from './types';

/** Whether a key event's target is a place where typing goes (so letters are text, not shortcuts). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== 'string') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(
    type,
  );
}

/**
 * Give the editor keyboard focus: the iframe, its window and the editor's canvas (so the editor's
 * own shortcuts work at once). Returns false when the editor isn't loaded yet.
 */
export function focusEditor(iframe: HTMLIFrameElement): boolean {
  iframe.focus({ preventScroll: true });
  const win = iframe.contentWindow;
  if (!win) return false;
  win.focus();
  const canvas = editorCanvas(iframe);
  canvas?.focus({ preventScroll: true });
  return canvas !== null;
}

/** Whether keyboard focus is in the editor (the host page's focused element is its iframe). */
export function editorHasFocus(iframe: HTMLIFrameElement): boolean {
  return iframe.ownerDocument.activeElement === iframe;
}

function editorCanvas(iframe: HTMLIFrameElement): HTMLElement | null {
  try {
    return iframe.contentDocument?.querySelector<HTMLElement>('canvas') ?? null;
  } catch {
    return null; // not same-origin (yet): about:blank before the editor's page loads
  }
}

/**
 * Let the host take keys pressed in the editor before the editor sees them. `take` runs for every
 * keydown in the editor's window that isn't typing into a text field; when it returns true the
 * event is cancelled and stopped, so the editor never acts on it. Survives reloads of the iframe.
 */
export function interceptEditorKeys(
  iframe: HTMLIFrameElement,
  take: (e: KeyboardEvent) => boolean,
): Unsubscribe {
  let win: Window | null = null;
  const onKeyDown = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    if (!take(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const attach = () => {
    win?.removeEventListener('keydown', onKeyDown, true);
    win = iframe.contentWindow;
    // Capture on the window runs before the editor's own listeners (on its document and canvas).
    win?.addEventListener('keydown', onKeyDown, true);
  };
  attach();
  iframe.addEventListener('load', attach);
  return () => {
    iframe.removeEventListener('load', attach);
    win?.removeEventListener('keydown', onKeyDown, true);
    win = null;
  };
}
