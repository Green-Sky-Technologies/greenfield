'use client';

/** The Prototype tab. Stub for lane W2-E (Story 5.12: links and transitions, `proto.*`). */
import { useSelection } from '@greenfield/editor-state/react';

export function PrototypeTab() {
  const selection = useSelection();
  return (
    <p data-testid="prototype-tab" className="p-4 text-xs text-muted">
      Prototype · Story 5.12 · {selection.length} selected
    </p>
  );
}
