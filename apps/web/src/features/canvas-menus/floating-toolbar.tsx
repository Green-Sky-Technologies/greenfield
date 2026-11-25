'use client';

/**
 * The small toolbar over the selection while the edit panel is hidden (Cmd+\, SPEC §4; Story
 * 5.10): what's selected (a text layer's font and size), its fill, its font, Create component and
 * Ask Claude. It follows the selection as the canvas pans and zooms, and steps aside while the
 * canvas has a drag open, text is being typed, or the context menu is up.
 *
 * Keyboard: Alt+F10 (from the canvas or the shell) moves focus to it; arrows move along it; Esc
 * (the shell's key) returns to the canvas.
 */
import { blurEditor, focusEditor, interceptEditorKeys, type NodeId } from '@greenfield/bridge';
import type { NodeFields } from '@greenfield/editor-state';
import {
  useEditorState,
  useEditorStore,
  useGesture,
  useInteraction,
  useSelection,
  useTextEditing,
  useUiRequest,
  useViewport,
} from '@greenfield/editor-state/react';
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { openColourPicker, openFontPicker, type ColourValue } from '@/features/pickers/open';
import type { MenuAction } from './actions';
import { canvasFrame, clampInto, toScreen, unionBounds } from './geometry';
import { perform } from './perform';

const GAP = 8;

export function FloatingToolbar({ editPanelHidden }: { editPanelHidden: boolean }) {
  const selection = useSelection();
  const nodes = useEditorState((s) => s.nodes);
  const viewport = useViewport();
  const typing = useTextEditing();
  const interaction = useInteraction();
  const request = useUiRequest();
  const selected = selection.map((id) => nodes.get(id));
  const bounds = unionBounds(selected);
  const shown =
    editPanelHidden &&
    bounds !== null &&
    viewport !== null &&
    typing === null &&
    !(interaction && !interaction.host) &&
    request?.kind !== 'contextMenu';
  if (!shown) return null;
  return (
    <Toolbar
      ids={selection}
      nodes={selected.filter((n): n is NodeFields => !!n)}
      at={toScreen(bounds, viewport)}
    />
  );
}

interface Fill {
  type?: string;
  color?: string;
  opacity?: number;
}

