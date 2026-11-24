'use client';

/**
 * The project's top bar (Story 5.1): where you are (projects, project, file), "Comment or ask",
 * who has access, zoom and Share. Square corners and hairlines (brand); green marks the user's own
 * actions and presence, ember the agent (D24).
 */
import type { Editor } from '@greenfield/bridge';
import Link from 'next/link';
import type { Ref } from 'react';
import { ExportMenu } from '@/features/export/export-menu';
import { People, type Person } from './people';
import type { ShellMenu } from './project-shell';
import { ShareMenu } from './share-menu';
import { ZoomControl } from './zoom-control';

export interface TopBarProps {
  slug: string;
  project: { id: string; name: string; archived: boolean };
  fileName: string;
  people: Person[];
  meId: string;
  canShare: boolean;
  canExport: boolean;
  canComment: boolean;
  editor: Editor | null;
  menu: ShellMenu;
  onMenu: (menu: ShellMenu) => void;
  barRef?: Ref<HTMLElement>;
}

export function TopBar({
  slug,
  project,
  fileName,
  people,
  meId,
  canShare,
  canExport,
  editor,
  menu,
  onMenu,
  barRef,
}: TopBarProps) {
  const toggle = (m: Exclude<ShellMenu, null>) => onMenu(menu === m ? null : m);
  return (
    <header
      ref={barRef}
      aria-label="Project"
      className="grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-border bg-surface px-3 text-sm"
    >
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
        <Link
          href={`/w/${slug}`}
          className="shell-focus shrink-0 px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-text"
        >
          All projects
        </Link>
        <span aria-hidden className="text-border">
          /
        </span>
        <span className="truncate font-medium text-text" title={project.name}>
          {project.name}
        </span>
        <span className="truncate text-xs text-muted max-lg:sr-only" title={fileName}>
          <span className="sr-only">File: </span>
          {fileName}
        </span>
        {project.archived && (
          <span className="shrink-0 border border-border px-1.5 text-xs text-muted">
            Archived (read-only)
          </span>
        )}
      </nav>

      <button
        type="button"
        onClick={() => toggle('comment')}
        aria-expanded={menu === 'comment'}
        aria-keyshortcuts="C"
        aria-label="Comment or ask Claude"
        className="shell-focus group flex h-8 w-[min(22rem,40vw)] items-center gap-2 border border-border bg-bg px-2.5 text-left text-muted hover:border-muted aria-expanded:border-user"
      >
        <span aria-hidden className="size-1.5 shrink-0 bg-agent" />
        <span className="flex-1 truncate">Comment or ask</span>
        <kbd className="border border-border px-1 font-sans text-[11px] leading-4 text-muted">
          C
        </kbd>
      </button>

      <div className="flex items-center justify-end gap-2">
        <People people={people} meId={meId} />
        <ZoomControl editor={editor} open={menu === 'zoom'} onToggle={() => toggle('zoom')} />
        {canExport && editor && <ExportMenu editor={editor} />}
        <ShareMenu
          projectId={project.id}
          canShare={canShare}
          open={menu === 'share'}
          onToggle={() => toggle('share')}
        />
      </div>
    </header>
  );
}
