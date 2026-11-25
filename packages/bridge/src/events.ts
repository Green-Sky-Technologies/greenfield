/**
 * The editor's events to the host (`figcraft:event {name, data}`, fork Stories 2.3, 2.4, 2.11):
 * what a host's own panels need to follow the canvas without reading anything back (ADR 0005).
 * Each goes out at most once a frame, from the frame that saw the change. The fork documents them
 * in `crates/ui-egui/src/app/host_sync.rs`.
 */
import type { EditorNode, NodeId } from './types';

/** Where a layer is: `parent` null for a page, whose `index` is its place among the pages. */
export interface NodePlace {
  id: NodeId;
  parent: NodeId | null;
  index: number;
}

/**
 * A changed layer: `id` and the fields that differ, as `node.get` names them. `null` means the
 * field is gone (back at its default, e.g. `opacity` at 1). An added layer has every field.
 */
export interface NodeChange {
  id: NodeId;
  [field: string]: unknown;
}

export interface EditorEventMap {
  /** The layers selected now on the page in front, each as `node.get` gives it at depth 0. */
  'selection.changed': {
    /** The file in front (`document.inspect`'s `id`), null with no file open. */
    document: number | null;
    page: NodeId | null;
    ids: NodeId[];
    nodes: EditorNode[];
  };
  /**
   * The layers changed (an edit, undo, redo or a gesture's preview; not pan or zoom). Apply
   * `removed`, take `moved` out, then insert `added` and `moved` in ascending `index`; layers not
   * listed keep their order. With `resync` the lists are empty: read the tree again.
   */
  'document.changed': {
    document: number | null;
    revision: number;
    undoDepth: number;
    /** The agent (`"Claude (agent)"`) when one ran a command in that frame, else null. */
    agent: string | null;
    /** The first frame of a file, another file in front, or over 1000 layers changed at once. */
    resync: boolean;
    nodes: NodeChange[];
    /** Where each added layer is. */
    added: NodePlace[];
    /** Where each removed layer was. */
    removed: NodePlace[];
    /** Where each moved layer is now (reparented, or reordered among its siblings). */
    moved: NodePlace[];
  };
  /** The canvas tool, as `tool.set` names it (`move`, `frame`, `text`, …). */
  'tool.changed': { tool: string };
  /** The text layer being typed in, or null when typing ended. */
  'text.editing': { document: number | null; id: NodeId | null };
  /** Zoom (1 = 100%) and the page point at the canvas's top-left: `p` shows at `(p - {x, y}) * zoom`. */
  'viewport.changed': { document: number | null; zoom: number; x: number; y: number };
  /**
   * An interaction (drag, resize, gesture) is open. `host: true` for the host's own `edit.begin`;
   * with `host: false` the canvas has the interaction slot and `edit.begin` fails until it ends.
   */
  'interaction.changed': {
    document: number | null;
    active: boolean;
    label: string | null;
    host: boolean;
  };
  /** Claude's presence on the canvas (Story 2.4). */
  'agent.presence': { active: boolean; name: string; held: boolean; layers: NodeId[] };
  /** Canvas mode turned on or off (Story 2.11). */
  'canvas.mode': { on: boolean };
  /**
   * In canvas mode, what the editor would have opened itself: `contextMenu`, `colorPicker`,
   * `comment.new`, `dialog.*`, … `screen` is where it was asked for, in the canvas's CSS pixels.
   */
  'ui.request': { kind: string; screen: { x: number; y: number } | null; data: unknown };
}

export type EditorEventName = keyof EditorEventMap;

/** One event, narrowed by `name`. */
export type EditorEvent = {
  [N in EditorEventName]: { name: N; data: EditorEventMap[N] };
}[EditorEventName];

const NAMES: ReadonlySet<string> = new Set<EditorEventName>([
  'selection.changed',
  'document.changed',
  'tool.changed',
  'text.editing',
  'viewport.changed',
  'interaction.changed',
  'agent.presence',
  'canvas.mode',
  'ui.request',
]);

/** A `figcraft:event` message's event, or null for a name this bridge doesn't know. */
export function editorEvent(name: unknown, data: unknown): EditorEvent | null {
  if (typeof name !== 'string' || !NAMES.has(name) || !data || typeof data !== 'object') {
    return null;
  }
  return { name, data } as EditorEvent;
}
