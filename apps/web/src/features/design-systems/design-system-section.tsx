'use client';

import { useEffect, useState } from 'react';
import type { ProjectDesignSystem } from '@/server/services/design-systems/follow';

/** The file's design system, read once per project (it changes only with a library update). */
export function useProjectDesignSystem(projectId: string) {
  const [ds, setDs] = useState<ProjectDesignSystem | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${projectId}/design-system`)
      .then((r) => (r.ok ? (r.json() as Promise<ProjectDesignSystem | null>) : null))
      .catch(() => null)
      .then((v) => live && setDs(v));
    return () => {
      live = false;
    };
  }, [projectId]);
  return ds;
}

/**
 * Story 10.5, in the edit panel's Design tab (W2-B mounts it): which system the file follows,
 * what it has from it, and whether a newer version is waiting (10.6).
 */
export function DesignSystemSection({ projectId }: { projectId: string }) {
  const ds = useProjectDesignSystem(projectId);
  if (!ds) return null;
  const rows = [
    ['Colours', ds.counts.colours],
    ['Type styles', ds.counts.type],
    ['Components', ds.counts.components],
    ['Spacing', ds.counts.spacing],
  ] as const;
  return (
    <section aria-label="Design system" className="flex flex-col gap-3 text-sm">
      <h3 className="type-label text-muted">Design system</h3>
      <p className="border border-border bg-surface px-3 py-2">
        {ds.system.name} · v{ds.version}
      </p>
      <p className="text-xs text-muted">
        Claude uses its variables and components, and checks each turn.
      </p>
      {ds.published !== null && ds.published > ds.version && (
        <p role="note" className="text-xs text-agent">
          v{ds.published} is published. An admin can update this file from Settings → Design
          systems.
        </p>
      )}
      <h3 className="type-label mt-2 text-muted">Libraries in use</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
        {rows.map(([label, n]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="font-mono text-xs text-muted">{n}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
