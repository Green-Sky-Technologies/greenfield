'use client';

/**
 * The Design tab. Stub for lane W2-B (Story 5.8: position, size, auto layout, fills, strokes,
 * effects, text, mixed values; number fields scrub with `useGesture`). Reads `useSelection` and
 * `useNode` (the selected layers' full fields).
 */
import { useNode, useSelection } from '@greenfield/editor-state/react';
import { StylesSection } from './styles/styles-section';

const num = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : '–');

export function DesignTab() {
  const selection = useSelection();
  const node = useNode(selection[0]);
  if (!selection.length) {
    return (
      <p data-testid="design-tab" data-selected="" className="p-4 text-xs text-muted">
        Nothing selected
      </p>
    );
  }
  return (
    <section aria-label="Design" data-testid="design-tab" data-selected={selection.join(',')}>
      <div className="flex items-baseline justify-between border-b border-border px-4 py-3.5">
        <span className="text-[13px] font-semibold" data-testid="design-tab-name">
          {selection.length > 1 ? `${selection.length} layers` : (node?.name ?? '…')}
        </span>
        <span className="font-mono text-[11px] text-muted">{node?.type ?? ''}</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 border-b border-border px-4 py-3.5 font-mono text-xs">
        {(['x', 'y', 'width', 'height'] as const).map((k) => (
          <div key={k} className="flex gap-2 bg-surface-2 px-2.5 py-1.5">
            <dt className="text-muted">
              {k === 'width' ? 'W' : k === 'height' ? 'H' : k.toUpperCase()}
            </dt>
            <dd data-testid={`design-${k}`}>{num(node?.[k])}</dd>
          </div>
        ))}
      </dl>
      <p className="px-4 pt-3 type-label text-muted">Design · Story 5.8</p>
      <StylesSection />
    </section>
  );
}
