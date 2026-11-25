'use client';

/** The Layers tab (Story 5.7): the page list over the current page's layer tree. */
import { LayerTree } from './layer-tree';
import { PagesList } from './pages-list';

export function LayersPanel() {
  return (
    <div data-testid="layers-panel" className="flex min-h-0 flex-1 flex-col">
      <PagesList />
      <section
        aria-label="Layers"
        className="mt-2 flex min-h-0 flex-1 flex-col border-t border-border"
      >
        <h2 className="type-label px-4 pt-3.5 pb-1.5 text-muted">Layers</h2>
        <LayerTree />
      </section>
    </div>
  );
}
