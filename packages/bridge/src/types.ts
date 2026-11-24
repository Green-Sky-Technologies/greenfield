/**
 * The editor interface every consumer codes against. `createBridge` (the real editor in an
 * iframe), `MockEditor` (in memory) and the Playwright helper (the real editor, driven from Node)
 * all implement `Editor`.
 */
import type { BatchStep, CommandId, CommandParams } from './commands';
import type { NodeField } from './generated/commands';

/** A layer or page id. Ids are numbers, unique within a document. */
export type NodeId = number;

export type Unsubscribe = () => void;

/** One command as `figcraft.commands()` lists it. */
export interface CommandInfo {
  id: string;
  label: string;
  menu: string | null;
  /** The editor's parameter doc (a terse mini-language, e.g. `{ids?, index}`). */
  params: string;
  shortcut: string | null;
  undoable: boolean;
  /** Parameter names the engine accepts (generated metadata only; null when unknown). */
  takes?: readonly string[] | null;
}

/** A layer as `document.inspect` / `node.get` return it: `id` always, the rest per `fields`. */
export interface EditorNode {
  id: NodeId;
  name?: string;
  /** Upper case: `FRAME`, `TEXT`, `RECTANGLE`, `PAGE`, … */
  type?: string;
  children?: EditorNode[];
  /** Present at the depth limit instead of `children`. */
  childCount?: number;
  [field: string]: unknown;
}

/** `document.inspect`'s reply. */
export interface DocumentInfo {
  /** The open document's id (not a layer id). */
  id: number;
  name: string;
  path: string | null;
  dirty: boolean;
  currentPage: NodeId;
  selection: NodeId[];
  /** The last 20 undo labels and the redo count. */
  history: { undo: string[]; redo: number };
  /** The current page's tree to `depth`; other pages summarised unless `allPages`. */
  pages: EditorNode[];
  [key: string]: unknown;
}

export interface InspectOptions {
  /** Tree depth below each page (editor default 8, max 64). */
  depth?: number;
  allPages?: boolean;
  /** Layer keys to keep (`[]`: ids and structure only). Not with `outline`. */
  fields?: readonly NodeField[];
  /** id, name, type, characters (cut at 120), mainComponentName, visible. */
  outline?: boolean;
}

export interface GetNodeOptions {
  /** Children depth (editor default 1). */
  depth?: number;
  fields?: readonly NodeField[];
  outline?: boolean;
}

export interface RenderOptions {
  /** Layers to render; default the selection, else the page's top-level layers. */
  ids?: NodeId[];
  /** Keep the long side ≤ ~1600 px; whole large pages fail at scale 1 (Story 0.4). */
  scale?: number;
}

export interface RenderResult {
  png: Uint8Array;
  width: number;
  height: number;
}

export interface ReadyInfo {
  /** The host contract version (`"1"`). */
  version: string;
  /** The editor release, e.g. `0.18.1`. */
  appVersion: string;
}

export interface SaveEvent {
  /** File name, e.g. `Untitled.figcraft`, `Poster.figcraft`, or an export's name. */
  name: string;
  bytes: Uint8Array;
  /**
   * `true`: a document file under a name the host didn't open (Save As, or the first Save of an
   * untitled document); it becomes the document's file. `false`: a Save of the opened file, or a
   * copy/export that never becomes the document.
   */
  saveAs: boolean;
  /** Present once the editor acknowledges saves; the bridge answers `figcraft:saved`. */
  id?: unknown;
}

/** What changed since the last snapshot (two-tier detector, Story 0.4 (b)). */
export interface ChangeSet {
  added: NodeId[];
  removed: NodeId[];
  changed: { id: NodeId; fields: string[] }[];
  meta: {
    selection: boolean;
    page: boolean;
    history: boolean;
    dirty: boolean;
    /** A different document was opened; the snapshot was reset (no node lists). */
    document: boolean;
  };
  /**
   * Mutating calls this bridge made (`execute`/`batch`) since the previous snapshot. A hint for
   * attribution: 0 means a person made these changes. Inspect can't say who (Story 2.3 can).
   */
  controlEdits: number;
}

