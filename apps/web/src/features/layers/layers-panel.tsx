'use client';

/**
 * The Layers tab. Stub for lane W2-A (Story 5.7: pages, a virtualised layer tree patched from
 * events, rename, reorder, lock, hide, multi-select). Reads `usePages`, `usePageTree` (its
 * `rows` are the row model, `visibleRows` collapses) and `useSelection`.
 */
import { usePages, usePageTree, useSelection } from '@greenfield/editor-state/react';

export function LayersPanel() {
  const pages = usePages();
  const tree = usePageTree();
  const selection = useSelection();
  return (
    <section aria-label="Layers" data-testid="layers-panel" className="space-y-3 p-4 text-xs">
      <p className="type-label text-muted">Layers · Story 5.7</p>
      <p data-testid="layers-summary">
        {pages.length} {pages.length === 1 ? 'page' : 'pages'} · {tree.rows.length} layers ·{' '}
        {selection.length} selected
      </p>
      <ul aria-label="Selected layers" className="space-y-1">
        {selection.map((id) => (
          <li key={id} className="border-l-2 border-user pl-2 text-text">
            {tree.nodes.get(id)?.name ?? `Layer ${id}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
