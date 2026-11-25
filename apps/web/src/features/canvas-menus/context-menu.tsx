'use client';

/**
 * Our right-click menu, opened by the canvas's `ui.request contextMenu` (2.11) at the pointer.
 * Stub for lane W2-D (Story 5.10). Esc or Close answers the request.
 */
import { useEditorStore, useUiRequest } from '@greenfield/editor-state/react';

export function ContextMenu() {
  const request = useUiRequest();
  const store = useEditorStore();
  if (request?.kind !== 'contextMenu') return null;
  const ids = (request.data as { ids?: number[] } | null)?.ids ?? [];
  return (
    <div
      role="menu"
      aria-label="Layer actions"
      data-testid="context-menu"
      className="absolute z-30 w-56 border border-border bg-surface p-2 text-xs shadow-[0_12px_32px_-12px_rgb(0_0_0/0.5)]"
      style={{ left: request.screen?.x ?? 0, top: request.screen?.y ?? 0 }}
    >
      <p className="type-label text-muted">Context menu · Story 5.10</p>
      <p className="py-1">{ids.length} selected</p>
      <button
        type="button"
        role="menuitem"
        className="shell-focus w-full px-1 py-1 text-left hover:bg-surface-2"
        onClick={() => store.requestDone()}
      >
        Close
      </button>
    </div>
  );
}
