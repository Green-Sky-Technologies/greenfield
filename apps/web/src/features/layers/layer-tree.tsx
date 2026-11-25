'use client';

/**
 * The layer tree (Story 5.7): the current page's layers from `usePageTree`'s row model, patched by
 * the store from the editor's events and never re-read. Only the rows in view are rendered; each
 * row reads its own layer (`useTreeNode`), so a rename or a lock re-renders one row.
 *
 * Click selects (Shift: a range, Cmd/Ctrl: one more), and the canvas's selection shows here,
 * expanding and scrolling to it. Double-click or F2 renames; drag reorders and reparents; the row
 * buttons lock and hide. Keys: arrows move and expand, Enter renames, Delete deletes. Every change
 * is an editor command; what the list shows comes back as the editor's events.
 */
import { visibleRows, type EditorState, type NodeId } from '@greenfield/editor-state';
import {
  useEditorStore,
  usePageTree,
  useSelection,
  useTreeNode,
} from '@greenfield/editor-state/react';
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronIcon, EyeIcon, LockIcon, TypeIcon } from './icons';
import { NameInput } from './name-input';
import {
  canContain,
  clickSelection,
  collapsedAncestors,
  dropPosition,
  dropTarget,
  type DropPosition,
} from './tree-ops';

const ROW_HEIGHT = 28;
const INDENT = 16;
const OVERSCAN = 10;
/** Rows rendered before the list has been measured. */
const UNMEASURED_ROWS = 40;

interface DropMark {
  id: NodeId;
  position: DropPosition;
  /** Where the mark goes: the row's index, and the depth the layers land at. */
  index: number;
  depth: number;
}

