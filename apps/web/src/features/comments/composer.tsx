'use client';

/**
 * The comment composer at a point on the canvas, opened by the comment tool's `ui.request
 * comment.new` (2.11). Stub for lane W2-G (Story 6.2: Comment or Ask Claude, with the element
 * attached). Esc or Close answers the request.
 */
import { useEditorStore, useUiRequest } from '@greenfield/editor-state/react';

export function Composer() {
  const request = useUiRequest();
  const store = useEditorStore();
  if (request?.kind !== 'comment.new') return null;
  return (
    <div
      role="dialog"
      aria-label="New comment"
      data-testid="composer"
      className="absolute z-30 w-72 border border-border bg-surface p-3 text-xs"
      style={{ left: request.screen?.x ?? 0, top: request.screen?.y ?? 0 }}
    >
      <p className="type-label text-muted">Comment composer · Story 6.2</p>
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
