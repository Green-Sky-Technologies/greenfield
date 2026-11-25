'use client';

/**
 * The editor shell (Epic 5): the top bar (5.1) above the embedded editor, and the keyboard and
 * focus rules between them (5.4). Talks to the editor only through `@greenfield/bridge`.
 *
 * Panes, in F6 order: the top bar, then the canvas. Esc in the shell closes what's open and gives
 * the canvas focus; C anywhere outside a text field opens "Comment or ask".
 */
import {
  focusEditor,
  interceptEditorKeys,
  platformFromUserAgent,
  type KeyPlatform,
} from '@greenfield/bridge';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentPanel } from '@/features/agent/agent-panel';
import { EditorEmbed, type EditorHandle } from '@/features/editor/editor-embed';
import { useEditorTheme } from '@/features/theme/use-editor-theme';
import { CommentOrAsk } from './comment-or-ask';
import { shellKeyAction, type ShellAction } from './keys';
import { TopBar, type TopBarProps } from './top-bar';

export type ShellMenu = 'comment' | 'share' | 'zoom' | null;

interface Props extends Omit<TopBarProps, 'editor' | 'menu' | 'onMenu' | 'barRef'> {
  author: string;
  canEdit: boolean;
  canRunAgent: boolean;
  webgl: boolean;
}

export function ProjectShell({ author, canEdit, canRunAgent, webgl, ...bar }: Props) {
  const [handle, setHandle] = useState<EditorHandle | null>(null);
  // The agent panel reads the editor when a turn runs, not when it renders.
  const handleRef = useRef<EditorHandle | null>(null);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);
  useEditorTheme(handle?.editor ?? null);
  const agentEditor = useCallback(() => handleRef.current?.editor ?? null, []);
  const [menu, setMenu] = useState<ShellMenu>(null);
  const barRef = useRef<HTMLElement>(null);

  // One handler for keys from both places; refs keep it stable across renders.
  const act = useRef<(a: ShellAction) => void>(() => {});
  useEffect(() => {
    act.current = (a) => {
      switch (a) {
        case 'comment':
          setMenu('comment');
          break;
        case 'canvas':
          setMenu(null);
          if (handle) focusEditor(handle.iframe);
          break;
        case 'next-pane':
        case 'previous-pane': {
          setMenu(null);
          // Two panes so far: from the bar to the canvas and back.
          const inBar = barRef.current?.contains(document.activeElement);
          if (inBar && handle) focusEditor(handle.iframe);
          else focusFirst(barRef.current, a === 'previous-pane');
          break;
        }
        case 'save':
          handle?.editor.save().catch(() => {}); // the status bar shows save errors
          break;
      }
    };
  });

  useEffect(() => {
    const platform: KeyPlatform = platformFromUserAgent(navigator.userAgent);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const a = shellKeyAction(e, 'shell', platform);
      if (!a) return;
      e.preventDefault();
      act.current(a);
    };
    document.addEventListener('keydown', onKeyDown);
    const offEditor = handle
      ? interceptEditorKeys(handle.iframe, (e) => {
          const a = shellKeyAction(e, 'canvas', platform);
          if (a) act.current(a);
          return a !== null;
        })
      : () => {};
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      offEditor();
    };
  }, [handle]);

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        {...bar}
        barRef={barRef}
        editor={handle?.editor ?? null}
        menu={menu}
        onMenu={setMenu}
      />
      <div className="flex min-h-0 flex-1">
        {canRunAgent && <AgentPanel projectId={bar.project.id} editor={agentEditor} />}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <EditorEmbed
            projectId={bar.project.id}
            author={author}
            canEdit={canEdit}
            webgl={webgl}
            onEditor={setHandle}
          />
          {menu === 'comment' && (
            <CommentOrAsk canComment={bar.canComment} onClose={() => act.current('canvas')} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Focus the first (or last) focusable control in `root`. */
function focusFirst(root: HTMLElement | null, last: boolean) {
  const all = root?.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]',
  );
  if (!all?.length) return;
  (last ? all[all.length - 1] : all[0])!.focus();
}
