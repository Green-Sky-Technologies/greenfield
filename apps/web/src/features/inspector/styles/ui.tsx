'use client';

/** The styles section's building blocks, in the Design tab's look (design 01-canvas-mode/5.8). */
import type { CommandId, CommandParams } from '@greenfield/bridge';
import { useEditorStore } from '@greenfield/editor-state/react';
import { useCallback, useState, type ReactNode, type SelectHTMLAttributes } from 'react';

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-b border-border px-4 py-3.5">
      <div className="flex items-center justify-between">
        <h3 className="type-label text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A labelled row: the label on the left, the control filling the rest. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="truncate text-muted" title={label}>
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="shell-focus h-7 min-w-0 flex-1 bg-surface-2 px-2 text-xs text-text outline-none"
    />
  );
}

export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="shell-focus grid size-7 shrink-0 place-items-center text-muted hover:bg-surface-2 hover:text-text"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const PLUS = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden
  >
    <path d="M6 1v10M1 6h10" />
  </svg>
);

export const MINUS = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden
  >
    <path d="M1 6h10" />
  </svg>
);

/** Detach / unbind: a broken link. */
export const UNLINK = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden
  >
    <path d="M6.5 9.5l-2 2a2 2 0 01-2.8-2.8l2-2M9.5 6.5l2-2a2 2 0 012.8 2.8l-2 2M3 3l10 10" />
  </svg>
);

/** A command from the section, with its error shown under it. Resolves once it has run. */
export function useRun() {
  const store = useEditorStore();
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    <C extends CommandId>(command: C, params: CommandParams<C>): Promise<void> => {
      setError(null);
      return store.run(command, params).then(
        () => {},
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      );
    },
    [store],
  );
  return { run, error };
}
