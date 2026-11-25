'use client';

/**
 * How panels open the shared pickers (Story 5.11). Lane W2-C owns the pickers and this file's
 * implementation; panels (W2-B's inspector, W2-D's floating toolbar) call these and must not
 * depend on anything else under features/pickers. `PickerHost` registers the real pickers; with
 * none registered, opening one cancels at once.
 *
 * One picker is open at a time: opening another closes the first (its `onCancel` runs). The
 * picker opens below and right of `anchor`, moved to stay inside the window.
 */
export interface Anchor {
  /** Window (client) coordinates, e.g. a swatch's `getBoundingClientRect().left`/`.bottom`. */
  x: number;
  y: number;
}

/** A colour as the inspector holds it: hex (#rrggbb), or a variable/style binding id. */
export type ColourValue =
  { hex: string; opacity: number } | { variable: string } | { style: string };

/**
 * The colour picker stays open until Esc, a click outside, or another picker: `onCommit` may run
 * several times, once per change; `onCancel` runs once, when it closes.
 */
export interface ColourPickerOptions {
  value: ColourValue;
  /** Called while the user drags (wrap in a gesture so a drag is one undo step). */
  onPreview(value: ColourValue): void;
  /** A change is done: a drag ended, a hex typed, a variable or style picked, a detach. */
  onCommit(value: ColourValue): void;
  /** The picker closed. Revert a drag still open (Esc mid-drag); committed changes stay. */
  onCancel(): void;
}

/** The font picker closes with exactly one of `onCommit` (a family chosen) or `onCancel`. */
export interface FontPickerOptions {
  family: string;
  onCommit(family: string): void;
  onCancel(): void;
}

type Impl = {
  colour(anchor: Anchor, opts: ColourPickerOptions): void;
  font(anchor: Anchor, opts: FontPickerOptions): void;
};

let impl: Impl | null = null;

/** W2-C's PickerHost registers the real pickers here. */
export function registerPickers(next: Impl): () => void {
  impl = next;
  return () => {
    if (impl === next) impl = null;
  };
}

export function openColourPicker(anchor: Anchor, opts: ColourPickerOptions): void {
  if (impl) impl.colour(anchor, opts);
  else opts.onCancel();
}

export function openFontPicker(anchor: Anchor, opts: FontPickerOptions): void {
  if (impl) impl.font(anchor, opts);
  else opts.onCancel();
}
