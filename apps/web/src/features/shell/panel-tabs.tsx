'use client';

/**
 * A side panel with tabs (the mockup's left and right panels): a tab list and one panel per tab.
 * Every panel stays mounted while hidden, so a tab keeps its state (a running agent turn, a
 * scroll position) when you switch away. Arrow keys, Home and End move between tabs (WAI-ARIA
 * tabs, automatic activation).
 */
import { useId, useRef, type ReactNode, type Ref } from 'react';

export interface Tab<T extends string> {
  id: T;
  label: string;
  content: ReactNode;
}

interface Props<T extends string> {
  label: string;
  tabs: readonly Tab<T>[];
  selected: T;
  onSelect: (id: T) => void;
  side: 'left' | 'right';
  hidden?: boolean;
  paneRef?: Ref<HTMLElement>;
}

export function PanelTabs<T extends string>({
  label,
  tabs,
  selected,
  onSelect,
  side,
  hidden,
  paneRef,
}: Props<T>) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === selected);
    const to =
      e.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    onSelect(tabs[to]!.id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };

  return (
    <aside
      ref={paneRef}
      aria-label={label}
      hidden={hidden}
      tabIndex={-1}
      className={`flex min-h-0 shrink-0 flex-col bg-surface outline-none ${
        side === 'left' ? 'w-[312px] border-r' : 'w-[280px] border-l'
      } border-border`}
    >
      <div
        ref={list}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex h-10 shrink-0 items-stretch gap-4 border-b border-border px-4 text-xs"
      >
        {tabs.map((t) => {
          const on = t.id === selected;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${base}-${t.id}-tab`}
              aria-selected={on}
              aria-controls={`${base}-${t.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => onSelect(t.id)}
              className={`shell-focus ${
                on
                  ? 'font-semibold text-text shadow-[inset_0_-2px_0_var(--ink)]'
                  : 'text-muted hover:text-text'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-${t.id}`}
          aria-labelledby={`${base}-${t.id}-tab`}
          hidden={t.id !== selected}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        >
          {t.content}
        </div>
      ))}
    </aside>
  );
}
