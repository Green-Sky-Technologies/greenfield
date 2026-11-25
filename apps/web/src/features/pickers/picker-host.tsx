'use client';

/**
 * Where our pickers open: the canvas's `ui.request colorPicker` (2.11), and later the Design
 * tab's own fields. Stub for lane W2-C (Story 5.11: colour picker with variables and styles,
 * font picker, export panel). Esc or Close answers the request.
 */
import { useEditorStore, useUiRequest } from '@greenfield/editor-state/react';

export function PickerHost() {
  const request = useUiRequest();
  const store = useEditorStore();
  if (request?.kind !== 'colorPicker') return null;
  return (
    <div
      role="dialog"
      aria-label="Colour"
      data-testid="picker-host"
      className="absolute z-30 w-60 border border-border bg-surface p-3 text-xs"
      style={{ left: request.screen?.x ?? 0, top: request.screen?.y ?? 0 }}
    >
      <p className="type-label text-muted">Colour picker · Story 5.11</p>
      <button
        type="button"
        className="shell-focus mt-2 px-1 py-1 hover:bg-surface-2"
        onClick={() => store.requestDone()}
      >
        Close
      </button>
    </div>
  );
}
