'use client';

/**
 * Our right-click menu (Story 5.10), opened by the canvas's `ui.request contextMenu` (2.11) at the
 * pointer, or by Shift+F10 on the canvas (no pointer: beside the selection). It acts on the
 * request's layers with the editor's commands (`actions.ts`).
 *
 * Keyboard: it takes focus when it opens; arrows, Home and End move between items; Enter runs
 * one. Esc (the shell's key) closes it and returns to the canvas, as does running an item; focus
 * leaving it (a click elsewhere) closes it.
 */
import { blurEditor, focusEditor, platformFromUserAgent, type NodeId } from '@greenfield/bridge';
import type { UiRequest } from '@greenfield/editor-state';
import { useEditorStore, useSelection, useUiRequest } from '@greenfield/editor-state/react';
import { useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { ariaShortcut, contextMenuGroups, shortcutLabel, type MenuItem } from './actions';
import { canvasFrame, placeAt, toPage, toScreen, unionBounds } from './geometry';
import { perform } from './perform';

export function ContextMenu() {
  const request = useUiRequest();
  if (request?.kind !== 'contextMenu') return null;
  return <Menu request={request} />;
}

const MARGIN = 8;

function Menu({ request }: { request: UiRequest }) {
  const store = useEditorStore();
  const selection = useSelection();
  const ref = useRef<HTMLDivElement>(null);
  const ids = (request.data as { ids?: NodeId[] } | null)?.ids ?? selection;
  // Read once per request: the menu is a snapshot of what was right-clicked.
  const { groups, anchor } = useMemo(() => {
    const s = store.getState();
    const at = request.screen && s.viewport ? toPage(request.screen, s.viewport) : null;
    const bounds = unionBounds(ids.map((id) => s.nodes.get(id)));
    const sel = bounds && s.viewport ? toScreen(bounds, s.viewport) : null;
    return {
      groups: contextMenuGroups({ ids, layers: ids.map((id) => s.tree.nodes.get(id)), at }),
      // Without a pointer (Shift+F10): below the selection's top-left corner.
      anchor: request.screen ?? (sel ? { x: sel.x, y: sel.y + sel.height } : null),
    };
  }, [request, ids, store]);
  const platform = platformFromUserAgent(navigator.userAgent); // client only: opened by an event

  useLayoutEffect(() => {
    const menu = ref.current;
    const iframe = canvasFrame();
    if (!menu || !iframe) return;
    const frame = iframe.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    const at = anchor
      ? { x: frame.left + anchor.x, y: frame.top + anchor.y }
      : { x: frame.left + (frame.width - size.width) / 2, y: frame.top + frame.height / 3 };
    const pos = placeAt(at, size, {
      x: MARGIN,
      y: MARGIN,
      width: window.innerWidth - 2 * MARGIN,
      height: window.innerHeight - 2 * MARGIN,
    });
    // Placed before paint, and visible before it takes focus (hidden elements can't).
    menu.style.left = `${pos.x}px`;
    menu.style.top = `${pos.y}px`;
    menu.style.visibility = 'visible';
    blurEditor(iframe); // or the editor keeps the keyboard (it was right-clicked)
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [anchor]);

  const toCanvas = () => {
    const frame = canvasFrame();
    if (frame) focusEditor(frame);
  };
  const run = (item: MenuItem) => {
    // "Comment or ask" replaces this request with its own; a command closes the menu.
    if (item.action.kind === 'command') {
      store.requestDone();
      toCanvas();
    }
    perform(store, item.action, { ids, screen: anchor }).catch(() => {}); // the canvas shows the result
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = {
      ArrowDown: (at + 1) % items.length,
      ArrowUp: (at - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Layer actions"
      data-testid="context-menu"
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) store.requestDone();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-40 w-60 bg-surface-2 py-1.5 text-xs text-text shadow-[0_12px_32px_rgb(0_0_0/0.45),inset_0_0_0_1px_var(--rule)]"
      style={{ left: 0, top: 0, visibility: 'hidden' }}
    >
      {groups.map((group, g) => (
        <div key={g} role="group" className={g ? 'mt-1 border-t border-border pt-1' : undefined}>
          {group.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-keyshortcuts={item.shortcut && ariaShortcut(item.shortcut, platform)}
              // Keep focus in the menu on press (Safari doesn't focus buttons on click).
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={(e) => e.currentTarget.focus()}
              onClick={() => run(item)}
              className={`flex h-[26px] w-full items-center justify-between px-2.5 text-left outline-none hover:bg-border focus:bg-border ${item.agent ? 'text-agent' : ''}`}
            >
              <span>{item.label}</span>
              {item.shortcut && (
                <kbd
                  className={`font-mono text-[11px] ${item.agent ? '' : 'text-muted'}`}
                  aria-hidden
                >
                  {shortcutLabel(item.shortcut, platform)}
                </kbd>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
