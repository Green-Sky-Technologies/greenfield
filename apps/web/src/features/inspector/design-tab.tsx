'use client';

/**
 * The Design tab (Story 5.8): for the selection, position, size and constraints; auto layout
 * and resizing; opacity, blend and radius; fills, strokes and effects; typography. Several
 * layers selected: shared values, "Mixed" where they differ, and an edit sets them all. Values
 * Claude set in the last turn carry an ember mark and "changed by Claude · Revert" (Story 5.5).
 * Reads `useSelection` and the selected layers' fields; writes through the store.
 */
import type { NodeFields } from '@greenfield/editor-state';
import { useEditorState, useSelection } from '@greenfield/editor-state/react';
import { useMemo, useState } from 'react';
import { StylesSection } from './styles/styles-section';
import { AgentChangesProvider } from './agent-changes';
import { ReportContext } from './controls';
import { isText, MIXED, shared, typeName } from './fields';
import { LayerSection, LayoutSection, PositionSection } from './geometry';
import { EffectsSection, PaintsSection } from './paints';
import { TypographySection } from './typography';

export function DesignTab() {
  return (
    <AgentChangesProvider>
      <Inspector />
    </AgentChangesProvider>
  );
}

function Inspector() {
  const selection = useSelection();
  const fields = useEditorState((s) => s.nodes);
  const nodes = useMemo(
    () => selection.map((id) => fields.get(id)).filter((n): n is NodeFields => !!n),
    [selection, fields],
  );
  // Constraints apply inside a frame, not to a page's top-level layers.
  const nested = useEditorState((s) =>
    selection.some((id) => {
      const parent = s.tree.nodes.get(id)?.parent;
      return parent !== undefined && parent !== s.tree.page;
    }),
  );
  const [error, setError] = useState<string | null>(null);

  if (!selection.length) {
    return (
      <p data-testid="design-tab" data-selected="" className="p-4 text-xs text-muted">
        Nothing selected
      </p>
    );
  }
  const type = nodes.length ? shared(nodes, (n) => n.type) : undefined;
  const ids = nodes.map((n) => n.id);
  return (
    <ReportContext.Provider value={setError}>
      <section aria-label="Design" data-testid="design-tab" data-selected={selection.join(',')}>
        <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3.5">
          <span className="truncate text-[13px] font-semibold" data-testid="design-tab-name">
            {selection.length > 1 ? `${selection.length} layers` : (nodes[0]?.name ?? '…')}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-muted">
            {type === MIXED ? 'Mixed' : typeName(type)}
          </span>
        </div>
        {nodes.length > 0 && (
          <>
            <PositionSection ids={ids} nodes={nodes} nested={nested} />
            <LayoutSection ids={ids} nodes={nodes} />
            <LayerSection ids={ids} nodes={nodes} />
            {nodes.every(isText) && <TypographySection ids={ids} nodes={nodes} />}
            <PaintsSection ids={ids} nodes={nodes} kind="fills" />
            <PaintsSection ids={ids} nodes={nodes} kind="strokes" />
            <EffectsSection ids={ids} nodes={nodes} />
          </>
        )}
        <StylesSection />
        {error && (
          <p role="status" className="px-4 py-3 text-xs text-danger" data-testid="design-error">
            {error}
          </p>
        )}
      </section>
    </ReportContext.Provider>
  );
}
