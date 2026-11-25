/**
 * The store's reducer: `EditorState` from editor events and the store's full reads. Pure: every
 * action returns a new state (or the same one when nothing changed), so hooks re-render only
 * when the slice they read is a different object.
 */
import { EMPTY_TREE, patchTree, treeFromLayers } from './tree';
import type {
  DocumentChanged,
  EditorAction,
  EditorState,
  NodeFields,
  NodeId,
  PageSummary,
} from './types';

export const INITIAL_STATE: EditorState = {
  document: null,
  pages: [],
  tree: EMPTY_TREE,
  selection: [],
  nodes: new Map(),
  tool: null,
  viewport: null,
  textEditing: null,
  interaction: null,
  agent: null,
  canvasMode: false,
  request: null,
};

const sameIds = (a: readonly NodeId[], b: readonly NodeId[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** `fields` over `prev`; a `null` field is one the layer no longer has. */
function merge(prev: NodeFields | undefined, fields: NodeFields): NodeFields {
  const next: NodeFields = { ...prev, ...fields };
  for (const [k, v] of Object.entries(fields)) if (v === null) delete next[k];
  return next;
}

/** `nodes` for `selection`: kept entries, then `fields` merged in (only for selected layers). */
function selectedNodes(
  prev: ReadonlyMap<NodeId, NodeFields>,
  selection: readonly NodeId[],
  fields: readonly NodeFields[] = [],
): ReadonlyMap<NodeId, NodeFields> {
  const wanted = new Set(selection);
  const incoming = fields.filter((f) => wanted.has(f.id));
  if (!incoming.length && [...prev.keys()].every((id) => wanted.has(id))) return prev;
  const next = new Map<NodeId, NodeFields>();
  for (const id of selection) {
    const kept = prev.get(id);
    if (kept) next.set(id, kept);
  }
  for (const f of incoming) next.set(f.id, merge(next.get(f.id), f));
  return next;
}

/** Pages added, removed, moved or renamed (placements whose `parent` is null). */
function patchPages(pages: readonly PageSummary[], a: DocumentChanged): readonly PageSummary[] {
  const isPage = (p: { parent: NodeId | null }) => p.parent === null;
  const named = new Map((a.nodes ?? []).map((n) => [n.id, n.name]));
  const placed = [...(a.added ?? []), ...(a.moved ?? [])].filter(isPage);
  const gone = new Set([...(a.removed ?? []), ...(a.moved ?? [])].filter(isPage).map((p) => p.id));
  const renamed = pages.some((p) => typeof named.get(p.id) === 'string');
  if (!placed.length && !gone.size && !renamed) return pages;
  const next = pages
    .filter((p) => !gone.has(p.id))
    .map((p) => {
      const name = named.get(p.id);
      return typeof name === 'string' ? { ...p, name } : p;
    });
  for (const p of placed.sort((x, y) => x.index - y.index)) {
    const was = pages.find((q) => q.id === p.id);
    const name = named.get(p.id);
    next.splice(p.index, 0, {
      id: p.id,
      name: typeof name === 'string' ? name : (was?.name ?? ''),
      current: was?.current ?? false,
    });
  }
  return next;
}

export function reduce(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'document.loaded':
      return {
        ...state,
        document: action.document,
        pages: action.pages,
        tree: treeFromLayers(action.pages.find((p) => p.current)?.id ?? 0, action.layers),
        selection: action.selection,
        nodes: selectedNodes(
          action.document.id === state.document?.id ? state.nodes : new Map(),
          action.selection,
        ),
        textEditing: null,
      };

    case 'selection.changed': {
      if (state.document && action.document !== state.document.id) return state;
      const selection = sameIds(state.selection, action.ids) ? state.selection : action.ids;
      const nodes = selectedNodes(state.nodes, selection, action.nodes);
      if (selection === state.selection && nodes === state.nodes) return state;
      return { ...state, selection, nodes };
    }

    case 'document.changed': {
      const doc = state.document;
      if (!doc || action.document !== doc.id) return state;
      const document = { ...doc, revision: action.revision, undoDepth: action.undoDepth };
      if (action.resync) return { ...state, document }; // the store reads the tree again
      const tree = patchTree(state.tree, action);
      // A removed layer leaves the selection (its own `selection.changed` may come later).
      const selection = action.removed?.length
        ? state.selection.filter((id) => !state.tree.nodes.has(id) || tree.nodes.has(id))
        : state.selection;
      return {
        ...state,
        document,
        pages: patchPages(state.pages, action),
        tree,
        selection: sameIds(selection, state.selection) ? state.selection : selection,
        nodes: selectedNodes(state.nodes, selection, action.nodes),
      };
    }

    case 'nodes.loaded': {
      const nodes = selectedNodes(state.nodes, state.selection, action.nodes);
      return nodes === state.nodes ? state : { ...state, nodes };
    }

    case 'tool.changed':
      return action.tool === state.tool ? state : { ...state, tool: action.tool };

    case 'viewport.changed': {
      const v = state.viewport;
      if (v && v.zoom === action.zoom && v.x === action.x && v.y === action.y) return state;
      return { ...state, viewport: { zoom: action.zoom, x: action.x, y: action.y } };
    }

    case 'text.editing':
      return action.id === state.textEditing ? state : { ...state, textEditing: action.id };

    case 'interaction.changed':
      return {
        ...state,
        interaction: action.active ? { label: action.label, host: action.host } : null,
      };

    case 'canvas.mode':
      return action.on === state.canvasMode ? state : { ...state, canvasMode: action.on };

    case 'agent.presence':
      return {
        ...state,
        agent: action.active
          ? { name: action.name, active: true, layers: action.layers }
          : state.agent && { ...state.agent, active: false, layers: [] },
      };

    case 'ui.request':
      return {
        ...state,
        request: { kind: action.kind, screen: action.screen, data: action.data },
      };

    case 'request.done':
      return state.request ? { ...state, request: null } : state;

    case 'dirty': {
      const doc = state.document;
      if (!doc || doc.dirty === action.dirty) return state;
      return { ...state, document: { ...doc, dirty: action.dirty } };
    }
  }
}