export function LayerTree() {
  const tree = usePageTree();
  const selection = useSelection();
  const store = useEditorStore();
  const base = useId();
  const [collapsed, setCollapsed] = useState<ReadonlySet<NodeId>>(() => new Set());
  const rows = useMemo(() => visibleRows(tree.rows, collapsed), [tree.rows, collapsed]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const [first, setFirst] = useState(0);
  const [viewRows, setViewRows] = useState(UNMEASURED_ROWS);
  const [focus, setFocus] = useState<NodeId | null>(null);
  const [renaming, setRenaming] = useState<NodeId | null>(null);
  const [drop, setDrop] = useState<DropMark | null>(null);
  const [reveal, setReveal] = useState<{ id: NodeId } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<NodeId | null>(null);
  /** The selection this list asked for: it's in view already, so it doesn't scroll. */
  const requested = useRef<readonly NodeId[] | null>(null);
  const dragged = useRef<NodeId[]>([]);
  const shownCollapsed = useRef(collapsed);
  useLayoutEffect(() => {
    shownCollapsed.current = collapsed;
  });

  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() =>
      setViewRows(Math.ceil(el.clientHeight / ROW_HEIGHT) || UNMEASURED_ROWS),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A selection made elsewhere (the canvas, Claude): expand to it and scroll it into view.
  useEffect(() => {
    let seen = store.getState().selection;
    return store.subscribe(() => {
      const state = store.getState();
      if (state.selection === seen) return;
      seen = state.selection;
      const asked = requested.current;
      requested.current = null;
      if (asked && sameIds(asked, state.selection)) return;
      showSelection(state);
    });
    function showSelection({ selection: ids, tree: t }: EditorState) {
      if (!ids.length) return;
      const was = shownCollapsed.current;
      const up = ids.flatMap((id) => collapsedAncestors(t, id, was));
      if (up.length) {
        const next = new Set(was);
        for (const id of up) next.delete(id);
        setCollapsed(next);
      }
      anchor.current = ids[0]!;
      setFocus(ids[0]!);
      setReveal({ id: ids[0]! });
    }
  }, [store]);

  useLayoutEffect(() => {
    if (reveal)
      scrollToRow(
        scroller.current,
        rows.findIndex((r) => r.id === reveal.id),
      );
  }, [reveal, rows]);

  const run = (p: Promise<unknown>) => p.catch(() => {}); // the editor's state stays as it was
  const select = (ids: NodeId[]) => {
    requested.current = ids;
    run(store.run('select.set', { ids }));
  };
  const moveTo = (id: NodeId, extend: boolean) => {
    setFocus(id);
    setReveal({ id });
    if (extend) select(clickSelection(selection, rows, id, anchor.current, rangeOnly));
    else {
      anchor.current = id;
      select([id]);
    }
  };
  const toggle = (id: NodeId, open?: boolean) => {
    const next = new Set(collapsed);
    if (open ?? next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };
  const setFlag = (id: NodeId, flag: 'locked' | 'visible') => {
    const n = tree.nodes.get(id);
    if (n) run(store.run('node.set', { ids: [id], [flag]: !n[flag] }));
  };
  const rowOf = (e: { target: EventTarget }) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-id]');
    return el ? Number(el.dataset.id) : null;
  };

  const onClick = (e: React.MouseEvent) => {
    const id = rowOf(e);
    if (id === null) return;
    const action = (e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'toggle') return toggle(id);
    if (action === 'lock') return setFlag(id, 'locked');
    if (action === 'hide') return setFlag(id, 'visible');
    const mods = { range: e.shiftKey, toggle: e.metaKey || e.ctrlKey };
    select(clickSelection(selection, rows, id, anchor.current, mods));
    if (!mods.range) anchor.current = id;
    setFocus(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming !== null) return;
    const at = focus ?? selection.at(-1) ?? null;
    const i = at === null ? -1 : rows.findIndex((r) => r.id === at);
    const node = at === null ? undefined : tree.nodes.get(at);
    const open = node && node.children.length > 0 && !collapsed.has(node.id);
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const next = rows[e.key === 'ArrowDown' ? i + 1 : i < 0 ? rows.length - 1 : i - 1];
        if (next) moveTo(next.id, e.shiftKey);
        break;
      }
      case 'Home':
      case 'End': {
        const next = e.key === 'Home' ? rows[0] : rows.at(-1);
        if (next) moveTo(next.id, e.shiftKey);
        break;
      }
      case 'ArrowRight':
        if (node?.children.length && !open) toggle(node.id, true);
        else if (open) moveTo(rows[i + 1]!.id, false);
        break;
      case 'ArrowLeft':
        if (open) toggle(node.id, false);
        else if (node && tree.nodes.has(node.parent)) moveTo(node.parent, false);
        break;
      case 'Enter':
      case 'F2':
        if (at !== null) setRenaming(at);
        break;
      case 'Delete':
      case 'Backspace':
        if (selection.length) run(store.run('edit.delete', { ids: [...selection] }));
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  const onDragStart = (e: React.DragEvent) => {
    const id = rowOf(e);
    if (id === null) return;
    const ids = selected.has(id) ? selection.filter((s) => tree.nodes.has(s)) : [id];
    // A layer moves with its parent: drag only the top-most of the dragged.
    dragged.current = ids.filter((s) => !hasAncestorIn(tree, s, ids));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tree.nodes.get(id)?.name ?? ''); // Firefox starts no drag without data
  };
  const dropAt = (e: React.DragEvent) => {
    const id = rowOf(e);
    const row = id === null ? null : (e.target as Element).closest('[data-id]');
    const node = id === null ? undefined : tree.nodes.get(id);
    if (!row || !node || !dragged.current.length) return null;
    const y = e.clientY - row.getBoundingClientRect().top;
    const position = dropPosition(y, ROW_HEIGHT, canContain(node.type));
    const expanded = node.children.length > 0 && !collapsed.has(node.id);
    const target = dropTarget(tree, dragged.current, node.id, position, expanded);
    if (!target) return null;
    const index = rows.findIndex((r) => r.id === node.id);
    const into = target.parent === node.id;
    return { target, mark: { id: node.id, position, index, depth: rows[index]!.depth + +into } };
  };
  const onDragOver = (e: React.DragEvent) => {
    const at = dropAt(e);
    if (!at) return setDrop(null);
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!drop || drop.id !== at.mark.id || drop.position !== at.mark.position) setDrop(at.mark);
  };
  const onDrop = (e: React.DragEvent) => {
    const at = dropAt(e);
    setDrop(null);
    if (!at) return;
    e.preventDefault();
    const { parent, index } = at.target;
    run(store.run('node.reparent', { ids: dragged.current, parent, index }));
    dragged.current = [];
  };
  const onDragEnd = () => {
    dragged.current = [];
    setDrop(null);
  };

  const start = Math.max(0, first - OVERSCAN);
  const end = Math.min(rows.length, first + viewRows + OVERSCAN);
  const active = focus !== null && selected.has(focus) ? focus : null;

  return (
    <div
      ref={scroller}
      role="tree"
      aria-label="Layers"
      aria-multiselectable
      aria-activedescendant={active === null ? undefined : `${base}-${active}`}
      tabIndex={0}
      data-testid="layer-tree"
      onScroll={(e) => setFirst(Math.floor(e.currentTarget.scrollTop / ROW_HEIGHT))}
      onClick={onClick}
      onDoubleClick={(e) => {
        const id = rowOf(e);
        if (id !== null && !(e.target as Element).closest('[data-action]')) setRenaming(id);
      }}
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
      }}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className="shell-focus relative min-h-0 flex-1 overflow-y-auto pb-2 select-none"
    >
      {rows.length === 0 ? (
        <p className="px-4 py-2 text-xs text-muted">No layers on this page</p>
      ) : (
        <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
          {rows.slice(start, end).map((r, k) => (
            <LayerRow
              key={r.id}
              domId={`${base}-${r.id}`}
              id={r.id}
              depth={r.depth}
              top={(start + k) * ROW_HEIGHT}
              selected={selected.has(r.id)}
              collapsed={collapsed.has(r.id)}
              onRenamed={
                renaming === r.id
                  ? (name) => {
                      setRenaming(null);
                      scroller.current?.focus();
                      const n = tree.nodes.get(r.id);
                      if (name !== null && n && name !== n.name)
                        run(store.run('node.set', { ids: [r.id], name }));
                    }
                  : undefined
              }
            />
          ))}
          {drop && <DropLine mark={drop} />}
        </div>
      )}
    </div>
  );
}

