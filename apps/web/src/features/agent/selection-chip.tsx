'use client';

/**
 * The selection a message goes with, as a chip (Story 5.2): the layer's name in green (the
 * user's colour), `+N` for more. Names come from the page tree in the store.
 */
import type { NodeId } from '@greenfield/bridge';
import { useEditorState } from '@greenfield/editor-state/react';

export function SelectionChip({ ids }: { ids: readonly NodeId[] }) {
  const first = useEditorState((s) => (ids.length ? s.tree.nodes.get(ids[0]!)?.name : undefined));
  if (!ids.length) return null;
  const name = first || `Layer ${ids[0]}`;
  return (
    <span
      data-testid="selection-chip"
      className="inline-flex max-w-full items-center gap-1 border border-user px-1.5 font-mono text-[11px] leading-5 text-user"
    >
      <span className="truncate">{name}</span>
      {ids.length > 1 && <span className="shrink-0">+{ids.length - 1}</span>}
    </span>
  );
}