export interface ChangeDetectorOptions {
  /** Gate poll interval (small `document.inspect`). Default 400 ms. */
  gateIntervalMs?: number;
  /** Wait this long after the last gate change before the full diff. Default 300 ms. */
  debounceMs?: number;
  /** Full diff at least this often, for the gate's blind spots. Default 7500 ms. */
  backstopMs?: number;
  /** Layer fields to diff. Default `DIFF_FIELDS`. */
  fields?: readonly NodeField[];
  /** Polling errors (other than hidden/not-ready, which just skip a tick). */
  onError?: (e: unknown) => void;
}

export interface CallOptions {
  /** The bridge's own deadline. Default 35 s (the editor gives up after 30 s). */
  timeoutMs?: number;
}

export interface BatchOptions extends CallOptions {
  /** The undo step's label. */
  label?: string;
}

/** One step's outcome with `onError: 'continue'`. */
export type BatchStepResult =
  | { step: number; command: string; ok: true; result: unknown }
  | { step: number; command: string; ok: false; error: string };

export interface Editor {
  // ---- lifecycle and host messages ----
  /** True once `figcraft:ready` arrived (and until `dispose`). */
  readonly isReady: boolean;
  /** Resolves on `figcraft:ready`; rejects with `EditorFailedError` on `figcraft:failed`. */
  ready(): Promise<ReadyInfo>;
  /** Called once the editor is ready (immediately if it already is). */
  onReady(cb: (info: ReadyInfo) => void): Unsubscribe;
  /** Unsaved changes appeared (`true`) or went away (`false`). */
  onDirty(cb: (dirty: boolean) => void): Unsubscribe;
  /** Every file the editor hands over (Save, Save As, exports). Return a promise to ack it. */
  onSave(cb: (e: SaveEvent) => void | Promise<void>): Unsubscribe;
  /** The editor couldn't start. */
  onFailed(cb: (error: string) => void): Unsubscribe;
  /** Open a document (`figcraft:open`). The bytes are copied, never transferred away. */
  open(name: string, bytes: Uint8Array | ArrayBuffer): void;
  /** Press Save (Cmd+S on a Mac, Ctrl+S elsewhere); the file arrives through `onSave`. */
  save(opts?: CallOptions): Promise<void>;

  // ---- control (window.figcraft) ----
  /** Run one command (`engine.execute`). Params are typed per command from the pinned editor. */
  execute<C extends CommandId>(
    command: C,
    params?: CommandParams<C>,
    opts?: CallOptions,
  ): Promise<unknown>;
  /**
   * Several commands as one undo step (`command.batch`). Steps may name themselves (`as`) and
   * use earlier results with `ref('name')` / `step(n)`. The first failure rolls back the batch.
   */
  batch(steps: readonly BatchStep[], opts?: BatchOptions): Promise<unknown[]>;
  /** Like `batch`, but failing steps roll back alone and the rest still run. */
  batchContinue(steps: readonly BatchStep[], opts?: BatchOptions): Promise<BatchStepResult[]>;
  /** `document.inspect`. */
  inspect(opts?: InspectOptions, call?: CallOptions): Promise<DocumentInfo>;
  /** `node.get`: one layer, or null when there is no such layer. */
  getNode(id: NodeId, opts?: GetNodeOptions, call?: CallOptions): Promise<EditorNode | null>;
  /** `ui.render`: document pixels only (no UI), deterministic, works without a drawn frame. */
  render(opts?: RenderOptions, call?: CallOptions): Promise<RenderResult>;
  /** `figcraft.commands()`. */
  commands(call?: CallOptions): Promise<CommandInfo[]>;
  /** Any control method, untyped: the escape hatch. */
  request(method: string, params?: unknown, opts?: CallOptions): Promise<unknown>;

  // ---- change detection ----
  /**
   * Subscribe to document changes. Polling runs while anyone listens and the tab is visible
   * (tuned with the `changes` option when the editor is created).
   */
  onChange(cb: (c: ChangeSet) => void): Unsubscribe;
  /** Run the full diff now (before an agent turn): the changes since the last snapshot. */
  detectChanges(): Promise<ChangeSet | null>;

  /** Stop listening and polling; later calls fail with `EditorNotReadyError`. */
  dispose(): void;
}
