'use client';

/**
 * The font picker (Story 5.11, design 01-canvas-mode/5.11): a search over the attached design
 * system's families first, then the file's and the editor's. Arrow keys move, Enter picks.
 */
import { useEditorStore } from '@greenfield/editor-state/react';
import { useParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { designSystemFontsAction } from './actions';
import { filterFonts, fontList, type FontEntry } from './fonts';
import { readLibrary } from './library';
import type { Anchor } from './open';
import { Popover, SearchField } from './popover';

/** The families to offer: read when the picker opens. */
function useFonts(): FontEntry[] | null {
  const store = useEditorStore();
  const projectId = (useParams() as { projectId?: string } | null)?.projectId;
  const [fonts, setFonts] = useState<FontEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    const designSystem = projectId
      ? designSystemFontsAction(projectId).then((r) => (r.ok ? r.data : []))
      : Promise.resolve([]);
    Promise.all([
      designSystem.catch(() => []),
      readLibrary(store).catch(() => null),
      store.run('text.fonts', {}).catch(() => []),
    ]).then(([ds, library, installed]) => {
      if (!live) return;
      setFonts(
        fontList({
          designSystem: ds,
          file: library?.styles.flatMap((s) => (s.font ? [s.font] : [])) ?? [],
          installed: Array.isArray(installed) ? installed.map(String) : [],
        }),
      );
    });
    return () => {
      live = false;
    };
  }, [store, projectId]);
  return fonts;
}

export function FontPicker({
  anchor,
  family,
  onPick,
  onClose,
}: {
  anchor: Anchor;
  family: string;
  onPick(family: string): void;
  onClose(): void;
}) {
  const fonts = useFonts();
  const [query, setQuery] = useState('');
  /** The highlighted row; until the user moves it, the current family's. */
  const [active, setActive] = useState<number | null>(null);
  const list = filterFonts(fonts ?? [], query);
  const listId = useId();
  const at = Math.min(
    active ??
      Math.max(
        0,
        list.findIndex((f) => f.family === family),
      ),
    Math.max(0, list.length - 1),
  );

  return (
    <Popover anchor={anchor} label="Font" testId="font-picker" width={268} onClose={onClose}>
      <div
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((at + step + list.length) % Math.max(1, list.length));
          } else if (e.key === 'Enter' && list[at]) {
            e.preventDefault();
            onPick(list[at].family);
          }
        }}
      >
        <SearchField
          label="Search fonts"
          value={query}
          onChange={(q) => {
            setQuery(q);
            setActive(0);
          }}
        />
      </div>
      {fonts === null ? (
        <p className="py-2 text-xs text-muted">Loading fonts…</p>
      ) : list.length === 0 ? (
        <p className="py-2 text-xs text-muted">No font matches “{query}”.</p>
      ) : (
        <ul
          id={listId}
          role="listbox"
          aria-label="Fonts"
          className="-mx-1 max-h-72 overflow-y-auto px-1"
        >
          {list.map((f, i) => (
            <li
              key={f.family}
              role="option"
              aria-selected={i === at}
              data-current={f.family === family || undefined}
              ref={i === at ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
              className={`flex h-7 cursor-pointer items-center justify-between gap-2 px-1.5 ${i === at ? 'bg-surface' : ''} ${f.family === family ? 'text-accent' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => onPick(f.family)}
            >
              <span className="truncate">{f.family}</span>
              <span className="shrink-0 text-[11px] text-muted">{f.source}</span>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
