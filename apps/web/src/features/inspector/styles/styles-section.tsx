'use client';

/**
 * Styles, variables and instance properties in the Design tab. Stub for lane W2-C (Story 5.9:
 * instance properties and variants, apply and detach styles, bind to variables, variable modes).
 */
import { useSelection } from '@greenfield/editor-state/react';

export function StylesSection() {
  const selection = useSelection();
  return (
    <p data-testid="styles-section" className="px-4 py-3 text-xs text-muted">
      Styles and variables · Story 5.9 · {selection.length} selected
    </p>
  );
}
