'use client';

/**
 * How panels open the shared pickers (Story 5.11). Lane W2-C owns the pickers and this file's
 * implementation; panels (W2-B's inspector, W2-D's floating toolbar) call these and must not
 * depend on anything else under features/pickers. Until W2-C registers the real pickers, opening
 * one cancels at once.
 */
export interface Anchor {
  x: number;
  y: number;
}

/** A colour as the inspector holds it: hex (#rrggbb), or a variable/style binding id. */
export type ColourValue =
  { hex: string; opacity: number } | { variable: string } | { style: string };

export interface ColourPickerOptions {
  value: ColourValue;
  /** Called while the user drags (wrap in a gesture so a drag is one undo step). */
  onPreview(value: ColourValue): void;
  onCommit(value: ColourValue): void;
  onCancel(): void;
}

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