const rangeOnly = { range: true, toggle: false };

const sameIds = (a: readonly NodeId[], b: readonly NodeId[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

function hasAncestorIn(tree: EditorState['tree'], id: NodeId, ids: readonly NodeId[]) {
  for (let n = tree.nodes.get(tree.nodes.get(id)?.parent ?? -1); n; n = tree.nodes.get(n.parent))
    if (ids.includes(n.id)) return true;
  return false;
}

function scrollToRow(el: HTMLElement | null, index: number) {
  if (!el || index < 0) return;
  const top = index * ROW_HEIGHT;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
    el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
}

const indent = (depth: number) => 12 + depth * INDENT;

function DropLine({ mark }: { mark: DropMark }) {
  const top = mark.index * ROW_HEIGHT;
  if (mark.position === 'inside')
    return (
      <div
        aria-hidden="true"
        data-testid="layer-drop"
        data-position="inside"
        className="pointer-events-none absolute inset-x-0 border-2 border-user"
        style={{ top, height: ROW_HEIGHT }}
      />
    );
  return (
    <div
      aria-hidden="true"
      data-testid="layer-drop"
      data-position={mark.position}
      className="pointer-events-none absolute right-0 h-0.5 bg-user"
      style={{
        top: (mark.position === 'above' ? top : top + ROW_HEIGHT) - 1,
        left: indent(mark.depth),
      }}
    />
  );
}

const KIND: Record<string, string> = {
  main: 'Main component',
  set: 'Component set',
  instance: 'Instance',
};

const LayerRow = memo(function LayerRow({
  domId,
  id,
  depth,
  top,
  selected,
  collapsed,
  onRenamed,
}: {
  domId: string;
  id: NodeId;
  depth: number;
  top: number;
  selected: boolean;
  collapsed: boolean;
  onRenamed?: (name: string | null) => void;
}) {
  const node = useTreeNode(id);
  if (!node) return null;
  const name = node.name || node.type.toLowerCase();
  const parent = node.children.length > 0;
  const flag = 'shell-focus p-0.5 hover:text-text';
  const status = [
    node.component && KIND[node.component],
    node.locked && 'Locked',
    !node.visible && 'Hidden',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div
      role="treeitem"
      id={domId}
      data-id={id}
      data-mark={node.component ?? undefined}
      aria-label={name}
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={parent ? !collapsed : undefined}
      aria-describedby={status ? `${domId}-status` : undefined}
      draggable={!onRenamed}
      className={`group absolute inset-x-0 flex items-center gap-2 pr-3 text-xs ${
        selected ? 'bg-user/15 text-user' : 'text-text hover:bg-surface-2'
      }`}
      style={{ top, height: ROW_HEIGHT, paddingLeft: indent(depth) }}
    >
      {parent && (
        <span
          data-action="toggle"
          aria-hidden="true"
          className="absolute flex h-full w-3 cursor-pointer items-center justify-center text-muted hover:text-text"
          style={{ left: indent(depth) - 13 }}
        >
          <ChevronIcon open={!collapsed} />
        </span>
      )}
      <span className={selected ? '' : 'text-muted'}>
        <TypeIcon type={node.type} />
      </span>
      {status && (
        <span id={`${domId}-status`} className="sr-only">
          {status}
        </span>
      )}
      {onRenamed ? (
        <NameInput label="Layer name" value={node.name} onDone={onRenamed} />
      ) : (
        <span className={`min-w-0 flex-1 truncate ${node.visible ? '' : 'opacity-50'}`}>
          {name}
        </span>
      )}
      <span className="flex shrink-0 gap-1 text-muted">
        <button
          type="button"
          tabIndex={-1}
          data-action="lock"
          aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${name}`}
          aria-pressed={node.locked}
          className={`${flag} ${node.locked ? '' : 'invisible group-hover:visible'}`}
        >
          <LockIcon locked={node.locked} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-action="hide"
          aria-label={`${node.visible ? 'Hide' : 'Show'} ${name}`}
          aria-pressed={!node.visible}
          className={`${flag} ${node.visible ? 'invisible group-hover:visible' : ''}`}
        >
          <EyeIcon visible={node.visible} />
        </button>
      </span>
    </div>
  );
});
