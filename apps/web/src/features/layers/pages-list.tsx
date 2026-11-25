'use client';

/**
 * The page list (Story 5.7): switch, add, rename (double-click) and delete pages. Reads `usePages`;
 * every change goes to the editor (`page.*`) and comes back as its events.
 */
import type { PageSummary } from '@greenfield/editor-state';
import { useEditorStore, usePages } from '@greenfield/editor-state/react';
import { useState } from 'react';
import { CloseIcon, PageIcon, PlusIcon } from './icons';
import { NameInput } from './name-input';

export function PagesList() {
  const pages = usePages();
  const store = useEditorStore();
  const [renaming, setRenaming] = useState<number | null>(null);
  const run = (p: Promise<unknown>) => p.catch(() => {}); // the editor's state stays as it was

  const add = () => {
    const names = new Set(pages.map((p) => p.name));
    let n = pages.length + 1;
    while (names.has(`Page ${n}`)) n++;
    run(store.run('page.add', { name: `Page ${n}` }));
  };

  return (
    <section aria-label="Pages" className="shrink-0">
      <div className="flex items-center justify-between py-2.5 pr-3 pl-4">
        <h2 className="type-label text-muted">Pages</h2>
        <button
          type="button"
          aria-label="Add page"
          onClick={add}
          className="shell-focus p-1 text-muted hover:text-text"
        >
          <PlusIcon />
        </button>
      </div>
      <ul aria-label="Pages" className="max-h-48 overflow-y-auto">
        {pages.map((p) => (
          <PageRow
            key={p.id}
            page={p}
            renaming={renaming === p.id}
            canDelete={pages.length > 1}
            onSelect={() => !p.current && run(store.run('page.select', { id: p.id }))}
            onRename={() => setRenaming(p.id)}
            onRenamed={(name) => {
              setRenaming(null);
              if (name !== null && name !== p.name)
                run(store.run('page.rename', { id: p.id, name }));
            }}
            onDelete={() => run(store.run('page.delete', { id: p.id }))}
          />
        ))}
      </ul>
    </section>
  );
}

function PageRow({
  page,
  renaming,
  canDelete,
  onSelect,
  onRename,
  onRenamed,
  onDelete,
}: {
  page: PageSummary;
  renaming: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onRename: () => void;
  onRenamed: (name: string | null) => void;
  onDelete: () => void;
}) {
  return (
    <li
      className={`group flex h-7 items-center gap-2 pr-2 pl-3 ${
        page.current ? 'bg-user/15 text-user' : 'text-text hover:bg-surface-2'
      }`}
    >
      <span className={page.current ? '' : 'text-muted'}>
        <PageIcon />
      </span>
      {renaming ? (
        <NameInput label="Page name" value={page.name} onDone={onRenamed} />
      ) : (
        <button
          type="button"
          aria-current={page.current ? 'page' : undefined}
          onClick={onSelect}
          onDoubleClick={onRename}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault();
              onRename();
            }
          }}
          className="shell-focus min-w-0 flex-1 truncate text-left text-xs"
        >
          {page.name}
        </button>
      )}
      {canDelete && !renaming && (
        <button
          type="button"
          aria-label={`Delete page ${page.name}`}
          onClick={onDelete}
          className="shell-focus invisible p-0.5 text-muted group-focus-within:visible group-hover:visible hover:text-text"
        >
          <CloseIcon />
        </button>
      )}
    </li>
  );
}
