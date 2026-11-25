'use client';

/**
 * The small toolbar over the selection while the edit panel is hidden (Cmd+\, SPEC §4). Stub for
 * lane W2-D (Story 5.10): shows only when it would, with the selection count.
 */
import { useSelection } from '@greenfield/editor-state/react';

export function FloatingToolbar({ editPanelHidden }: { editPanelHidden: boolean }) {
  const selection = useSelection();
  if (!editPanelHidden || !selection.length) return null;
  return (
    <div
      role="toolbar"
      aria-label="Selection"
      data-testid="floating-toolbar"
      className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 border border-border bg-surface px-3 py-1.5 text-xs"
    >
      Floating toolbar · Story 5.10 · {selection.length} selected
    </div>
  );
}
