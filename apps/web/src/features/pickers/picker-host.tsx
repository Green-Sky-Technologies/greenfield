'use client';

/**
 * Where the pickers open (Story 5.11): it registers them for `openColourPicker` and
 * `openFontPicker` (open.ts), and answers the canvas's `ui.request colorPicker` (2.11) for a
 * layer's fill or stroke, writing through a gesture so each change is one undo step. One picker
 * is open at a time.
 */
import { useEditorStore, useGesture, useUiRequest } from '@greenfield/editor-state/react';
import { useEffect, useRef, useState } from 'react';
import { ColourPicker } from './colour-picker';
import { FontPicker } from './font-picker';
import {
  openColourPicker,
  openFontPicker,
  registerPickers,
  type Anchor,
  type ColourPickerOptions,
  type ColourValue,
  type FontPickerOptions,
} from './open';
import { paintCommands, paintTarget, paintValue } from './paint';

type Open = { id: number; anchor: Anchor } & (
  { kind: 'colour'; opts: ColourPickerOptions } | { kind: 'font'; opts: FontPickerOptions }
);

declare global {
  interface Window {
    /** Dev and test builds only: open a picker as a panel does, for e2e checks. */
    __greenfieldPickers?: {
      openColourPicker: typeof openColourPicker;
      openFontPicker: typeof openFontPicker;
    };
  }
}

/** The canvas's request position (its CSS pixels) in window coordinates. */
function canvasToWindow(at: Anchor | null): Anchor {
  const frame = document.querySelector('iframe[title="Design canvas"]')?.getBoundingClientRect();
  return { x: (frame?.left ?? 0) + (at?.x ?? 0), y: (frame?.top ?? 0) + (at?.y ?? 0) };
}

export function PickerHost() {
  const store = useEditorStore();
  const request = useUiRequest();
  const gesture = useGesture('Change colour');
  const [open, setOpen] = useState<Open | null>(null);
  const current = useRef<Open | null>(null);

  /** Close `o` if it is still the open one, then tell its opener how it ended. */
  const end = (o: Open, how: () => void) => {
    if (current.current !== o) return;
    current.current = null;
    setOpen(null);
    how();
  };

  useEffect(() => {
    let opened = 0;
    const show = (next: Open) => {
      const was = current.current;
      current.current = next;
      setOpen(next);
      was?.opts.onCancel(); // replaced by the new one
    };
    if (process.env.NODE_ENV !== 'production')
      window.__greenfieldPickers = { openColourPicker, openFontPicker };
    return registerPickers({
      colour: (anchor, opts) => show({ id: ++opened, kind: 'colour', anchor, opts }),
      font: (anchor, opts) => show({ id: ++opened, kind: 'font', anchor, opts }),
    });
  }, []);

  // The canvas's own colour controls (canvas mode): a layer's fill or stroke.
  useEffect(() => {
    if (request?.kind !== 'colorPicker') return;
    const target = paintTarget(request.data);
    if (!target) return store.requestDone(); // page background, effects…: not ours yet
    const node = () => store.getState().nodes.get(target.ids[0]!);
    const write = (value: ColourValue) => gesture.preview(paintCommands(target, node(), value));
    openColourPicker(canvasToWindow(request.screen), {
      value: paintValue(target, node()),
      onPreview: write,
      onCommit: (value) => {
        write(value);
        gesture.commit().catch(() => {});
      },
      onCancel: () => {
        gesture.cancel().catch(() => {});
        store.requestDone();
      },
    });
  }, [request, store, gesture]);

  if (!open) return null;
  const close = () => end(open, () => open.opts.onCancel());
  if (open.kind === 'font') {
    return (
      <FontPicker
        key={open.id}
        anchor={open.anchor}
        family={open.opts.family}
        onClose={close}
        onPick={(family) => end(open, () => open.opts.onCommit(family))}
      />
    );
  }
  return (
    <ColourPicker
      key={open.id}
      anchor={open.anchor}
      value={open.opts.value}
      onPreview={open.opts.onPreview}
      onCommit={open.opts.onCommit}
      onClose={close}
    />
  );
}