function Toolbar({
  ids,
  nodes,
  at,
}: {
  ids: readonly NodeId[];
  nodes: readonly NodeFields[];
  at: { x: number; y: number; width: number; height: number };
}) {
  const store = useEditorStore();
  const ref = useRef<HTMLDivElement>(null);
  const fillGesture = useGesture('Change fill');
  const target = { ids: [...ids] };
  const text = nodes.length === 1 && nodes[0]!.type === 'TEXT' ? nodes[0]! : null;
  const family = typeof text?.fontFamily === 'string' ? text.fontFamily : null;
  const fill = (nodes[0]?.fills as Fill[] | undefined)?.find((f) => f.type === 'solid');
  const label = text
    ? [family, text.fontSize].filter((v) => v != null).join(' · ')
    : nodes.length === 1
      ? (nodes[0]!.name ?? '')
      : `${nodes.length} layers`;

  // Above the selection, or below it when there's no room; inside the canvas either way.
  useLayoutEffect(() => {
    const el = ref.current;
    const frame = canvasFrame()?.getBoundingClientRect();
    if (!el || !frame) return;
    const size = el.getBoundingClientRect();
    const above = at.y - size.height - GAP;
    const y = above >= GAP ? above : at.y + at.height + GAP;
    const pos = clampInto({ x: frame.left + at.x, y: frame.top + y }, size, {
      x: frame.left + GAP,
      y: frame.top + GAP,
      width: frame.width - 2 * GAP,
      height: frame.height - 2 * GAP,
    });
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.visibility = 'visible';
  });

  useFocusShortcut(ref);

  const anchorOf = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom };
  };
  const toCanvas = () => {
    const frame = canvasFrame();
    if (frame) focusEditor(frame);
  };
  const act = (action: MenuAction) => {
    perform(store, action, { ids, screen: { x: at.x, y: at.y } }).catch(() => {});
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...ref.current!.querySelectorAll<HTMLElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = {
      ArrowRight: (i + 1) % items.length,
      ArrowLeft: (i - 1 + items.length) % items.length,
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
      role="toolbar"
      aria-label="Selection"
      data-testid="floating-toolbar"
      onKeyDown={onKeyDown}
      className="fixed z-20 flex items-center gap-0.5 bg-surface-2 p-1 text-xs shadow-[0_8px_24px_rgb(0_0_0/0.45),inset_0_0_0_1px_var(--rule)]"
      style={{ left: 0, top: 0, visibility: 'hidden' }}
    >
      <span className="max-w-48 truncate px-2 font-mono text-muted" data-testid="floating-label">
        {label}
      </span>
      <Rule />
      {fill?.color && (
        <ToolButton
          label={`Fill ${fill.color}`}
          onClick={(e) => {
            const el = e.currentTarget;
            const preview = (v: ColourValue) => {
              if ('hex' in v)
                fillGesture.preview([
                  {
                    command: 'fill.set',
                    params: { ...target, index: 0, color: v.hex, opacity: v.opacity },
                  },
                ]);
            };
            openColourPicker(anchorOf(el), {
              value: { hex: fill.color!, opacity: fill.opacity ?? 1 },
              onPreview: preview,
              onCommit: (v) => {
                if ('hex' in v) {
                  preview(v);
                  fillGesture.commit().catch(() => {});
                } else {
                  fillGesture.cancel().catch(() => {});
                  act({
                    kind: 'command',
                    ...('variable' in v
                      ? {
                          command: 'variable.bind',
                          params: { ...target, field: 'fills/0/color', variable: v.variable },
                        }
                      : {
                          command: 'style.apply',
                          params: { ...target, style: v.style, target: 'fill' },
                        }),
                  });
                }
              },
              onCancel: () => fillGesture.cancel().catch(() => {}),
            });
          }}
        >
          <span
            aria-hidden
            className="block size-3.5 shadow-[inset_0_0_0_1px_var(--rule)]"
            style={{ background: fill.color }}
          />
        </ToolButton>
      )}
      {text && (
        <ToolButton
          label={family ? `Font ${family}` : 'Font'}
          onClick={(e) =>
            openFontPicker(anchorOf(e.currentTarget), {
              family: family ?? '',
              onCommit: (fontFamily) =>
                act({ kind: 'command', command: 'text.style', params: { ...target, fontFamily } }),
              onCancel: () => {},
            })
          }
        >
          <Icon d="M3 3h10M8 3v10" />
        </ToolButton>
      )}
      <ToolButton
        label="Create component"
        onClick={() => {
          act({ kind: 'command', command: 'component.create', params: target });
          toCanvas();
        }}
      >
        <Icon d="M8 1.5l3 3-3 3-3-3zM8 8.5l3 3-3 3-3-3zM1.5 8l3-3 3 3-3 3zM8.5 8l3-3 3 3-3 3z" />
      </ToolButton>
      <Rule />
      <button
        type="button"
        onClick={() => act({ kind: 'comment', ask: true })}
        className="shell-focus flex h-7 items-center gap-1.5 px-2 text-agent hover:bg-border"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <path d="M2 2.5h12v8H7l-3 3v-3H2z" />
        </svg>
        Ask Claude
      </button>
    </div>
  );
}

/** Alt+F10 moves focus to the toolbar, from the shell or the canvas (the editor never sees it). */
function useFocusShortcut(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const isShortcut = (e: globalThis.KeyboardEvent) =>
      e.key === 'F10' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
    const frame = canvasFrame();
    const focus = () => {
      if (frame) blurEditor(frame); // or Firefox gives the keyboard back to the canvas
      ref.current?.querySelector<HTMLElement>('button')?.focus();
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!isShortcut(e)) return;
      e.preventDefault();
      focus();
    };
    document.addEventListener('keydown', onKeyDown);
    const off = frame
      ? interceptEditorKeys(frame, (e) => {
          if (!isShortcut(e)) return false;
          focus();
          return true;
        })
      : () => {};
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      off();
    };
  }, [ref]);
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="shell-focus flex size-7 items-center justify-center text-text hover:bg-border"
    >
      {children}
    </button>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const Rule = () => <span aria-hidden className="mx-0.5 h-[18px] w-px bg-border" />;
