'use client';

/**
 * The Comments tab. Stub for lane W2-G (Story 6.4: open and resolved threads, jump to one,
 * reply, Ask Claude).
 */
import { useDocument } from '@greenfield/editor-state/react';

export function CommentsPanel() {
  const doc = useDocument();
  return (
    <p data-testid="comments-panel" className="p-4 text-xs text-muted">
      Comments · Story 6.4 · {doc ? 'file open' : 'no file yet'}
    </p>
  );
}
