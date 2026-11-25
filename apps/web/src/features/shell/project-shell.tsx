'use client';

/**
 * The editor shell (Epic 5), laid out like the mockup (docs/design/01-canvas-mode/5.8): the top
 * bar (5.1), the left panel (Agent, Layers, Comments, Assets), the editor in canvas mode, and the
 * edit panel (Design, Prototype, Code). Every panel reads one `EditorStore` (5.6), fed by the
 * bridge's events; the shell talks to the editor only through `@greenfield/bridge`.
 *
 * Keys and focus (5.4): F6 / Shift+F6 cycle the top bar, left panel, canvas and edit panel; Esc
 * closes what's open and gives the canvas focus; C opens "Comment or ask"; Cmd+\ (Ctrl+\ off a
 * Mac) hides and shows the edit panel. "Editor panels" (5.13) brings the editor's own panels back
 * (`view.canvasMode {on: false}`); ours hide, and stay mounted.
 */
import {
  blurEditor,
  editorHasFocus,
  focusEditor,
  interceptEditorKeys,
  platformFromUserAgent,
  type KeyPlatform,
} from '@greenfield/bridge';
import { EditorStore } from '@greenfield/editor-state';
import { EditorStateProvider, useCanvasMode } from '@greenfield/editor-state/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentPane } from '@/features/agent/agent-pane';
import { ContextMenu } from '@/features/canvas-menus/context-menu';
import { FloatingToolbar } from '@/features/canvas-menus/floating-toolbar';
import { CodeTab } from '@/features/code/code-tab';
import { CommentsPanel } from '@/features/comments/comments-panel';
import { Composer } from '@/features/comments/composer';
import { EditorEmbed, type EditorHandle } from '@/features/editor/editor-embed';
import { DesignTab } from '@/features/inspector/design-tab';
import { LayersPanel } from '@/features/layers/layers-panel';
import { PickerHost } from '@/features/pickers/picker-host';
import { PrototypeTab } from '@/features/prototype/prototype-tab';
import { useEditorTheme } from '@/features/theme/use-editor-theme';
import { CommentOrAsk } from './comment-or-ask';
import { shellKeyAction, type ShellAction } from './keys';
import { PanelTabs } from './panel-tabs';
import { TopBar, type TopBarProps } from './top-bar';

export type ShellMenu = 'comment' | 'share' | 'zoom' | null;

type LeftTab = 'agent' | 'layers' | 'comments' | 'assets';
type RightTab = 'design' | 'prototype' | 'code';

declare global {
  interface Window {
    /** Dev and test builds only: the page's editor store, for e2e checks and perf runs. */
    __greenfieldStore?: EditorStore;
  }
}

type Props = Omit<
  TopBarProps,
  'editor' | 'menu' | 'onMenu' | 'barRef' | 'canvasMode' | 'onCanvasMode'
> & {
  author: string;
  canEdit: boolean;
  canRunAgent: boolean;
  webgl: boolean;
};

export function ProjectShell(props: Props) {
  // The editor starts in canvas mode (`?canvas`); `canvas.mode` events keep the store in step.
  const [store] = useState(() => new EditorStore({ canvasMode: true }));
  return (
    <EditorStateProvider store={store}>
      <Shell store={store} {...props} />
    </EditorStateProvider>
  );
}

