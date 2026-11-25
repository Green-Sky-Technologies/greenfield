/**
 * The editor state every panel reads (Story 5.6), and the actions that change it. Actions are the
 * editor's own events (`figcraft:event` names and payloads, Stories 2.3, 2.4, 2.11; the shapes are
 * documented in the fork's `crates/ui-egui/src/app/host_sync.rs`) plus the store's full reads:
 * `document.loaded` (open, file or page change) and `nodes.loaded`.
 */
import type { NodeId } from '@greenfield/bridge';

export type { NodeId };

/**
 * A layer's fields as the editor reports them (`node.get` at depth 0): `id` always, the rest as
 * sent. In a `document.changed` patch, `null` is a field the layer no longer has.
 */
export interface NodeFields {
  id: NodeId;
  name?: string | null;
  /** Upper case: `FRAME`, `TEXT`, `COMPONENT`, `INSTANCE`, … */
  type?: string | null;
  [field: string]: unknown;
}

/** One layer in the page tree: structure plus what a layers row shows. */
export interface TreeNode {
  id: NodeId;
  /** The page for a top-level layer. */
  parent: NodeId;
  /** Back to front, as the editor orders them. */
  children: readonly NodeId[];
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  /** Component marks for the layers row. */
  component: 'main' | 'set' | 'instance' | null;
}

/**
 * The current page's layers. `rows` is the layers list's row model: every layer in display order
 * (front-most first, depth-first), ready to virtualise. It keeps its identity across field-only
 * changes, so a rename re-renders one row, not the list.
 */
export interface PageTree {
  page: NodeId | null;
  nodes: ReadonlyMap<NodeId, TreeNode>;
  /** Top-level layers, back to front. */
  roots: readonly NodeId[];
  rows: readonly TreeRow[];
}

export interface TreeRow {
  id: NodeId;
  depth: number;
}

export interface PageSummary {
  id: NodeId;
  name: string;
  current: boolean;
}

/** A prototype flow: where presenting starts (`proto.flow.*`, Story 5.12). */
export interface Flow {
  /** The top-level frame it starts on. */
  start: NodeId;
  name: string;
  description: string;
}

export interface DocumentState {
  /** The open document's id (not a layer id); changes when another file opens. */
  id: number;
  revision: number;
  /** Undo steps available: the fallback round trip (5.13) must keep it. */
  undoDepth: number;
  dirty: boolean;
}

export interface Viewport {
  /** 1 = 100%. */
  zoom: number;
  /** The page point at the canvas's top-left: page point `p` shows at `(p - (x, y)) * zoom`. */
  x: number;
  y: number;
}

/** Claude (or another agent) holding presence on the canvas (Story 2.4). */
export interface AgentPresence {
  name: string;
  active: boolean;
  /** The layers it is editing. */
  layers: readonly NodeId[];
}

/**
 * An interaction open on the canvas: a drag, a resize, or a gesture. `host` is true for the
 * store's own (`edit.begin`); while the canvas has its own open, `edit.begin` fails.
 */
export interface Interaction {
  label: string | null;
  host: boolean;
}

/**
 * Something the canvas asks the host to show instead of drawing it in canvas mode (Story 2.11):
 * `contextMenu`, `colorPicker`, `comment.new`, keyboard-raised dialogs. `screen` is in the
 * canvas's CSS pixels.
 */
export interface UiRequest {
  kind: string;
  screen: { x: number; y: number } | null;
  data: unknown;
}

export interface EditorState {
  document: DocumentState | null;
  pages: readonly PageSummary[];
  tree: PageTree;
  /** The current page's prototype flows (the page's `flows` field). */
  flows: readonly Flow[];
  selection: readonly NodeId[];
  /** Full fields for the selected layers only. */
  nodes: ReadonlyMap<NodeId, NodeFields>;
  /** The canvas tool (`move`, `frame`, `rectangle`, …); null until known. */
  tool: string | null;
  viewport: Viewport | null;
  /** The text layer being typed into on the canvas. */
  textEditing: NodeId | null;
  interaction: Interaction | null;
  agent: AgentPresence | null;
  /** The editor draws only the canvas (2.11); false while its own panels are back (5.13). */
  canvasMode: boolean;
  /** The canvas's latest open request, until the host answers it (`request.done`). */
  request: UiRequest | null;
}

/** Where a layer is (`added`, `moved`) or was (`removed`). A page's `parent` is null. */
export interface Placement {
  id: NodeId;
  parent: NodeId | null;
  index: number;
}

/**
 * `document.changed`: apply `removed`, take `moved` out, then insert `added` and `moved` in
 * ascending `index` (`patchTree`).
 */
export interface DocumentChanged {
  type: 'document.changed';
  document: number;
  revision: number;
  undoDepth: number;
  /** The agent that ran a command in this change, e.g. `"Claude (agent)"`. */
  agent?: string | null;
  /** The editor couldn't patch (a new file, or too many layers changed): read it again. */
  resync?: boolean;
  /** Added layers in full; changed layers' differing fields (`null`: gone). */
  nodes?: NodeFields[];
  added?: Placement[];
  removed?: Placement[];
  moved?: Placement[];
}

export interface SelectionChanged {
  type: 'selection.changed';
  document: number;
  page: NodeId;
  ids: NodeId[];
  /** The selected layers' fields (`node.get` at depth 0). */
  nodes?: NodeFields[];
}

/** A page's tree as `document.inspect` returns it (children nested). */
export interface RawNode {
  id: NodeId;
  name?: string;
  type?: string;
  visible?: boolean;
  locked?: boolean;
  children?: RawNode[];
  [field: string]: unknown;
}

export type EditorAction =
  | {
      /** A full read: on open, on a file change and on a page change. */
      type: 'document.loaded';
      document: DocumentState;
      pages: PageSummary[];
      /** The current page's top-level layers, back to front. */
      layers: RawNode[];
      flows?: Flow[];
      selection: NodeId[];
    }
  | SelectionChanged
  | DocumentChanged
  | { type: 'nodes.loaded'; nodes: NodeFields[] }
  | { type: 'tool.changed'; tool: string }
  | { type: 'viewport.changed'; zoom: number; x: number; y: number }
  | { type: 'text.editing'; id: NodeId | null }
  | { type: 'interaction.changed'; active: boolean; label: string | null; host: boolean }
  | { type: 'canvas.mode'; on: boolean }
  | { type: 'agent.presence'; active: boolean; name: string; layers: NodeId[] }
  | { type: 'ui.request'; kind: string; screen: { x: number; y: number } | null; data: unknown }
  | { type: 'request.done' }
  | { type: 'dirty'; dirty: boolean };
