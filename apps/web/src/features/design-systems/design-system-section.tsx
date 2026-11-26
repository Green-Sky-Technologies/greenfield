'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
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
 * Story 10.5, in the edit panel's Design tab: which system the file follows (a menu that opens
 * the system in Settings), what it has from it, and whether a newer version is waiting (10.6).
 */
export function DesignSystemSection({ projectId }: { projectId: string }) {
  const ds = useProjectDesignSystem(projectId);
  const { slug } = useParams<{ slug?: string }>() ?? {};
  const [open, setOpen] = useState(false);
  if (!ds) return null;
  const newer = ds.published !== null && ds.published > ds.version;
  const href = `/w/${slug}/settings/design-systems/${ds.system.id}`;
  const rows = [
    ['Colours', ds.counts.colours],
    ['Type styles', ds.counts.type],
    ['Components', ds.counts.components],
    ['Spacing', ds.counts.spacing],
  ] as const;
  return (
    <section
      aria-label="Design system"
      className="flex flex-col gap-3 border-b border-border px-4 py-3.5 text-sm"
    >
      <h3 className="type-label text-muted">Design system</h3>
      <div
        className="relative"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="shell-focus flex w-full items-center justify-between border border-border bg-surface px-3 py-2 text-left hover:border-muted aria-expanded:border-user"
        >
          <span className="truncate">
            {ds.system.name} · v{ds.version}
          </span>
          <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.25" />
          </svg>
        </button>
        {open && (
          <ul
            role="menu"
            aria-label={`${ds.system.name} design system`}
            className="absolute inset-x-0 top-full z-30 mt-1 border border-border bg-surface py-1 text-sm shadow-[0_8px_24px_-12px_rgb(0_0_0/0.5)]"
          >
            <li role="none" className="px-3 py-1.5 text-xs text-muted">
              This file follows v{ds.version}
              {newer ? `; v${ds.published} is published` : ''}.
            </li>
            <li role="none">
              <Link
                role="menuitem"
                href={href}
                className="shell-focus block px-3 py-1.5 hover:bg-surface-2"
              >
                {newer
                  ? `Review v${ds.published} in Settings`
                  : `Open ${ds.system.name} in Settings`}
              </Link>
            </li>
          </ul>
        )}
      </div>
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