function Shell({
  store,
  author,
  canEdit,
  canRunAgent,
  webgl,
  ...bar
}: Props & { store: EditorStore }) {
  const [handle, setHandle] = useState<EditorHandle | null>(null);
  // The agent pane reads the editor when a turn runs, not when it renders.
  const handleRef = useRef<EditorHandle | null>(null);
  useEffect(() => {
    handleRef.current = handle;
    if (!handle) return;
    const disconnect = store.connect(handle.editor);
    if (process.env.NODE_ENV !== 'production') window.__greenfieldStore = store;
    return disconnect;
  }, [handle, store]);
  useEditorTheme(handle?.editor ?? null);
  const agentEditor = useCallback(() => handleRef.current?.editor ?? null, []);
  const canvasMode = useCanvasMode();
  const [menu, setMenu] = useState<ShellMenu>(null);
  const [left, setLeft] = useState<LeftTab>(canRunAgent ? 'agent' : 'layers');
  const [right, setRight] = useState<RightTab>('design');
  const [editPanel, setEditPanel] = useState(true);
  const barRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);

  const setCanvasMode = (on: boolean) => {
    store.run('view.canvasMode', { on }).catch(() => {}); // not ready yet: the button stays as is
  };

  // One handler for keys from both places; refs keep it stable across renders.
  const act = useRef<(a: ShellAction) => void>(() => {});
  useEffect(() => {
    act.current = (a) => {
      switch (a) {
        case 'comment':
          if (handle) blurEditor(handle.iframe); // the composer takes focus
          setMenu('comment');
          break;
        case 'canvas':
          setMenu(null);
          store.requestDone();
          if (handle) focusEditor(handle.iframe);
          break;
        case 'next-pane':
        case 'previous-pane': {
          setMenu(null);
          // In F6 order; a hidden pane is skipped.
          const panes = [
            barRef.current,
            leftRef.current,
            'canvas' as const,
            rightRef.current,
          ].filter((p): p is HTMLElement | 'canvas' => p === 'canvas' || (p !== null && !p.hidden));
          const active = document.activeElement;
          const at = panes.findIndex((p) =>
            p === 'canvas' ? active === handle?.iframe : p.contains(active),
          );
          const step = a === 'next-pane' ? 1 : -1;
          const from = at < 0 ? (step > 0 ? -1 : 0) : at; // nothing focused: start at either end
          const next = panes[(from + step + panes.length) % panes.length]!;
          if (next !== 'canvas') {
            if (handle) blurEditor(handle.iframe);
            focusPane(next, a === 'previous-pane' && next === barRef.current);
          } else if (handle) focusEditor(handle.iframe);
          break;
        }
        case 'toggle-edit-panel':
          setEditPanel((v) => !v);
          break;
        case 'save':
          handle?.editor.save().catch(() => {}); // a failed save shows above the canvas
          break;
      }
    };
  });

  useEffect(() => {
    const platform: KeyPlatform = platformFromUserAgent(navigator.userAgent);
    const context = () => ({ canvasMode: store.getState().canvasMode });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const a = shellKeyAction(e, 'shell', platform, context());
      if (!a) return;
      e.preventDefault();
      act.current(a);
    };
    // Focus that lands in the shell leaves the editor, or it takes focus back (Firefox).
    const onFocusIn = (e: FocusEvent) => {
      if (handle && e.target !== handle.iframe) blurEditor(handle.iframe);
    };
    // A press in the shell while the editor has focus: the editor lets go first, or Firefox
    // keeps focus in its frame and the text box pressed never gets the keyboard.
    const onPointerDown = (e: PointerEvent) => {
      if (handle && e.target !== handle.iframe && editorHasFocus(handle.iframe))
        blurEditor(handle.iframe);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onPointerDown, true);
    const offEditor = handle
      ? interceptEditorKeys(handle.iframe, (e) => {
          const a = shellKeyAction(e, 'canvas', platform, context());
          if (a) act.current(a);
          return a !== null;
        })
      : () => {};
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown, true);
      offEditor();
    };
  }, [handle, store]);

  const leftTabs = [
    ...(canRunAgent
      ? [
          {
            id: 'agent' as const,
            label: 'Agent',
            content: <AgentPane projectId={bar.project.id} editor={agentEditor} />,
          },
        ]
      : []),
    { id: 'layers' as const, label: 'Layers', content: <LayersPanel /> },
    { id: 'comments' as const, label: 'Comments', content: <CommentsPanel /> },
    {
      id: 'assets' as const,
      label: 'Assets',
      content: <p className="p-4 text-xs text-muted">Assets · no story yet</p>,
    },
  ];

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        {...bar}
        barRef={barRef}
        editor={handle?.editor ?? null}
        menu={menu}
        onMenu={setMenu}
        canvasMode={canvasMode}
        onCanvasMode={setCanvasMode}
      />
      <div className="flex min-h-0 flex-1">
        <PanelTabs
          label="Left panel"
          side="left"
          tabs={leftTabs}
          selected={left}
          onSelect={setLeft}
          hidden={!canvasMode}
          paneRef={leftRef}
        />
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
          <EditorEmbed
            projectId={bar.project.id}
            author={author}
            canEdit={canEdit}
            webgl={webgl}
            canvasMode={canvasMode}
            onEditor={setHandle}
          />
          {menu === 'comment' && (
            <CommentOrAsk canComment={bar.canComment} onClose={() => act.current('canvas')} />
          )}
          <ContextMenu />
          <PickerHost />
          <Composer canComment={bar.canComment} />
          <FloatingToolbar editPanelHidden={!editPanel} />
        </main>
        <PanelTabs
          label="Edit panel"
          side="right"
          tabs={[
            { id: 'design', label: 'Design', content: <DesignTab projectId={bar.project.id} /> },
            { id: 'prototype', label: 'Prototype', content: <PrototypeTab /> },
            { id: 'code', label: 'Code', content: <CodeTab /> },
          ]}
          selected={right}
          onSelect={setRight}
          hidden={!canvasMode || !editPanel}
          paneRef={rightRef}
        />
      </div>
    </div>
  );
}

/** Focus a pane: its selected tab, else its first (or last) control, else the pane itself. */
function focusPane(root: HTMLElement, last: boolean) {
  const tab = root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (tab) return tab.focus();
  const all = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]',
  );
  const el = last ? all[all.length - 1] : all[0];
  (el ?? root).focus();
}
