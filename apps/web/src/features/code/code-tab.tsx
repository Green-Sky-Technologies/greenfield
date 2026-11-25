'use client';

/** The Code tab. Stub for lane W2-E (Story 5.12: generated code for the selection, 7.2). */
import { useSelection } from '@greenfield/editor-state/react';

export function CodeTab() {
  const selection = useSelection();
  return (
    <p data-testid="code-tab" className="p-4 text-xs text-muted">
      Code · Story 5.12 · {selection.length} selected
    </p>
  );
}
